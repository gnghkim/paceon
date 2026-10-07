"""TelegramWorker with every network edge faked: Bot API, Gemini, Supabase RPC and TTS."""

import json
import logging
import threading
import unittest
from unittest.mock import patch

from app.gemini import GeminiClient
from app.telegram_api import TelegramApi
from app.telegram_worker import LINK_REQUIRED, TelegramSettings, TelegramWorker
from app.worker import SafeFailure

USER = "11111111-1111-4111-8111-111111111111"
SOURCE = "Yesterday I go to the park and buyed a apple."
CARD = {"id": "22222222-2222-4222-8222-222222222222", "wrongText": "go", "correctText": "went", "ruleText": "과거형이에요.",
        "sourceSentence": "Yesterday I go to the park.", "category": "GRAMMAR", "reviewStep": 1, "occurrences": 1}


def settings(**changes):
    base = dict(enabled=True, supabase_url="https://db.example", service_key="service-secret",
                bot_token="123:bot-secret", gemini_key="gemini-secret", gemini_model="gemini-3.5-flash-lite",
                openai_key="openai-secret", daily_turn_limit=300)
    base.update(changes)
    return TelegramSettings(**base)


def tutor_answer(**changes):
    body = {
        "transcript": "", "learner_used_korean": False, "reply": "Sounds fun! What did you do there?",
        "mistakes": [
            {"wrong": "go", "correct": "went", "rule": "어제 일은 과거형으로 써요.", "category": "grammar"},
            {"wrong": "buyed", "correct": "bought", "rule": "buy의 과거형은 bought예요.", "category": "grammar"},
            {"wrong": "a apple", "correct": "an apple", "rule": "모음 앞에는 an을 써요.", "category": "grammar"},
        ],
        "natural_version": "Yesterday I went to the park and bought an apple.", "tip": "",
        "rewrite_check": {"is_attempt": False, "correct": False, "comment": ""},
    }
    body.update(changes)
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(body, ensure_ascii=False)}]}, "finishReason": "STOP"}]}


def context(**changes):
    base = {"userId": USER, "chatId": 1001, "level": "INTERMEDIATE", "scenario": None, "voiceReplies": False,
            "reviewAt": "07:00", "pendingRewrite": None, "quizState": None, "timezone": "Asia/Seoul",
            "today": "2026-10-05", "turnsToday": 0, "history": []}
    base.update(changes)
    return base


class FakeApi:
    def __init__(self):
        self.sent = []
        self.voices = []
        self.actions = []
        self.downloads = []

    def send_formatted(self, chat_id, text):
        self.sent.append((chat_id, text))

    def send_chat_action(self, chat_id, action="typing"):
        self.actions.append(chat_id)

    def download_voice(self, file_id):
        self.downloads.append(file_id)
        return b"OggS-voice"

    def send_voice(self, chat_id, audio):
        self.voices.append((chat_id, audio))

    def set_my_commands(self, commands=None):
        pass


class Hub:
    """Answers Supabase RPCs from a table and Gemini from a queue, recording both."""

    def __init__(self, ctx=None, gemini=(), rpc=None):
        self.ctx = ctx
        self.gemini = list(gemini)
        self.rpc_answers = rpc or {}
        self.rpcs = []
        self.gemini_calls = []

    def __call__(self, url, payload, headers, timeout):
        if "generativelanguage.googleapis.com" in url:
            self.gemini_calls.append(payload)
            if not self.gemini:
                raise SafeFailure("PROVIDER_ERROR")
            return self.gemini.pop(0)
        name = url.rsplit("/", 1)[1]
        self.rpcs.append((name, payload))
        if name == "get_telegram_context":
            return self.ctx
        answer = self.rpc_answers.get(name, True)
        return answer(payload) if callable(answer) else answer

    def calls(self, name):
        return [payload for called, payload in self.rpcs if called == name]


