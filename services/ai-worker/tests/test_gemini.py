"""Gemini adapter: what is sent, what is accepted, and what a failure looks like."""

import base64
import json
import unittest

from app.gemini import GeminiClient, audio_part, content, text_part
from app.telegram_tutor import TUTOR_TURN_SCHEMA, TutorTurn
from app.worker import SafeFailure

TURN = {
    "transcript": "", "learner_used_korean": False, "reply": "Nice!", "mistakes": [],
    "natural_version": "", "tip": "", "rewrite_check": {"is_attempt": False, "correct": False, "comment": ""},
}


def answer(text, reason="STOP", **extra):
    return {"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": reason}], **extra}


class Fake:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def __call__(self, url, payload, headers, timeout):
        self.calls.append({"url": url, "payload": payload, "headers": headers, "timeout": timeout})
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def client(*replies):
    fake = Fake(*replies)
    return GeminiClient("gemini-key", "gemini-3.5-flash-lite", fake), fake


class Request(unittest.TestCase):
    def test_structured_request_follows_the_gemini_3_rules(self):
        gemini, fake = client(answer(json.dumps(TURN)))
        gemini.generate_json([content("user", text_part("hello"))], TutorTurn, TUTOR_TURN_SCHEMA, system="be a tutor")
        call = fake.calls[0]
        self.assertTrue(call["url"].endswith("/models/gemini-3.5-flash-lite:generateContent"))
        self.assertNotIn("gemini-key", call["url"], "the key travels in a header")
        self.assertEqual(call["headers"], {"x-goog-api-key": "gemini-key"})
        config = call["payload"]["generationConfig"]
        self.assertEqual(config["thinkingConfig"], {"thinkingLevel": "MINIMAL"})
        self.assertEqual(config["maxOutputTokens"], 2048)
        self.assertNotIn("temperature", config, "Gemini 3 keeps its default temperature")
        self.assertEqual(config["responseMimeType"], "application/json")
        self.assertIs(config["responseJsonSchema"], TUTOR_TURN_SCHEMA)
        self.assertEqual(call["payload"]["systemInstruction"], {"parts": [{"text": "be a tutor"}]})

    def test_the_schema_uses_only_keywords_gemini_supports(self):
        allowed = {"type", "properties", "required", "additionalProperties", "enum", "items",
                   "minItems", "maxItems", "description"}

        def walk(node):
            for key in node:
                self.assertIn(key, allowed)
            for child in (node.get("properties") or {}).values():
                walk(child)
            if isinstance(node.get("items"), dict):
                walk(node["items"])

        walk(TUTOR_TURN_SCHEMA)

    def test_audio_goes_inline_as_base64(self):
        part = audio_part(b"OggS-data")
        self.assertEqual(part, {"inlineData": {"mimeType": "audio/ogg", "data": base64.b64encode(b"OggS-data").decode()}})

    def test_plain_text_request_has_no_schema(self):
        gemini, fake = client(answer("Topic one\nTopic two"))
        self.assertEqual(gemini.generate_text([content("user", text_part("topics"))]), "Topic one\nTopic two")
        config = fake.calls[0]["payload"]["generationConfig"]
        self.assertNotIn("responseJsonSchema", config)
        self.assertNotIn("systemInstruction", fake.calls[0]["payload"])

    def test_a_model_name_cannot_reshape_the_url(self):
        for name in ["", "../x", "gemini?key=1", "a/b", "Gemini"]:
            with self.assertRaises(ValueError):
                GeminiClient("k", name, Fake())


class Answers(unittest.TestCase):
    def test_an_unparsable_answer_is_asked_once_more(self):
        gemini, fake = client(answer("not json"), answer(json.dumps(TURN)))
        turn = gemini.generate_json([], TutorTurn, TUTOR_TURN_SCHEMA)
        self.assertEqual(turn.reply, "Nice!")
        self.assertEqual(len(fake.calls), 2)

    def test_two_bad_answers_are_a_safe_failure(self):
        gemini, fake = client(answer("{}"), answer(json.dumps({**TURN, "extra": 1})))
        with self.assertRaises(SafeFailure) as failure:
            gemini.generate_json([], TutorTurn, TUTOR_TURN_SCHEMA)
        self.assertEqual(str(failure.exception), "INVALID_OUTPUT")
        self.assertEqual(len(fake.calls), 2)

    def test_stopped_answers_become_fixed_codes_without_retry(self):
        for reply, code in [
            ({"promptFeedback": {"blockReason": "SAFETY"}}, "PROVIDER_REFUSAL"),
            (answer("x", "SAFETY"), "PROVIDER_REFUSAL"),
            (answer("{\"reply\":", "MAX_TOKENS"), "PROVIDER_INCOMPLETE"),
            ({"candidates": []}, "INVALID_OUTPUT"),
            ("not a dict", "INVALID_OUTPUT"),
        ]:
            gemini, fake = client(reply)
            with self.assertRaises(SafeFailure) as failure:
                gemini.generate_json([], TutorTurn, TUTOR_TURN_SCHEMA)
            self.assertEqual(str(failure.exception), code, repr(reply)[:60])
            self.assertEqual(len(fake.calls), 1)

    def test_thought_parts_are_not_the_answer(self):
        reply = {"candidates": [{"content": {"parts": [{"text": "thinking...", "thought": True},
                                                       {"text": json.dumps(TURN)}]}, "finishReason": "STOP"}]}
        gemini, _ = client(reply)
        self.assertEqual(gemini.generate_json([], TutorTurn, TUTOR_TURN_SCHEMA).reply, "Nice!")

    def test_transport_failures_pass_through_as_codes(self):
        gemini, _ = client(SafeFailure("PROVIDER_ERROR"))
        with self.assertRaises(SafeFailure) as failure:
            gemini.generate_text([])
        self.assertEqual(str(failure.exception), "PROVIDER_ERROR")


if __name__ == "__main__":
    unittest.main()
