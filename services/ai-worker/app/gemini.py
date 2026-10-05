"""Gemini REST adapter for the Telegram tutor.

Calls generateContent over the worker's kept-connection transport (post_json): no
redirects, a response size cap, and no logging. The key travels in a header, never in
the URL. Request bodies hold the learner's words, so nothing here is logged; failures
surface only as SafeFailure codes.

Settings follow TAIET's 2026-10 measurements for gemini-3.5-flash-lite:
- thinking cannot be turned off on Gemini 3; thinkingLevel MINIMAL is the lowest.
  Thinking tokens count against maxOutputTokens.
- temperature is left at its default. Google warns lower values can make Gemini 3 loop.
- Structured output uses responseMimeType + responseJsonSchema. The schema is written by
  hand with only the keywords Gemini supports; string lengths are checked afterwards.
"""

import base64
import json
import re

from pydantic import ValidationError

from app.worker import SafeFailure, post_json

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MODEL_NAME = re.compile(r"^[a-z0-9][a-z0-9.\-]{0,62}$")
MAX_ANSWER_BYTES = 200_000
# Finish reasons that mean the model stopped on purpose without a usable answer.
REFUSALS = frozenset({"SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "LANGUAGE", "OTHER"})


def text_part(text: str) -> dict:
    return {"text": text}


def audio_part(data: bytes, mime_type: str = "audio/ogg") -> dict:
    # Telegram voice notes are small, well under the 20MB inline limit.
    return {"inlineData": {"mimeType": mime_type, "data": base64.b64encode(data).decode("ascii")}}


def content(role: str, *parts: dict) -> dict:
    return {"role": role, "parts": list(parts)}


class GeminiClient:
    def __init__(self, api_key: str, model: str, transport=post_json, timeout: int = 45):
        if not MODEL_NAME.match(model or ""):
            raise ValueError("invalid Gemini model name")
        self.api_key = api_key
        self.model = model
        self.transport = transport
        self.timeout = timeout

    def request_body(self, contents, system=None, schema=None, max_tokens=2048) -> dict:
        config = {"maxOutputTokens": max_tokens, "thinkingConfig": {"thinkingLevel": "MINIMAL"}}
        if schema is not None:
            config["responseMimeType"] = "application/json"
            config["responseJsonSchema"] = schema
        body = {"contents": contents, "generationConfig": config}
        if system:
            body["systemInstruction"] = {"parts": [text_part(system)]}
        return body

    def _call(self, body) -> str:
        reply = self.transport(
            ENDPOINT.format(model=self.model), body, {"x-goog-api-key": self.api_key}, self.timeout
        )
        if not isinstance(reply, dict):
            raise SafeFailure("INVALID_OUTPUT")
        if (reply.get("promptFeedback") or {}).get("blockReason"):
            raise SafeFailure("PROVIDER_REFUSAL")
        candidates = reply.get("candidates") or []
        if not candidates or not isinstance(candidates[0], dict):
            raise SafeFailure("INVALID_OUTPUT")
        candidate = candidates[0]
        reason = candidate.get("finishReason")
        if reason == "MAX_TOKENS":
            raise SafeFailure("PROVIDER_INCOMPLETE")
        if reason in REFUSALS:
            raise SafeFailure("PROVIDER_REFUSAL")
        parts = (candidate.get("content") or {}).get("parts") or []
        # Thought summaries, if any, are not the answer.
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought"))
        if not text.strip():
            raise SafeFailure("INVALID_OUTPUT")
        if len(text.encode("utf-8")) > MAX_ANSWER_BYTES:
            raise SafeFailure("INVALID_OUTPUT")
        return text

    def generate_text(self, contents, system=None, max_tokens=2048) -> str:
        return self._call(self.request_body(contents, system, None, max_tokens)).strip()

    def generate_json(self, contents, model_cls, schema, system=None, max_tokens=2048, attempts=2):
        """Structured answer validated against `model_cls`. An unparsable answer is asked once more."""
        body = self.request_body(contents, system, schema, max_tokens)
        for _ in range(attempts):
            text = self._call(body)
            try:
                return model_cls.model_validate(json.loads(text))
            except (ValueError, ValidationError, TypeError):
                continue
        raise SafeFailure("INVALID_OUTPUT")
