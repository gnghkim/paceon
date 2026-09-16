"""Daily reminder sender: what it says, what it sends, and what it does when a device is gone."""

import json
import threading
import unittest

from app.notify_worker import TTL_SECONDS, NotifySettings, NotifyWorker, compose
from app.web_push import b64url_encode

UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
PUBLIC = UA_PUBLIC


def settings(**kwargs):
    base = dict(
        supabase_url="https://db.example",
        service_key="service",
        private_key=PRIVATE,
        public_key=PUBLIC,
        subject="mailto:study@paceon.example",
        poll_seconds=60,
    )
    base.update(kwargs)
    return NotifySettings(**base)


def row(**kwargs):
    base = {
        "user_id": "11111111-1111-4111-8111-111111111111",
        "subscription_id": "22222222-2222-4222-8222-222222222222",
        "endpoint": "https://push.example/send/abc12345678901234567",
        "p256dh": UA_PUBLIC,
        "auth": AUTH,
        "due_pages": 20,
        "goal_minutes": 10,
    }
    base.update(kwargs)
    return base


class Compose(unittest.TestCase):
    def test_both_habits_appear_when_both_are_planned(self):
        self.assertEqual(compose(20, 10), "오늘 20쪽 · 영어 10분")

    def test_only_what_is_planned_is_mentioned(self):
        self.assertEqual(compose(20, None), "오늘 20쪽")
        self.assertEqual(compose(0, 10), "영어 10분")
        self.assertEqual(compose(None, 10), "영어 10분")

    def test_a_day_with_nothing_planned_still_invites_rather_than_scolds(self):
        for pages, minutes in [(0, 0), (None, None), (0, None)]:
            self.assertEqual(compose(pages, minutes), "오늘도 한 걸음 남겨 볼까요?")

    def test_nonsense_values_never_reach_the_line(self):
        self.assertEqual(compose("20", "10"), "오늘도 한 걸음 남겨 볼까요?")
        self.assertEqual(compose(-5, -1), "오늘도 한 걸음 남겨 볼까요?")
        self.assertEqual(compose(True, None), "오늘도 한 걸음 남겨 볼까요?")