def worker(hub, **setting_changes):
    api = FakeApi()
    s = settings(**setting_changes)
    w = TelegramWorker(s, api=api, gemini=GeminiClient(s.gemini_key, s.gemini_model, hub), transport=hub,
                       exchange_fn=lambda *a, **k: (200, b"OggS-reply"))
    return w, api


def text_update(text, message_id=7, chat_type="private", sender=555):
    return {"update_id": 900 + message_id, "message": {
        "message_id": message_id, "text": text, "chat": {"id": 1001, "type": chat_type},
        "from": {"id": sender, "is_bot": False}}}


class Linking(unittest.TestCase):
    def test_an_unlinked_sender_gets_instructions_and_no_model_call(self):
        hub = Hub(ctx=None, gemini=[tutor_answer()])
        w, api = worker(hub)
        for text in ["Hello, I go to school.", "/review", "/topic"]:
            w.handle_update(text_update(text))
        self.assertEqual(hub.gemini_calls, [], "nobody unlinked costs a model call")
        self.assertEqual([t for _, t in api.sent], [LINK_REQUIRED] * 3)
        self.assertEqual(hub.calls("record_telegram_turn"), [])

    def test_link_command_passes_the_code_and_identity(self):
        for result, expected in [("LINKED", "✅ PaceOn 계정과 연결했어요"), ("INVALID_CODE", "❌ 코드가 맞지 않거나"),
                                 ("TELEGRAM_IN_USE", "다른 PaceOn 계정에 연결돼")]:
            hub = Hub(ctx=None, rpc={"link_telegram": result})
            w, api = worker(hub)
            w.handle_update(text_update("/link ab12cd34"))
            self.assertEqual(hub.calls("link_telegram"), [{"p_code": "ab12cd34", "p_telegram_user_id": 555, "p_chat_id": 1001}])
            self.assertIn(expected, api.sent[-1][1])

    def test_the_settings_deep_link_links_in_one_tap(self):
        # t.me/<bot>?start=CODE makes Telegram send "/start CODE".
        hub = Hub(ctx=None, rpc={"link_telegram": "LINKED"})
        w, api = worker(hub)
        w.handle_update(text_update("/start AB12CD34"))
        self.assertEqual(hub.calls("link_telegram"), [{"p_code": "AB12CD34", "p_telegram_user_id": 555, "p_chat_id": 1001}])
        self.assertIn("✅ PaceOn 계정과 연결했어요", api.sent[-1][1])

    def test_link_without_a_code_explains_how(self):
        hub = Hub(ctx=None)
        w, api = worker(hub)
        w.handle_update(text_update("/link"))
        self.assertEqual(hub.calls("link_telegram"), [])
        self.assertIn("/link AB12CD34", api.sent[0][1])

    def test_unlink_from_telegram(self):
        hub = Hub(ctx=context())
        w, api = worker(hub)
        w.handle_update(text_update("/unlink"))
        self.assertEqual(hub.calls("unlink_telegram_user"), [{"p_telegram_user_id": 555}])

    def test_groups_bots_and_other_message_kinds_are_ignored(self):
        hub = Hub(ctx=context(), gemini=[tutor_answer()])
        w, api = worker(hub)
        w.handle_update(text_update("hello", chat_type="group"))
        bot = text_update("hello")
        bot["message"]["from"]["is_bot"] = True
        w.handle_update(bot)
        sticker = text_update("x")
        del sticker["message"]["text"]
        sticker["message"]["sticker"] = {}
        w.handle_update(sticker)
        w.handle_update({"update_id": 1, "edited_message": {}})
        self.assertEqual(hub.rpcs, [])
        self.assertEqual(api.sent, [])


