import asyncio
import copy
import json
import unittest
from unittest.mock import patch

from app import main
from app.worker import SafeFailure, Settings


RESULT = {"summary": "문장을 잘 작성했습니다.", "corrections": [{"original": "I goes.", "revised": "I go.", "reason": "주어에 맞는 동사를 사용합니다."}], "expressions": [{"phrase": "take a walk", "meaning": "산책하다", "example": "I take a walk."}], "nextPrompt": "Describe your morning."}
CONTEXT = {"kind": "WRITING_REPLY", "prompt": "Daily life", "messages": [{"id": "b1cbf843-84a3-460f-aa07-d6e91098a80f", "role": "USER", "content": "I goes."}]}


def response(result=None):
    return {"id": "resp_fixture", "model": "fixture-model", "status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(RESULT if result is None else result)}]}], "usage": {"input_tokens": 50, "output_tokens": 30}}


class LearningWorkerTests(unittest.TestCase):
    def worker(self, *, enabled=True, context=None, provider=None, finish=True):
        from app.learning_worker import LearningWorker
        calls = []
        context = copy.deepcopy(CONTEXT if context is None else context)
        def transport(url, payload, headers, timeout):
            calls.append((url, payload, headers, timeout))
            if url.endswith("claim_learning_job"):
                return {"id": "job", "lease_token": "lease", "kind": context.get("kind"), "input": context}
            if url.endswith("finish_learning_job"):
                return finish
            if isinstance(provider, Exception):
                raise provider
            return response() if provider is None else provider
        return LearningWorker(Settings(enabled, "http://db", "service-fixture", "provider-fixture", "configured-model"), transport), calls

    def test_durable_completion_and_structured_untrusted_context(self):
        for kind in ("WRITING_REPLY", "STUDY_SUMMARY"):
            worker, calls = self.worker(context={**CONTEXT, "kind": kind})
            self.assertTrue(worker.run_once())
            self.assertEqual(len(calls), 3)
            body = calls[1][1]
            self.assertEqual(body["input"][0]["role"], "user")
            self.assertEqual(json.loads(body["input"][0]["content"])["messages"], CONTEXT["messages"])
            self.assertIn("untrusted", body["instructions"])
            self.assertTrue(body["text"]["format"]["strict"])
            self.assertFalse(body["store"])
            self.assertNotIn("tools", body)
            self.assertEqual(calls[0][2]["Authorization"], "Bearer service-fixture")
            self.assertEqual(calls[1][2]["Authorization"], "Bearer provider-fixture")
            final = calls[-1][1]
            self.assertEqual(final, {"p_job_id": "job", "p_lease_token": "lease", "p_output": RESULT, "p_error_code": None, "p_model": "fixture-model", "p_provider_response_id": "resp_fixture", "p_input_tokens": 50, "p_output_tokens": 30})

    def test_disabled_and_stale_lease(self):
        worker, calls = self.worker(enabled=False)
        self.assertFalse(worker.run_once())
        self.assertEqual(calls, [])
        worker, calls = self.worker(finish=False)
        self.assertFalse(worker.run_once())
        self.assertEqual(len(calls), 3)

    def test_invalid_or_oversize_context_never_reaches_provider(self):
        cases = [{**CONTEXT, "extra": "private"}, {**CONTEXT, "messages": []}, {**CONTEXT, "messages": [{**CONTEXT["messages"][0], "role": "SYSTEM"}]}, {**CONTEXT, "prompt": "x" * 20000}]
        for context in cases:
            with self.subTest(context=str(context)[:50]):
                worker, calls = self.worker(context=context)
                worker.run_once()
                self.assertEqual(len(calls), 2)
                self.assertEqual(calls[-1][1]["p_error_code"], "INVALID_INPUT")

    def test_output_limits_and_types(self):
        from app.learning_worker import validate_output
        self.assertEqual(validate_output(json.dumps(RESULT)), RESULT)
        for change in [{"corrections": RESULT["corrections"] * 4}, {"expressions": RESULT["expressions"] * 11}, {"summary": " "}, {"summary": "x" * 2001}, {"nextPrompt": 4}, {"extra": True}]:
            with self.subTest(change=list(change)), self.assertRaises(SafeFailure):
                validate_output(json.dumps({**RESULT, **change}))

    def test_provider_failures_are_sanitized(self):
        fixtures = [(RuntimeError("private secret"), "PROVIDER_ERROR"), (SafeFailure("private secret"), "PROVIDER_ERROR"), ({"status": "incomplete"}, "PROVIDER_INCOMPLETE"), ({"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal"}]}]}, "PROVIDER_REFUSAL"), ({"status": "completed", "output": [None]}, "INVALID_OUTPUT"), (response({**RESULT, "summary": ""}), "INVALID_OUTPUT")]
        for fixture, code in fixtures:
            with self.subTest(code=code):
                worker, calls = self.worker(provider=fixture)
                worker.run_once()
                self.assertEqual(calls[-1][1]["p_error_code"], code)
                self.assertIsNone(calls[-1][1]["p_output"])
                self.assertNotIn("secret", json.dumps(calls[-1][1]))

    def test_usage_and_provenance_bounds(self):
        fixture = response()
        fixture["usage"] = {"input_tokens": True, "output_tokens": -1}
        worker, calls = self.worker(provider=fixture)
        worker.run_once()
        self.assertIsNone(calls[-1][1]["p_input_tokens"])
        self.assertIsNone(calls[-1][1]["p_output_tokens"])
        del fixture["id"]
        worker, calls = self.worker(provider=fixture)
        worker.run_once()
        self.assertEqual(calls[-1][1]["p_error_code"], "INVALID_OUTPUT")

    def test_correction_must_quote_user_writing(self):
        fixture = response({**RESULT, "corrections": [{"original": "invented writing", "revised": "Better writing", "reason": "수정"}]})
        worker, calls = self.worker(provider=fixture)
        worker.run_once()
        self.assertEqual(calls[-1][1]["p_error_code"], "INVALID_OUTPUT")
        self.assertIsNone(calls[-1][1]["p_output"])

    def test_lifespan_starts_learning_consumer_under_existing_switch(self):
        async def check(enabled):
            settings = Settings(enabled, "http://db", "service", "provider", "model")
            with patch("app.main.Settings.from_env", return_value=settings), patch("app.main.Worker"), patch("app.main.LearningWorker") as worker, patch("app.main.PdfSettings.from_env") as pdf:
                pdf.return_value.enabled = False
                async with main.lifespan(main.app):
                    if enabled:
                        worker.assert_called_once_with(settings)
                    else:
                        worker.assert_not_called()
        asyncio.run(check(True))
        asyncio.run(check(False))
