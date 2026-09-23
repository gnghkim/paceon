"""Durable PDF queue consumer, independent of AI configuration."""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator
from app.worker import StrictModel, SafeFailure, NoRedirect, post_json

MAX_BYTES = 10485760
MAX_OUTPUT = 2000000
Title = Annotated[str, StringConstraints(min_length=1, max_length=500)]


class PdfUnit(StrictModel):
    title: Title
    startPage: Annotated[int, Field(ge=1, le=500)]
    endPage: Annotated[int, Field(ge=1, le=500)]


class PdfResult(StrictModel):
    pageCount: Annotated[int, Field(ge=1, le=500)]
    title: Title
    units: Annotated[list[PdfUnit], Field(min_length=1, max_length=500)]
    textExcerpt: Annotated[str, Field(max_length=12000)]
    analysisOutline: Annotated[str, Field(max_length=12000)]
    warnings: Annotated[list[Literal['NO_TEXT','NO_OUTLINE','TRUNCATED_TEXT','INVALID_OUTLINE']], Field(max_length=4)]

    @model_validator(mode='after')
    def coverage(self):
        next_page = 1
        if not self.title.strip() or len(set(self.warnings)) != len(self.warnings):
            raise ValueError('Invalid result')
        for unit in self.units:
            if not unit.title.strip() or unit.startPage != next_page or unit.endPage < unit.startPage:
                raise ValueError('Invalid coverage')
            next_page = unit.endPage + 1
        if next_page != self.pageCount + 1:
            raise ValueError('Invalid coverage')
        return self


def parse_isolated(data, filename, timeout=30):
    if len(data) > MAX_BYTES:
        raise SafeFailure('FILE_TOO_LARGE')
    # No service keys, OpenAI keys, proxy variables, or Python import overrides.
    env = {k: os.environ[k] for k in ('SystemRoot','WINDIR') if k in os.environ}
    parser = str(Path(__file__).with_name('pdf_parser.py').resolve())
    with tempfile.TemporaryFile() as output:
        try:
            completed = subprocess.run([sys.executable,'-I',parser,filename[:200]], input=data, stdout=output,
                                       stderr=subprocess.DEVNULL, timeout=timeout, env=env)
        except subprocess.TimeoutExpired:
            raise SafeFailure('PARSER_TIMEOUT') from None
        if completed.returncode != 0:
            raise SafeFailure('PARSER_RESOURCE_LIMIT')
        output.seek(0)
        raw = output.read(MAX_OUTPUT+1)
    try:
        if len(raw) > MAX_OUTPUT:
            raise ValueError()
        reply = json.loads(raw)
        if 'error' in reply:
            code = reply['error']
            raise SafeFailure(code if code in {'FILE_TOO_LARGE','INVALID_PDF','ENCRYPTED_PDF','TOO_MANY_PAGES','INVALID_OUTPUT'} else 'INVALID_OUTPUT')
        return PdfResult.model_validate(reply['result']).model_dump()
    except SafeFailure:
        raise
    except Exception:
        raise SafeFailure('INVALID_OUTPUT') from None


@dataclass(frozen=True)
class PdfSettings:
    enabled: bool
    supabase_url: str
    service_key: str = field(repr=False)
    poll_seconds: float = 15

    @classmethod
    def from_env(cls):
        url = os.getenv('SUPABASE_URL','').strip().rstrip('/')
        key = os.getenv('SUPABASE_SERVICE_ROLE_KEY','').strip()
        return cls(os.getenv('PDF_ENABLED') == 'true' and bool(url and key), url, key)


class PdfWorker:
    def __init__(self, settings, transport=post_json, download=None):
        self.settings = settings
        self.transport = transport
        self.download = download or self.download_pdf

    def rpc(self, name, payload):
        return self.transport(self.settings.supabase_url+'/rest/v1/rpc/'+name, payload,
                              {'apikey':self.settings.service_key,'Authorization':'Bearer '+self.settings.service_key},15)

    def download_pdf(self, job):
        request = urllib.request.Request(self.settings.supabase_url+'/storage/v1/object/authenticated/learning-pdfs/'+job['storage_path'],
            headers={'apikey':self.settings.service_key,'Authorization':'Bearer '+self.settings.service_key})
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
                return response.read(MAX_BYTES+1)
        except Exception:
            raise SafeFailure('DOWNLOAD_FAILED') from None

    def run_once(self):
        if not self.settings.enabled:
            return False
        job = self.rpc('claim_pdf_import', {})
        if not job:
            return False
        final = {'p_id':job['id'],'p_lease_token':job['lease_token'],'p_result':None,'p_error_code':None}
        try:
            uuid = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
            path = job['storage_path']
            if not re.fullmatch(uuid+'/'+uuid+r'\.pdf',path) or path != job['user_id']+'/'+job['id']+'.pdf':
                raise SafeFailure('INVALID_STORAGE_PATH')
            data = self.download(job)
            if len(data) > MAX_BYTES:
                raise SafeFailure('FILE_TOO_LARGE')
            if len(data) != job['file_size'] or hashlib.sha256(data).hexdigest() != job['content_sha256']:
                raise SafeFailure('HASH_MISMATCH')
            final['p_result'] = parse_isolated(data,job['filename'])
        except SafeFailure as exc:
            final['p_error_code'] = str(exc)
        except Exception:
            final['p_error_code'] = 'PDF_PROCESSING_FAILED'
        return self.rpc('finish_pdf_import',final) is True

    def run(self, stop: threading.Event):
        while self.settings.enabled and not stop.is_set():
            try:
                self.run_once()
            except Exception:
                pass  # Preserve lease recovery without logging content or credentials.
            stop.wait(self.settings.poll_seconds)