class TutorTurns(unittest.TestCase):
    def test_a_message_is_answered_recorded_and_its_mistakes_become_cards(self):
        hub = Hub(ctx=context(history=[{"learnerText": "Hi", "replyText": "Hello!\n\n[Feedback]\n👍"}]), gemini=[tutor_answer()])
        w, api = worker(hub)
        w.handle_update(text_update(SOURCE))
        self.assertEqual(len(hub.gemini_calls), 1)
        contents = hub.gemini_calls[0]["contents"]
        self.assertEqual(contents[0], {"role": "user", "parts": [{"text": "Hi"}]})
        self.assertEqual(contents[1], {"role": "model", "parts": [{"text": "Hello!"}]}, "feedback is not context")
        self.assertEqual(contents[-1]["parts"][0]["text"], f"Latest learner message:\n{SOURCE}")
        record = hub.calls("record_telegram_turn")[0]
        self.assertEqual(record["p_user_id"], USER)
        turn = record["p_turn"]
        self.assertEqual((turn["chatId"], turn["messageId"], turn["inputKind"], turn["learnerText"]), (1001, 7, "TEXT", SOURCE))
        self.assertEqual(turn["mistakeCount"], 3)
        self.assertEqual([(c["wrong"], c["correct"]) for c in turn["cards"]], [("go", "went"), ("buyed", "bought")])
        self.assertEqual(turn["pendingRewrite"]["target"], "Yesterday I went to the park and bought an apple.")
        self.assertFalse(turn["rewriteAttempt"])
        self.assertEqual(api.actions, [1001])
        self.assertIn("||went||", api.sent[-1][1])
        self.assertEqual(api.voices, [])

    def test_nothing_identifying_reaches_the_model(self):
        hub = Hub(ctx=context(), gemini=[tutor_answer()])
        w, _ = worker(hub)
        w.handle_update(text_update(SOURCE))
        sent = json.dumps(hub.gemini_calls[0], ensure_ascii=False)
        for secret in [USER, "1001", "555", "service-secret", "bot-secret"]:
            self.assertNotIn(secret, sent)

    def test_level_and_scenario_shape_the_system_prompt(self):
        hub = Hub(ctx=context(level="ADVANCED", scenario="AIRPORT"), gemini=[tutor_answer()])
        w, _ = worker(hub)
        w.handle_update(text_update("hi"))
        system = hub.gemini_calls[0]["systemInstruction"]["parts"][0]["text"]
        self.assertTrue(system.startswith("You are a sophisticated English tutor"))
        self.assertIn("SCENARIO: You are a check-in agent at the airport.", system)

    def test_a_rewrite_is_checked_against_the_required_fixes_and_makes_no_cards(self):
        pending = {"original": SOURCE, "target": "Yesterday I went to the park and bought an apple.",
                   "fixes": [["go", "went"], ["buyed", "bought"]]}
        model_says_wrong = tutor_answer(mistakes=[], rewrite_check={"is_attempt": True, "correct": False, "comment": "다시 볼까요"})
        hub = Hub(ctx=context(pendingRewrite=pending), gemini=[model_says_wrong])
        w, api = worker(hub)
        w.handle_update(text_update("Yesterday I went to the park and bought an apple."))
        self.assertIn("'buyed' must become 'bought'", hub.gemini_calls[0]["contents"][-1]["parts"][0]["text"])
        turn = hub.calls("record_telegram_turn")[0]["p_turn"]
        self.assertTrue(turn["rewriteAttempt"])
        self.assertTrue(turn["rewriteCorrect"], "the exact target is right whatever the model said")
        self.assertEqual(turn["cards"], [])
        self.assertEqual(turn["mistakeCount"], 0)
        self.assertIsNone(turn["pendingRewrite"])
        self.assertIn("✅ 정확하게 고쳤어요!", api.sent[-1][1])

    def test_a_failed_model_call_says_sorry_and_records_nothing(self):
        hub = Hub(ctx=context(), gemini=[])
        w, api = worker(hub)
        w.handle_update(text_update(SOURCE))
        self.assertEqual(api.sent[-1][1], "Sorry, I encountered an error. Please try again.")
        self.assertEqual(hub.calls("record_telegram_turn"), [])

    def test_the_daily_limit_stops_model_calls(self):
        hub = Hub(ctx=context(turnsToday=300), gemini=[tutor_answer()])
        w, api = worker(hub)
        w.handle_update(text_update(SOURCE))
        self.assertEqual(hub.gemini_calls, [])
        self.assertIn("내일 다시", api.sent[-1][1])

    def test_an_overlong_message_is_refused_before_the_model(self):
        hub = Hub(ctx=context(), gemini=[tutor_answer()])
        w, api = worker(hub)
        w.handle_update(text_update("a" * 4001))
        self.assertEqual(hub.gemini_calls, [])

    def test_voice_goes_inline_without_history_and_answers_with_what_was_heard(self):
        hub = Hub(ctx=context(history=[{"learnerText": "Hi", "replyText": "Hello"}], voiceReplies=True),
                  gemini=[tutor_answer(transcript="Last weekend I go to Busan")])
        w, api = worker(hub)
        update = text_update("x")
        del update["message"]["text"]
        update["message"]["voice"] = {"file_id": "voice-1", "duration": 6}
        w.handle_update(update)
        contents = hub.gemini_calls[0]["contents"]
        self.assertEqual(len(contents), 1, "voice is sent without history")
        self.assertEqual(contents[0]["parts"][1]["inlineData"]["mimeType"], "audio/ogg")
        turn = hub.calls("record_telegram_turn")[0]["p_turn"]
        self.assertEqual((turn["inputKind"], turn["learnerText"]), ("VOICE", "Last weekend I go to Busan"))
        self.assertIn("🎤 들은 문장: Last weekend I go to Busan", api.sent[-1][1])
        self.assertEqual(api.voices, [(1001, b"OggS-reply")], "voice replies are on")

    def test_a_long_voice_note_is_refused(self):
        hub = Hub(ctx=context(), gemini=[tutor_answer()])
        w, api = worker(hub)
        update = text_update("x")
        del update["message"]["text"]
        update["message"]["voice"] = {"file_id": "v", "duration": 600}
        w.handle_update(update)
        self.assertEqual((hub.gemini_calls, api.downloads), ([], []))


