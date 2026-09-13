"""Explicit local integration harness: real DB RPC, fixture provider; never deployed.

Enqueue a test job first, pass stdin JSON {supabase_url, servicekey}, then run
python tests/run_db_fixture.py [success|refusal|incomplete|invalid|error].
The harness claims the next queued job, so use only an isolated local test database.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.worker import Settings, Worker, post_json


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "success"
    if mode not in {"success", "refusal", "incomplete", "invalid", "error"}:
        raise SystemExit("Unknown fixture mode")
    config = json.load(sys.stdin)
    url = config["supabase_url"]
    # Restrict harness to explicitly local DBs, never real production queues.
    from urllib.parse import urlparse
    if urlparse(url).hostname not in {"127.0.0.1", "localhost", "host.docker.internal"}:
        raise SystemExit("Fixture requires local Supabase")
    def transport(endpoint, payload, headers, timeout):
        if endpoint != "https://api.openai.com/v1/responses":
            return post_json(endpoint, payload, headers, timeout)
        if mode == "error":
            raise RuntimeError("fixture provider failed")
        if mode == "incomplete":
            return {"status": "incomplete"}
        if mode == "refusal":
            return {"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal", "refusal": "fixture refusal"}]}]}
        if payload["text"]["format"]["name"] == "book_analysis":
            result = {"difficulty": "MODERATE", "estimatedMinutes": 120, "importance": "MEDIUM", "confidence": 0.3,
                      "summary": "메타데이터만으로 추정한 테스트 결과입니다.", "reasons": ["본문을 확인하지 않아 근거가 제한적입니다."]}
        else:
            result = {"summary": "최근 기록을 확인했습니다. 다음 학습 범위를 확인하세요.",
                      "suggestions": ["학습할 페이지를 미리 정해 보세요."], "confidence": 0.5}
        if mode == "invalid":
            result["confidence"] = 2
        return {"id": "resp_local_fixture", "model": "local-fixture", "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(result)}]}],
                "usage": {"input_tokens": 10, "output_tokens": 10}}
    settings = Settings(True, url.rstrip("/"), config["servicekey"], "fixture-not-a-key", "local-fixture")
    print(json.dumps({"fixtureMode": mode, "finishAccepted": Worker(settings, transport).run_once()}))


if __name__ == "__main__":
    main()
