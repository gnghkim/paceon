"""Run one real local PDF job. stdin JSON: {supabase_url, servicekey}."""
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.pdf_worker import PdfSettings, PdfWorker


if __name__ == '__main__':
    config = json.load(sys.stdin)
    if urlparse(config['supabase_url']).hostname not in {'localhost','127.0.0.1','host.docker.internal'}:
        raise SystemExit('Fixture requires local Supabase')
    worker = PdfWorker(PdfSettings(True, config['supabase_url'].rstrip('/'), config['servicekey']))
    print(json.dumps({'finishAccepted':worker.run_once()}))