class Quiz(unittest.TestCase):
    def test_review_starts_a_quiz_from_due_cards(self):
        hub = Hub(ctx=context(), rpc={"get_telegram_quiz_cards": [CARD]})
        w, api = worker(hub)
        w.handle_update(text_update("/review"))
        state = hub.calls("save_telegram_quiz_state")[0]["p_state"]
        self.assertEqual((state["total"], state["correct"], state["cards"][0]["id"]), (1, 0, CARD["id"]))
        self.assertIn("Yesterday I **go** to the park.", api.sent[-1][1])

    def test_a_clear_answer_moves_the_card_without_the_model(self):
        hub = Hub(ctx=context(quizState={"cards": [CARD], "total": 1, "correct": 0}))
        w, api = worker(hub)
        w.handle_update(text_update("Yesterday I went to the park."))
        self.assertEqual(hub.gemini_calls, [])
        self.assertEqual(hub.calls("record_correction_review"), [{
            "p_user_id": USER, "p_id": CARD["id"], "p_step": 2, "p_due_on": "2026-10-12", "p_today": "2026-10-05"}])
        self.assertIsNone(hub.calls("save_telegram_quiz_state")[-1]["p_state"])
        self.assertIn("🗓️ 다음 복습: 2026-10-12", api.sent[-1][1])
        self.assertIn("1문제 중 1개 맞혔어요", api.sent[-1][1])

    def test_a_wrong_answer_is_graded_by_the_model_and_comes_back_tomorrow(self):
        grade = {"candidates": [{"content": {"parts": [{"text": json.dumps({"is_answer": True, "correct": False, "feedback": "아직이에요"})}]}, "finishReason": "STOP"}]}
        hub = Hub(ctx=context(quizState={"cards": [CARD, {**CARD, "id": "33333333-3333-4333-8333-333333333333"}], "total": 2, "correct": 0}),
                  gemini=[grade])
        w, api = worker(hub)
        w.handle_update(text_update("gone"))
        self.assertEqual(len(hub.gemini_calls), 1)
        self.assertEqual(hub.calls("record_correction_review")[0]["p_step"], 0)
        self.assertEqual(hub.calls("record_correction_review")[0]["p_due_on"], "2026-10-06")
        self.assertIn("정답은 **went**", api.sent[-1][1])
        self.assertIn("📝 복습 퀴즈 2/2", api.sent[-1][1])
        self.assertEqual(len(hub.calls("save_telegram_quiz_state")[-1]["p_state"]["cards"]), 1)

    def test_an_off_topic_message_ends_the_quiz_and_goes_to_the_tutor(self):
        off = {"candidates": [{"content": {"parts": [{"text": json.dumps({"is_answer": False, "correct": False, "feedback": ""})}]}, "finishReason": "STOP"}]}
        hub = Hub(ctx=context(quizState={"cards": [CARD], "total": 1, "correct": 0}), gemini=[off, tutor_answer()])
        w, api = worker(hub)
        w.handle_update(text_update("By the way, what's your favorite movie?"))
        self.assertIsNone(hub.calls("save_telegram_quiz_state")[0]["p_state"])
        self.assertEqual(hub.calls("record_correction_review"), [])
        self.assertEqual(len(hub.calls("record_telegram_turn")), 1)


