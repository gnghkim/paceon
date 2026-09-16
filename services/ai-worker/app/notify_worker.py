"""Daily study reminder sender.

The database decides who is due and marks the day in the same statement, so two
workers overlapping cannot ring the same person twice. This module only turns a
claimed row into one short Korean line, encrypts it for that device, and reports
whether the endpoint is still alive.

A learner's records never leave the database through here. The only numbers sent
are today's planned pages and the daily English goal, both already on the claim row.
"""

import json
import os
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass, field

from app.web_push import encrypt, origin_of, vapid_headers

#: Push services keep an undelivered message this long. A day-old reminder is noise.
TTL_SECONDS = 4 * 3600


def compose(due_pages, goal_minutes) -> str:
    """The one line a learner reads on the lock screen.

    Says what is planned, never what was missed. A reminder that opens with a
    failure is the reason people turn reminders off.
    """
    # bool is an int in Python, so True would render as "오늘 True쪽" without this.
    def counted(value):
        return isinstance(value, int) and not isinstance(value, bool) and value > 0

    parts = []
    if counted(due_pages):
        parts.append(f"오늘 {due_pages}쪽")
    if counted(goal_minutes):
        parts.append(f"영어 {goal_minutes}분")
    if not parts:
        return "오늘도 한 걸음 남겨 볼까요?"
    return " · ".join(parts)


@dataclass(frozen=True)
class NotifySettings:
    supabase_url: str
    service_key: str = field(repr=False)
    private_key: str = field(repr=False)
    public_key: str
    subject: str
    poll_seconds: float = 60

    @property
    def enabled(self) -> bool:
        return bool(self.supabase_url and self.service_key and self.private_key and self.public_key and self.subject)

    @classmethod
    def from_env(cls):
        try:
            poll = float(os.getenv("NOTIFY_POLL_SECONDS", "60"))
            if not 10 <= poll <= 900:
                poll = 60
        except ValueError:
            poll = 60
        return cls(
            os.getenv("SUPABASE_URL", "").strip().rstrip("/"),
            os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip(),
            os.getenv("VAPID_PRIVATE_KEY", "").strip(),
            os.getenv("VAPID_PUBLIC_KEY", "").strip(),
            os.getenv("VAPID_SUBJECT", "").strip(),
            poll,
        )


def send_push(url, body, headers, timeout=15):
    """POST one encrypted message. Returns the push service's status code."""
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler)
    try:
        with opener.open(request, timeout=timeout) as result:
            result.read(1024)
            return result.status
    except urllib.error.HTTPError as exc:
        status = exc.code
        exc.close()
        return status
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return 0


def post_rpc(url, payload, headers, timeout=15):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    with urllib.request.build_opener().open(request, timeout=timeout) as result:
        raw = result.read(1048577)
        if len(raw) > 1048576:
            raise ValueError("response too large")
        return json.loads(raw) if raw else None


class NotifyWorker:
    def __init__(self, settings, rpc=post_rpc, push=send_push):
        self.settings = settings
        self._rpc = rpc
        self._push = push

    def rpc(self, name, payload):
        return self._rpc(
            self.settings.supabase_url + "/rest/v1/rpc/" + name,
            payload,
            {"apikey": self.settings.service_key, "Authorization": "Bearer " + self.settings.service_key},
        )

    def deliver(self, row) -> bool:
        """Send one reminder. Returns False when the endpoint is gone for good."""
        endpoint = row["endpoint"]
        message = json.dumps(
            {
                "title": "PaceOn",
                "body": compose(row.get("due_pages"), row.get("goal_minutes")),
                "url": "/today",
            },
            ensure_ascii=False,
        ).encode("utf-8")
        body = encrypt(message, row["p256dh"], row["auth"])
        headers = {
            **vapid_headers(
                origin_of(endpoint), self.settings.subject, self.settings.private_key, self.settings.public_key
            ),
            "TTL": str(TTL_SECONDS),
            "Content-Length": str(len(body)),
        }
        status = self._push(endpoint, body, headers)
        # 404/410 mean the browser threw the subscription away; anything else may recover.
        gone = status in (404, 410)
        delivered = 200 <= status < 300
        if not delivered:
            self.rpc("finish_notification", {"p_subscription_id": row["subscription_id"], "p_gone": gone})
        return delivered

    def run_once(self) -> int:
        if not self.settings.enabled:
            return 0
        rows = self.rpc("claim_due_notifications", {"p_limit": 50})
        if not isinstance(rows, list):
            return 0
        sent = 0
        for row in rows:
            try:
                if self.deliver(row):
                    sent += 1
            except Exception:
                # One bad subscription must not stop the rest, and nothing is logged:
                # the row carries a push endpoint that identifies a person.
                try:
                    self.rpc(
                        "finish_notification",
                        {"p_subscription_id": row.get("subscription_id"), "p_gone": False},
                    )
                except Exception:
                    pass
        return sent

    def run(self, stop: threading.Event):
        while self.settings.enabled and not stop.is_set():
            try:
                self.run_once()
            except Exception:
                pass
            stop.wait(self.settings.poll_seconds)
