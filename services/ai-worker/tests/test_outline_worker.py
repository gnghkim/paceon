"""Outline import: what is sent, what is accepted, and what is stored when it fails."""

import json
import threading
import unittest

from app.outline_worker import OutlineWorker, validate_output
from app.worker import SafeFailure, Settings


def settings(**kwargs):
    base = dict(
        enabled=True,
        supabase_url="https://db.example",
        service_key="service",
        api_key="provider",
        model="test-model",
        poll_seconds=0.01,
    )
    base.update(kwargs)
    return Settings(**base)


GOOD = {
    "found": True,
    "title": "업무 자동화 실전",
    "kind": "COURSE",
    "unitLabel": "강",
    "units": [
        {"title": "시작하기", "minutes": None, "section": True},
        {"title": "강의 소개", "minutes": 21, "section": False},
        {"title": "수업 자료", "minutes": None, "section": False},
    ],
    "plan": {"dailyUnits": 2, "minutesPerUnit": 20, "reason": "하루 60분 안에 20분짜리 두 강이 들어가요."},
}


def completed(body=None):
    return {
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(body or GOOD, ensure_ascii=False)}]}],
    }


JOB = {
    "id": "11111111-1111-4111-8111-111111111111",
    "lease_token": "22222222-2222-4222-8222-222222222222",
    "input": "커리큘럼\n1.\n강의 소개\n20:15",
    "page_title": "업무 자동화 실전",
    "context": {"freeMinutesByWeekday": [60, 60, 0, 60, 60, 120, 120]},
}


def worker(reply=None, job=None, transport=None):
    calls = {"rpc": [], "provider": []}
    claimed = JOB if job is None else job

    def fake(url, payload, headers, timeout):
        if url.endswith("/rpc/claim_material_import"):
            calls["rpc"].append(("claim", payload))
            return claimed
        if url.endswith("/rpc/finish_material_import"):
            calls["rpc"].append(("finish", payload))
            return True
        calls["provider"].append({"payload": payload, "headers": headers, "timeout": timeout})
        if transport:
            return transport(payload)
        return reply if reply is not None else completed()

    return OutlineWorker(settings(), transport=fake), calls


class Request(unittest.TestCase):
    def test_the_page_text_travels_as_data_inside_json(self):
        w, calls = worker()
        self.assertTrue(w.run_once())
        sent = calls["provider"][0]["payload"]
        self.assertIs(sent["store"], False)
        self.assertEqual(len(sent["input"]), 1)
        body = json.loads(sent["input"][0]["content"])
        self.assertEqual(body["pageText"], JOB["input"])
        self.assertEqual(body["pageTitle"], "업무 자동화 실전")
        self.assertEqual(body["context"], {"freeMinutesByWeekday": [60, 60, 0, 60, 60, 120, 120]})
        self.assertIn("untrusted data", sent["instructions"])

    def test_nothing_that_identifies_the_learner_or_the_row_is_sent(self):
        w, calls = worker()
        w.run_once()
        body = json.dumps(calls["provider"][0]["payload"], ensure_ascii=False)
        self.assertNotIn("11111111", body)
        self.assertNotIn("22222222", body)

    def test_the_schema_is_strict_and_bounded(self):
        w, calls = worker()
        w.run_once()
        schema = calls["provider"][0]["payload"]["text"]["format"]
        self.assertTrue(schema["strict"])
        self.assertEqual(schema["schema"]["properties"]["units"]["maxItems"], 600)

    def test_context_that_is_not_seven_sane_numbers_is_dropped_rather_than_sent(self):
        for context in [None, "x", {}, {"freeMinutesByWeekday": [60] * 6}, {"freeMinutesByWeekday": [60] * 6 + [True]},
                        {"freeMinutesByWeekday": [60] * 6 + [99999]}, {"freeMinutesByWeekday": "60,60", "secret": "token"}]:
            w, calls = worker(job={**JOB, "context": context})
            w.run_once()
            body = json.loads(calls["provider"][0]["payload"]["input"][0]["content"])
            self.assertEqual(body["context"], {"freeMinutesByWeekday": None}, repr(context))

    def test_a_good_answer_is_written_back_against_the_lease(self):
        w, calls = worker()
        w.run_once()
        kind, payload = calls["rpc"][-1]
        self.assertEqual(kind, "finish")
        self.assertEqual(payload["p_id"], JOB["id"])
        self.assertEqual(payload["p_lease_token"], JOB["lease_token"])
        self.assertIsNone(payload["p_error_code"])
        self.assertEqual(payload["p_result"]["units"][1], {"title": "강의 소개", "minutes": 21, "section": False})

    def test_nothing_is_claimed_when_the_queue_is_empty(self):
        w, calls = worker(job={})
        self.assertFalse(w.run_once())
        self.assertEqual(calls["provider"], [])

    def test_a_disabled_worker_never_touches_the_database(self):
        calls = []
        w = OutlineWorker(settings(enabled=False), transport=lambda *a, **k: calls.append(a) or None)
        self.assertFalse(w.run_once())
        self.assertEqual(calls, [])