class MorningReview(unittest.TestCase):
    def test_claimed_readers_get_a_summary_and_then_a_quiz(self):
        summary = {"candidates": [{"content": {"parts": [{"text": "Good morning! Yesterday you talked about the park."}]}, "finishReason": "STOP"}]}
        hub = Hub(rpc={"claim_due_telegram_reviews": [{"userId": USER, "chatId": 1001, "today": "2026-10-05",
                                                       "yesterdayTurns": ["I goed home."],
                                                       "yesterdayCorrections": [{"wrongText": "goed", "correctText": "went", "ruleText": "r"}]}],
                       "get_telegram_quiz_cards": [CARD]}, gemini=[summary])
        w, api = worker(hub)
        w.send_morning_reviews()
        prompt = hub.gemini_calls[0]["contents"][0]["parts"][0]["text"]
        self.assertIn("I goed home.", prompt)
        self.assertIn('- "goed" -> "went"', prompt)
        self.assertEqual([t.split("\n")[0] for _, t in api.sent], ["Good morning! Yesterday you talked about the park.",
                                                                  "🧠 오늘 복습할 표현이 1개 있어요. 지난번에 고친 표현을 떠올려 봐요!"])

    def test_a_quiet_day_needs_no_model_call(self):
        hub = Hub(rpc={"claim_due_telegram_reviews": [{"userId": USER, "chatId": 1001, "today": "2026-10-05",
                                                       "yesterdayTurns": [], "yesterdayCorrections": []}],
                       "get_telegram_quiz_cards": []})
        w, api = worker(hub)
        w.send_morning_reviews()
        self.assertEqual(hub.gemini_calls, [])
        self.assertIn("did not leave any study messages yesterday", api.sent[0][1])


class Settings(unittest.TestCase):
    def test_secrets_never_appear_in_repr(self):
        text = repr(settings())
        for secret in ["service-secret", "bot-secret", "gemini-secret", "openai-secret"]:
            self.assertNotIn(secret, text)

    def test_the_tutor_only_starts_when_switched_on_and_fully_configured(self):
        full = {"TELEGRAM_ENABLED": "true", "SUPABASE_URL": "https://db", "SUPABASE_SERVICE_ROLE_KEY": "s",
                "TELEGRAM_BOT_TOKEN": "t", "GEMINI_API_KEY": "g", "GEMINI_MODEL": "gemini-3.5-flash-lite"}
        with patch.dict("os.environ", full, clear=True):
            self.assertTrue(TelegramSettings.from_env().enabled)
        for missing in ["TELEGRAM_ENABLED", "TELEGRAM_BOT_TOKEN", "GEMINI_API_KEY", "GEMINI_MODEL"]:
            with patch.dict("os.environ", {k: v for k, v in full.items() if k != missing}, clear=True):
                self.assertFalse(TelegramSettings.from_env().enabled, missing)


