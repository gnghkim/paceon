import asyncio
import json
import unittest
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from app import main


COACH = {"summary": "기록을 확인했습니다. 다음 학습을 이어가세요.", "suggestions": ["남은 범위를 확인하세요."], "confidence": 0.5}
BOOK = {"difficulty": "MODERATE", "estimatedMinutes": 120, "importance": "MEDIUM", "confidence": 0.3, "summary": "메타데이터만으로 추정했습니다.", "reasons": ["본문과 목차가 없습니다."]}
CONTEXT = {"schemaVersion": 1, "kind": "COACH", "book": {"title": "책", "authors": [], "totalPages": 100, "description": ""}, "outline": "", "facts": {"today": "2026-09-13", "completedPages": 10, "remainingPages": 90, "progressPercent": 10, "planMode": None, "forecastDate": None, "targetDate": None, "replanRequired": False, "recentLearningPages": 10, "recentLearningMinutes": 30, "validTimedSamples": 1}, "sourceRevision": "a" * 64}


def response(result=COACH):
    return {"id": "resp_fixture", "model": "fixture-model", "status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(result)}]}], "usage": {"input_tokens": 50, "output_tokens": 30}}


class WorkerTests(unittest.TestCase):
    def worker(self, enabled=True, finish=True, provider=None):
        from app.worker import Settings, Worker
        calls = []
        job = {"id": "job", "kind": "COACH", "lease_token": "lease", "input": CONTEXT}
        def transport(url, payload, headers, timeout):
            calls.append((url, payload, headers, timeout))
            if url.endswith("claim_ai_job"):
                return job
            if url.endswith("finish_ai_job"):
                return finish
            return response() if provider is None else provider
        return Worker(Settings(enabled, "http://db", "service-secret", "provider-secret", "configured-model", 3), transport), calls

    def test_feature_present(self):
        self.assertTrue(hasattr(main, "lifespan"), "worker must start through FastAPI lifespan")

    def test_disabled_never_contacts_database_or_provider(self):
        worker, calls = self.worker(False)
        self.assertFalse(worker.run_once())
        self.assertEqual(calls, [])

    def test_model_has_no_default_and_missing_config_disables(self):
        from app.worker import Settings
        with patch.dict("os.environ", {"AI_ENABLED": "true"}, clear=True):
            config = Settings.from_env()
        self.assertFalse(config.enabled)
        self.assertEqual(config.model, "")

    def test_structured_request_and_lease_persistence(self):
        worker, calls = self.worker()
        self.assertTrue(worker.run_once())
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[0][2]["Authorization"], "Bearer service-secret")
        url, body, headers, timeout = calls[1]
        self.assertEqual(url, "https://api.openai.com/v1/responses")
        self.assertEqual(headers["Authorization"], "Bearer provider-secret")
        self.assertEqual(timeout, 45)
        self.assertFalse(body["store"])
        self.assertEqual(body["model"], "configured-model")
        self.assertNotIn("tools", body)
        self.assertTrue(body["text"]["format"]["strict"])
        self.assertFalse(body["text"]["format"]["schema"]["additionalProperties"])
        final = calls[2][1]
        self.assertEqual(final["p_lease_token"], "lease")
        self.assertEqual(final["p_result"], COACH)
        self.assertEqual(final["p_provider_response_id"], "resp_fixture")
        self.assertEqual(final["p_model"], "fixture-model")
        self.assertEqual(final["p_input_tokens"], 50)

    def test_stale_lease_is_not_reported_as_success(self):
        worker, calls = self.worker(finish=False)
        self.assertFalse(worker.run_once())
        self.assertEqual(len(calls), 3)

    def test_refusal_incomplete_invalid_and_schema_are_safe_failures(self):
        cases = [({"status": "incomplete"}, "PROVIDER_INCOMPLETE"),
                 ({"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal", "refusal": "secret"}]}]}, "PROVIDER_REFUSAL"),
                 (response({**COACH, "confidence": 2}), "INVALID_OUTPUT"),
                 (response({**COACH, "extra": "secret"}), "INVALID_OUTPUT"),
                 ({"status": "completed", "output": []}, "INVALID_OUTPUT")]
        for fixture, code in cases:
            with self.subTest(code=code):
                worker, calls = self.worker(provider=fixture)
                worker.run_once()
                payload = calls[-1][1]
                self.assertEqual(payload["p_error_code"], code)
                self.assertIsNone(payload["p_result"])
                self.assertNotIn("secret", json.dumps(payload))

    def test_book_bounds_and_strict_types(self):
        from app.worker import validate_output, SafeFailure
        self.assertEqual(validate_output("BOOK_ANALYSIS", json.dumps(BOOK)), BOOK)
        for altered in [{"estimatedMinutes": 0}, {"estimatedMinutes": True}, {"confidence": "0.5"}, {"reasons": []}, {"summary": ""}, {"summary": " "}]:
            with self.subTest(altered=altered), self.assertRaises(SafeFailure):
                validate_output("BOOK_ANALYSIS", json.dumps({**BOOK, **altered}))

    def test_shutdown_wakes_poll_wait(self):
        worker, _ = self.worker()
        stop = threading.Event()
        ran = threading.Event()
        with patch.object(worker, "run_once", side_effect=lambda: ran.set()):
            thread = threading.Thread(target=worker.run, args=(stop,))
            thread.start()
            try:
                self.assertTrue(ran.wait(1))
            finally:
                stop.set()
                thread.join(1)
            self.assertFalse(thread.is_alive())

    def test_provider_exception_does_not_persist_exception_text(self):
        worker, calls = self.worker()
        original = worker.transport
        def failing(url, payload, headers, timeout):
            if url.endswith("responses"):
                raise RuntimeError("provider-secret user-input")
            return original(url, payload, headers, timeout)
        worker.transport = failing
        worker.run_once()
        self.assertEqual(calls[-1][1]["p_error_code"], "PROVIDER_ERROR")
        self.assertNotIn("secret", json.dumps(calls[-1][1]))

    def test_missing_provenance_fails_before_persistence(self):
        for field in ["id", "model"]:
            fixture = response()
            del fixture[field]
            worker, calls = self.worker(provider=fixture)
            worker.run_once()
            self.assertEqual(calls[-1][1]["p_error_code"], "INVALID_OUTPUT")
            self.assertIsNone(calls[-1][1]["p_result"])

    def test_invalid_input_does_not_call_provider(self):
        worker, calls = self.worker()
        original = worker.transport
        def invalid(url, payload, headers, timeout):
            value = original(url, payload, headers, timeout)
            if url.endswith("claim_ai_job"):
                value["input"] = {**CONTEXT, "email": "private"}
            return value
        worker.transport = invalid
        worker.run_once()
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[-1][1]["p_error_code"], "INVALID_INPUT")

    def test_lifespan_disabled_and_health_contract(self):
        async def check():
            with patch.dict("os.environ", {"AI_ENABLED": "false"}, clear=True), patch("app.main.Worker") as worker:
                async with main.lifespan(main.app):
                    worker.assert_not_called()
        asyncio.run(check())
        from fastapi import Response
        health_response = Response()
        self.assertEqual(main.health(health_response).model_dump(), {"status": "ok", "service": "ai-worker", "check": "liveness"})
        self.assertEqual(health_response.headers["Cache-Control"], "no-store")


class HttpFixtureTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.mode = "success"
        outer = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.requests.append((self.path, payload, self.headers["Authorization"]))
                if self.path.endswith("claim_ai_job"):
                    result = {"id": "job", "kind": "COACH", "lease_token": "lease", "input": CONTEXT}
                elif self.path.endswith("finish_ai_job"):
                    result = True
                else:
                    result = response()
                if outer.mode == "redirect":
                    self.send_response(307)
                    self.send_header("Location", outer.url + "/leaked")
                    self.end_headers()
                    return
                status = 500 if outer.mode == "error" else 200
                raw = (b"x" * 262145 if outer.mode == "oversize" else json.dumps(result).encode())
                self.send_response(status)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:" + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_http_claim_provider_validate_finish_end_to_end(self):
        from app.worker import Settings, Worker, post_json
        def transport(url, payload, headers, timeout):
            # Only the test remaps the fixed production provider endpoint to a fixture.
            if url == "https://api.openai.com/v1/responses":
                url = self.url + "/responses"
            return post_json(url, payload, headers, timeout)
        worker = Worker(Settings(True, self.url, "service-fixture", "provider-fixture", "fixture-model"), transport)
        self.assertTrue(worker.run_once())
        self.assertEqual([r[0] for r in self.requests], ["/rest/v1/rpc/claim_ai_job", "/responses", "/rest/v1/rpc/finish_ai_job"])
        self.assertEqual(self.requests[1][2], "Bearer provider-fixture")
        self.assertEqual(self.requests[2][1]["p_result"], COACH)

    def test_http_errors_oversize_and_redirect_rejected(self):
        from app.worker import post_json, SafeFailure
        for mode, code in [("error", "PROVIDER_ERROR"), ("oversize", "RESPONSE_TOO_LARGE"), ("redirect", "PROVIDER_ERROR")]:
            with self.subTest(mode=mode):
                self.mode = mode
                before = len(self.requests)
                with self.assertRaises(SafeFailure) as exc:
                    post_json(self.url, {}, {"Authorization": "Bearer fixture"}, 2)
                self.assertEqual(str(exc.exception), code)
                self.assertEqual(len(self.requests), before + 1)


if __name__ == "__main__":
    unittest.main()