class Delivery(unittest.TestCase):
    def worker(self, status=201, rows=None, **kwargs):
        sent, calls = [], []

        def push(url, body, headers, timeout=15):
            sent.append({"url": url, "body": body, "headers": headers})
            return status

        def rpc(url, payload, headers, timeout=15):
            calls.append({"url": url, "payload": payload})
            if url.endswith("claim_due_notifications"):
                return rows if rows is not None else []
            return None

        return NotifyWorker(settings(**kwargs), rpc=rpc, push=push), sent, calls

    def test_a_reminder_is_encrypted_and_addressed_to_the_push_origin(self):
        worker, sent, calls = self.worker(rows=[row()])
        self.assertEqual(worker.run_once(), 1)
        self.assertEqual(len(sent), 1)
        message = sent[0]
        self.assertEqual(message["url"], "https://push.example/send/abc12345678901234567")
        self.assertEqual(message["headers"]["Content-Encoding"], "aes128gcm")
        self.assertEqual(message["headers"]["TTL"], str(TTL_SECONDS))
        self.assertEqual(message["headers"]["Content-Length"], str(len(message["body"])))
        self.assertTrue(message["headers"]["Authorization"].startswith("vapid t="))
        # The body is ciphertext, so the line must not be readable on the wire.
        self.assertNotIn("오늘".encode("utf-8"), message["body"])
        self.assertGreater(len(message["body"]), 86)
        # A delivered message settles nothing; only failures are reported back.
        self.assertEqual([c["url"] for c in calls], ["https://db.example/rest/v1/rpc/claim_due_notifications"])

    def test_a_gone_endpoint_is_reported_so_the_row_can_be_dropped(self):
        for status in (404, 410):
            worker, _, calls = self.worker(status=status, rows=[row()])
            self.assertEqual(worker.run_once(), 0)
            finish = [c for c in calls if c["url"].endswith("finish_notification")]
            self.assertEqual(len(finish), 1)
            self.assertEqual(finish[0]["payload"]["p_gone"], True)

    def test_a_temporary_failure_counts_but_keeps_the_device(self):
        for status in (0, 429, 500, 503):
            worker, _, calls = self.worker(status=status, rows=[row()])
            self.assertEqual(worker.run_once(), 0)
            finish = [c for c in calls if c["url"].endswith("finish_notification")]
            self.assertEqual(finish[0]["payload"]["p_gone"], False)

    def test_one_broken_subscription_does_not_stop_the_others(self):
        worker, sent, calls = self.worker(rows=[row(p256dh="not-a-key"), row(subscription_id="33333333-3333-4333-8333-333333333333")])
        self.assertEqual(worker.run_once(), 1)
        self.assertEqual(len(sent), 1, "the healthy device is still told")
        finish = [c for c in calls if c["url"].endswith("finish_notification")]
        self.assertEqual(len(finish), 1)
        self.assertEqual(finish[0]["payload"]["p_gone"], False)

    def test_the_claim_asks_for_a_bounded_batch(self):
        worker, _, calls = self.worker(rows=[])
        worker.run_once()
        self.assertEqual(calls[0]["payload"], {"p_limit": 50})

    def test_an_unexpected_claim_shape_is_ignored_rather_than_crashing(self):
        for rows in [None, {"oops": 1}, "rows"]:
            worker, sent, _ = self.worker(rows=rows)
            self.assertEqual(worker.run_once(), 0)
            self.assertEqual(sent, [])

    def test_the_payload_carries_the_line_the_browser_will_show(self):
        captured = {}

        def fake_encrypt(payload, p256dh, auth, **kwargs):
            captured["payload"] = json.loads(payload.decode("utf-8"))
            return b"encrypted"

        worker, sent, _ = self.worker(rows=[row(due_pages=15, goal_minutes=None)])
        import app.notify_worker as module

        original = module.encrypt
        module.encrypt = fake_encrypt
        try:
            worker.run_once()
        finally:
            module.encrypt = original
        self.assertEqual(captured["payload"], {"title": "PaceOn", "body": "오늘 15쪽", "url": "/today"})


class Configuration(unittest.TestCase):
    def test_a_missing_key_or_subject_disables_the_sender(self):
        self.assertTrue(settings().enabled)
        for missing in ["supabase_url", "service_key", "private_key", "public_key", "subject"]:
            self.assertFalse(settings(**{missing: ""}).enabled, missing)

    def test_a_disabled_sender_never_touches_the_database(self):
        calls = []
        worker = NotifyWorker(
            settings(private_key=""),
            rpc=lambda *args, **kwargs: calls.append(args) or [],
            push=lambda *args, **kwargs: 201,
        )
        self.assertEqual(worker.run_once(), 0)
        self.assertEqual(calls, [])

    def test_a_disabled_sender_returns_from_run_at_once(self):
        stop = threading.Event()
        worker = NotifyWorker(settings(subject=""), rpc=lambda *a, **k: [], push=lambda *a, **k: 201)
        worker.run(stop)  # must not block

    def test_stopping_wakes_the_poll_wait(self):
        stop = threading.Event()
        worker = NotifyWorker(settings(), rpc=lambda *a, **k: [], push=lambda *a, **k: 201)
        thread = threading.Thread(target=worker.run, args=(stop,))
        thread.start()
        stop.set()
        thread.join(timeout=5)
        self.assertFalse(thread.is_alive())

    def test_the_poll_interval_is_clamped_to_something_sane(self):
        import os

        for value, expected in [("5", 60), ("1000", 60), ("not a number", 60), ("120", 120)]:
            os.environ["NOTIFY_POLL_SECONDS"] = value
            try:
                self.assertEqual(NotifySettings.from_env().poll_seconds, expected)
            finally:
                del os.environ["NOTIFY_POLL_SECONDS"]


if __name__ == "__main__":
    unittest.main()