class Loop(unittest.TestCase):
    def test_one_bad_update_does_not_stop_the_others_and_nothing_is_logged(self):
        hub = Hub(ctx=context(), gemini=[tutor_answer()])
        w, api = worker(hub)
        stop = threading.Event()
        batches = [[{"update_id": 1, "message": "broken"}, text_update(SOURCE, message_id=2)]]

        def updates(offset, timeout):
            if batches:
                return batches.pop(0)
            stop.set()
            return []

        w.api.get_updates = updates
        with self.assertNoLogs(level=logging.DEBUG):
            w.run(stop)
        self.assertEqual(len(hub.calls("record_telegram_turn")), 1)

    def test_a_conflict_backs_off_instead_of_spinning(self):
        hub = Hub(ctx=context())
        w, _ = worker(hub)
        stop = threading.Event()
        waits = []

        def updates(offset, timeout):
            raise SafeFailure("TELEGRAM_CONFLICT")

        def wait(seconds):
            waits.append(seconds)
            stop.set()
            return True

        w.api.get_updates = updates
        stop.wait = wait
        w.run(stop)
        self.assertEqual(waits, [30])


class BotApi(unittest.TestCase):
    def fake(self, *answers):
        calls = []

        def exchange(method, url, body, headers, timeout, limit=None):
            calls.append({"method": method, "url": url, "body": body, "headers": headers, "timeout": timeout})
            status, payload = answers[min(len(calls) - 1, len(answers) - 1)]
            return status, payload if isinstance(payload, bytes) else json.dumps(payload).encode()

        return TelegramApi("123:bot-secret", exchange), calls

    def test_html_refused_by_telegram_is_resent_as_plain_text(self):
        api, calls = self.fake((400, {"ok": False, "description": "Bad Request: can't parse entities"}), (200, {"ok": True, "result": {}}))
        api.send_formatted(1001, "**hi** ||x||")
        first, second = (json.loads(c["body"]) for c in calls)
        self.assertEqual((first["parse_mode"], first["text"]), ("HTML", "<b>hi</b> <tg-spoiler>x</tg-spoiler>"))
        self.assertNotIn("parse_mode", second)
        self.assertEqual(second["text"], "hi x")

    def test_failures_carry_codes_never_the_token(self):
        for status, code in [(409, "TELEGRAM_CONFLICT"), (429, "TELEGRAM_RATE_LIMIT"), (403, "TELEGRAM_ERROR")]:
            api, _ = self.fake((status, {"ok": False, "description": "x"}))
            with self.assertRaises(SafeFailure) as failure:
                api.get_updates(None)
            self.assertEqual(str(failure.exception), code)
            self.assertNotIn("bot-secret", repr(failure.exception))

    def test_long_polling_waits_longer_than_telegram_holds_the_request(self):
        api, calls = self.fake((200, {"ok": True, "result": []}))
        api.get_updates(41, 25)
        self.assertEqual(json.loads(calls[0]["body"]), {"timeout": 25, "limit": 20, "allowed_updates": ["message"], "offset": 41})
        self.assertGreater(calls[0]["timeout"], 25)

    def test_a_file_path_that_could_leave_the_file_api_is_refused(self):
        for path in ["../x", "voice/../../bot", "voice/a b.oga", ""]:
            api, calls = self.fake((200, {"ok": True, "result": {"file_path": path, "file_size": 10}}))
            with self.assertRaises(SafeFailure):
                api.download_voice("f")
            self.assertEqual(len(calls), 1, path)

    def test_voice_is_uploaded_as_multipart(self):
        api, calls = self.fake((200, {"ok": True, "result": {}}))
        api.send_voice(1001, b"OggS")
        self.assertTrue(calls[0]["headers"]["Content-Type"].startswith("multipart/form-data; boundary="))
        self.assertIn(b'name="voice"; filename="reply.ogg"', calls[0]["body"])
        self.assertIn(b"OggS", calls[0]["body"])


if __name__ == "__main__":
    unittest.main()
