"""Vocabulary lookup: what is sent, what is accepted, and what happens when it fails."""

import json
import threading
import unittest

from app.vocab_worker import VocabWorker, validate_output
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


def completed(meaning="미루다", examples=("I put it off.", "Do not put it off.")):
    return {
        "status": "completed",
        "model": "test-model",
        "id": "resp_1",
        "output": [
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": json.dumps({"meaning": meaning, "examples": list(examples)}, ensure_ascii=False),
                    }
                ],
            }
        ],
    }


def worker(reply=None, job=None, transport=None):
    calls = {"rpc": [], "provider": []}
    claimed = job if job is not None else {
        "id": "11111111-1111-4111-8111-111111111111",
        "phrase": "put off",
        "lease_token": "22222222-2222-4222-8222-222222222222",
    }

    def fake(url, payload, headers, timeout):
        if url.endswith("/rpc/claim_expression_lookup"):
            calls["rpc"].append(("claim", payload))
            return claimed
        if url.endswith("/rpc/finish_expression_lookup"):
            calls["rpc"].append(("finish", payload))
            return True
        calls["provider"].append({"payload": payload, "headers": headers})
        if transport:
            return transport(payload)
        return reply if reply is not None else completed()

    return VocabWorker(settings(), transport=fake), calls


class Lookup(unittest.TestCase):
    def test_only_the_saved_word_is_sent_to_the_provider(self):
        w, calls = worker()
        self.assertTrue(w.run_once())
        sent = calls["provider"][0]["payload"]
        self.assertEqual(sent["input"], [{"role": "user", "content": "put off"}])
        self.assertIs(sent["store"], False)
        # Nothing about the learner or their records rides along.
        body = json.dumps(sent, ensure_ascii=False)
        self.assertNotIn("11111111", body, "the row id must not reach the provider")
        self.assertNotIn("22222222", body, "the lease must not reach the provider")

    def test_a_good_answer_is_written_back_against_the_lease(self):
        w, calls = worker()
        w.run_once()
        kind, payload = calls["rpc"][-1]
        self.assertEqual(kind, "finish")
        self.assertEqual(payload["p_id"], "11111111-1111-4111-8111-111111111111")
        self.assertEqual(payload["p_lease_token"], "22222222-2222-4222-8222-222222222222")
        self.assertEqual(payload["p_meaning"], "미루다")
        self.assertEqual(payload["p_examples"], ["I put it off.", "Do not put it off."])
        self.assertIs(payload["p_failed"], False)

    def test_the_schema_asks_for_a_meaning_and_short_examples(self):
        w, calls = worker()
        w.run_once()
        schema = calls["provider"][0]["payload"]["text"]["format"]
        self.assertTrue(schema["strict"])
        properties = schema["schema"]["properties"]
        self.assertIn("meaning", properties)
        self.assertEqual(properties["examples"]["maxItems"], 3)
        self.assertEqual(properties["examples"]["minItems"], 1)

    def test_nothing_is_claimed_when_the_queue_is_empty(self):
        w, calls = worker(job={})
        self.assertFalse(w.run_once())
        self.assertEqual(calls["provider"], [], "an empty queue never reaches the provider")
        self.assertEqual([kind for kind, _ in calls["rpc"]], ["claim"])

    def test_a_disabled_worker_never_touches_the_database(self):
        calls = []
        w = VocabWorker(settings(enabled=False), transport=lambda *a, **k: calls.append(a) or None)
        self.assertFalse(w.run_once())
        self.assertEqual(calls, [])


class Failures(unittest.TestCase):
    def report(self, reply=None, transport=None):
        w, calls = worker(reply=reply, transport=transport)
        w.run_once()
        return dict(calls["rpc"][-1][1])

    def test_a_refusal_or_an_incomplete_answer_is_reported_as_failed(self):
        for reply in [
            {"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal"}]}]},
            {"status": "incomplete"},
            {"status": "failed"},
            {"status": "completed", "output": []},
            "not a dict",
        ]:
            payload = self.report(reply=reply)
            self.assertIs(payload["p_failed"], True, repr(reply))
            self.assertIsNone(payload["p_meaning"])

    def test_an_answer_outside_the_schema_is_not_stored(self):
        for body in [
            {"meaning": "", "examples": ["x"]},
            {"meaning": "뜻", "examples": []},
            {"meaning": "뜻", "examples": ["a", "b", "c", "d"]},
            {"meaning": "뜻"},
            {"examples": ["a"]},
            {"meaning": "뜻", "examples": ["a"], "extra": 1},
        ]:
            reply = {
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(body)}]}],
            }
            self.assertIs(self.report(reply=reply)["p_failed"], True, repr(body))

    def test_a_provider_exception_never_leaks_into_the_report(self):
        def boom(_payload):
            raise RuntimeError("secret provider detail")

        payload = self.report(transport=boom)
        self.assertIs(payload["p_failed"], True)
        self.assertEqual(set(payload) - {"p_id", "p_lease_token"}, {"p_meaning", "p_examples", "p_failed"})

    def test_a_claim_without_a_usable_word_is_failed_before_the_provider(self):
        for phrase in [None, "", "   ", 123, "x" * 201]:
            w, calls = worker(job={"id": "11111111-1111-4111-8111-111111111111", "phrase": phrase, "lease_token": "t"})
            w.run_once()
            self.assertEqual(calls["provider"], [], repr(phrase))
            self.assertIs(calls["rpc"][-1][1]["p_failed"], True, repr(phrase))


class Output(unittest.TestCase):
    def test_a_huge_answer_is_rejected_before_parsing(self):
        with self.assertRaises(SafeFailure):
            validate_output(json.dumps({"meaning": "x" * 20000, "examples": ["a"]}))

    def test_surrounding_whitespace_is_trimmed(self):
        result = validate_output(json.dumps({"meaning": "  미루다  ", "examples": ["  I put it off.  "]}))
        self.assertEqual(result["meaning"], "미루다")
        self.assertEqual(result["examples"], ["I put it off."])


class Loop(unittest.TestCase):
    def test_stopping_wakes_the_poll_wait(self):
        stop = threading.Event()
        w, _ = worker(job={})
        thread = threading.Thread(target=w.run, args=(stop,))
        thread.start()
        stop.set()
        thread.join(timeout=5)
        self.assertFalse(thread.is_alive())

    def test_a_disabled_worker_returns_from_run_at_once(self):
        w = VocabWorker(settings(enabled=False), transport=lambda *a, **k: None)
        w.run(threading.Event())  # must not block


if __name__ == "__main__":
    unittest.main()
