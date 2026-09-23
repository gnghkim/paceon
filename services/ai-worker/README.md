# AI worker

FastAPI keeps `/health` as a liveness-only check. Its lifespan starts one polling
AI consumer only when `AI_ENABLED=true` and every required setting is present.
Missing settings leave the health endpoint available without DB or provider calls.

The same AI switch also enables learning feedback and speech inference. Speech
cleanup continues whenever the Supabase URL and service key are configured, even
with AI disabled or an absent provider key. Each poll rotates through at most three
cleanup candidates; individual storage failures retain their durable reservations
and do not prevent other deletions or queued inference. Speech uses
`claim_speech_job`, `checkpoint_speech_prompt`, and `finish_speech_job` leases.
Apply the speech migrations before enabling it. Prompt text and Korean meaning
are checkpointed before TTS; retries reuse the fixed private `sample.mp3` object.
Defaults are `gpt-4o-mini-tts` / `marin` and `gpt-4o-mini-transcribe`; sentence and
feedback generation use the configured `OPENAI_MODEL`.

Recordings are checked against stored size/SHA-256, limited to 10 MiB and 60
seconds, decoded using ffmpeg, and converted to mono 16 kHz PCM WAV before
transcription. WAV, WebM, Ogg, MP4 and MP3 signatures select a fixed demuxer;
successful decoding is required. A credential-free isolated launcher permits
only local-file input protocols and caps wall time at 20 seconds. Linux also
limits address space to 512 MiB, CPU to 15 seconds, output to 2 MB and open files
to 32. The Docker image includes ffmpeg; local runs must install it separately.
Audio shorter than 0.5 seconds or with insufficient non-silent samples is rejected
before provider calls. This is a silence filter, not speech or pronunciation
assessment. Feedback addresses recognized wording and grammar; original
transcripts are preserved. Raw audio, text, provider errors and secrets are never
logged. Cleanup uses reserved DB candidates and acknowledges only successful
Storage deletion; the DB ledger recovers objects uploaded after a deletion race.

PDF imports use an independent `PDF_ENABLED=true` consumer. It only requires
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, never an OpenAI key or model.
Apply the PDF import migration before enabling it. The worker claims a leased
job, downloads its fixed private `learning-pdfs` object, checks size and SHA-256,
and runs a credential-free isolated Python subprocess. The parser has a 30-second
wall timeout and Linux limits of 20 CPU seconds, 384 MiB address space, and 2 MB
output. Socket/process operations are denied by a Python audit hook; this is
defense in depth, not a general-purpose native-code sandbox. pypdf performs no
OCR, JavaScript execution, remote fetching, or password decryption.

Top-level bookmarks form deterministic contiguous page units; missing or invalid
bookmarks fall back to the whole document. Text samples only the first 10 pages,
bounded to 12,000 characters with explicit sampling disclosure. Scans remain
reviewable with `NO_TEXT`; encrypted, malformed, oversize, or over-500-page PDFs
fail with safe codes. Neither input bytes/text nor credentials are logged.

The pinned dependency is [pypdf 6.18.0](https://pypi.org/project/pypdf/6.18.0/),
verified against official PyPI on 2026-09-13, without optional crypto/OCR extras.
Implementation references: [PdfReader](https://pypdf.readthedocs.io/en/stable/modules/PdfReader.html)
and [text extraction limitations](https://pypdf.readthedocs.io/en/stable/user/extract-text.html).
Use a virtual environment for local execution because the subprocess uses `-I`
and excludes user-site packages.

`tests/create_pdf_fixture.py OUTPUT.pdf` generates a real 6-page text/bookmark PDF.
`tests/run_pdf_db_fixture.py` reads stdin JSON `{supabase_url, servicekey}` and
processes one real local queued PDF, including Storage download and subprocess
parsing. It emits only `finishAccepted`; mount tests into the image to use it.
Keep the daemon disabled while the one-job integration helper is running.

## Configure and run

Copy `.env.example` to `.env` in this directory. Set the Supabase service-role key,
OpenAI API key and an explicit `OPENAI_MODEL` supporting Responses strict structured
outputs. There is deliberately no model default. Apply the `ai_jobs` migration first.
Never use these credentials in browser/public environment variables.

From the repository root:

```powershell
docker compose --env-file services/ai-worker/.env -f docker/docker-compose.yml up --build -d
```

For local Supabase, the container URL is `http://host.docker.internal:55321`.
For a local Python process use `http://127.0.0.1:55321`, Python 3.13, install
`requirements.lock`, export the settings into the process environment and run
`python -m uvicorn app.main:app` from this directory. The application does not
automatically load `.env` files; Docker's `--env-file` handles that explicitly.

## Polling cost

Consumers ask their queue for work every `AI_POLL_SECONDS` seconds (default 15).
Each consumer keeps its connection to Supabase between asks instead of opening a
new one, because a TLS handshake costs several kilobytes while an empty answer
costs a few hundred bytes. A connection left idle longer than 30 seconds, one the
server asks to close, and one that failed are all dropped rather than reused; the
next ask opens a fresh connection. Seven consumers at three seconds moved about a
gigabyte a day with no work queued at all.

## Processing and verification

Only `claim_ai_job` and `finish_ai_job` service-role RPCs access jobs. The database
owns retries/leases. A failed compare-and-set is never treated as persisted success.
Transport failures leave unfinished leases for database recovery. Shutdown wakes
the polling wait and finishes the current bounded request cycle; Compose allows
90 seconds for the 15-second claim, 45-second provider and 15-second finish calls.
Provider requests use the fixed Responses URL, `store:false`, no tools and a strict
JSON schema generated from the same Pydantic model used to validate output.
Input excludes undeclared fields, and output sizes, strings, numbers and arrays
are bounded. Refusal/incomplete/invalid/provider failures store safe codes only.

Run tests with the built image (from repository root):

```powershell
docker compose -f docker/docker-compose.yml build ai-worker
docker compose -f docker/docker-compose.yml run --rm -v "${PWD}/services/ai-worker/tests:/app/tests" ai-worker python -m unittest discover -s tests -v
```

The local HTTP fixture exercises claim → provider HTTP → Pydantic validation →
lease-token finish without a model key. Fixtures never replace production inference.
Tests do not establish real provider compatibility or result quality; an actual
paid provider execution still needs separately configured credentials and model.

`tests/run_db_fixture.py` is a separate local integration helper, excluded from the
image. It reads stdin JSON with `supabase_url` and `servicekey`, claims one real
local queued job and substitutes only the provider response. Its optional argument
is `success`, `refusal`, `incomplete`, `invalid` or `error`. It emits only fixture mode
and whether the DB accepted the finish. The repository integration test invokes it
against isolated test records; never point it at a queue containing real user work.

Protocol reference: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
(Responses `text.format`, strict schema, refusal and incomplete handling).