class Failures(unittest.TestCase):
    def report(self, reply=None, transport=None, job=None):
        w, calls = worker(reply=reply, transport=transport, job=job)
        w.run_once()
        return dict(calls["rpc"][-1][1])

    def test_each_failure_is_stored_as_a_fixed_code(self):
        for reply, code in [
            ({"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal"}]}]}, "PROVIDER_REFUSAL"),
            ({"status": "incomplete"}, "PROVIDER_INCOMPLETE"),
            ({"status": "failed"}, "PROVIDER_ERROR"),
            ({"status": "completed", "output": []}, "INVALID_OUTPUT"),
            ("not a dict", "INVALID_OUTPUT"),
        ]:
            payload = self.report(reply=reply)
            self.assertIsNone(payload["p_result"], repr(reply))
            self.assertEqual(payload["p_error_code"], code)

    def test_a_provider_exception_never_leaks_its_text(self):
        def boom(_payload):
            raise RuntimeError("secret provider detail sk-123")

        payload = self.report(transport=boom)
        self.assertEqual(payload["p_error_code"], "PROVIDER_ERROR")
        self.assertNotIn("secret", json.dumps(payload))

    def test_an_unusable_page_is_failed_before_the_provider(self):
        for text in [None, "", 123, "x" * 60001]:
            w, calls = worker(job={**JOB, "input": text})
            w.run_once()
            self.assertEqual(calls["provider"], [], repr(text)[:20])
            self.assertEqual(calls["rpc"][-1][1]["p_error_code"], "INVALID_INPUT")

    def test_an_answer_outside_the_schema_is_not_stored(self):
        for change in [
            {"kind": "NOVEL"},
            {"unitLabel": ""},
            {"units": [{"title": "", "minutes": None, "section": False}]},
            {"units": [{"title": "a", "minutes": 0, "section": False}]},
            {"units": [{"title": "a", "minutes": 2000, "section": False}]},
            {"units": [{"title": "a", "minutes": 12.5, "section": False}]},
            {"units": [{"title": "a", "minutes": 5, "section": False, "url": "https://evil"}]},
            {"units": [{"title": "a", "minutes": None, "section": False}] * 601},
            {"plan": {"dailyUnits": 0, "minutesPerUnit": 20, "reason": "x"}},
            {"plan": {"dailyUnits": 2, "minutesPerUnit": 20, "reason": ""}},
            {"extra": 1},
        ]:
            payload = self.report(reply=completed({**GOOD, **change}))
            self.assertEqual(payload["p_error_code"], "INVALID_OUTPUT", repr(change)[:60])
            self.assertIsNone(payload["p_result"])


class Output(unittest.TestCase):
    def test_an_outline_of_only_headings_is_treated_as_not_found(self):
        body = {**GOOD, "units": [{"title": "Part 1", "minutes": None, "section": True}]}
        result = validate_output(json.dumps(body))
        self.assertIs(result["found"], False)
        self.assertEqual(result["units"], [])

    def test_not_found_never_carries_units(self):
        result = validate_output(json.dumps({**GOOD, "found": False}))
        self.assertEqual(result["units"], [])

    def test_a_huge_answer_is_rejected_before_parsing(self):
        with self.assertRaises(SafeFailure):
            validate_output("x" * 200_001)

    def test_titles_are_trimmed(self):
        body = {**GOOD, "title": "  강의  ", "units": [{"title": "  1강  ", "minutes": 5, "section": False}]}
        result = validate_output(json.dumps(body, ensure_ascii=False))
        self.assertEqual(result["title"], "강의")
        self.assertEqual(result["units"][0]["title"], "1강")


class Loop(unittest.TestCase):
    def test_stopping_wakes_the_poll_wait(self):
        stop = threading.Event()
        w, _ = worker(job={})
        thread = threading.Thread(target=w.run, args=(stop,))
        thread.start()
        stop.set()
        thread.join(timeout=5)
        self.assertFalse(thread.is_alive())


if __name__ == "__main__":
    unittest.main()
