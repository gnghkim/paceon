# AI worker

FastAPI keeps `/health` as a liveness-only check. Its lifespan starts one polling
consumer only when `AI_ENABLED=true` and every required setting is present.
Missing settings leave the health endpoint available without DB or provider calls.

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
