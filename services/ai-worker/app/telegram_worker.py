"""Telegram English tutor consumer (docs/TELEGRAM_TUTOR.md).

Reads the bot's updates by long polling and answers in the same thread, so one
learner's messages are handled in order. A failure in one update is caught there and
never stops the thread or the other consumers.

Only linked Telegram accounts reach the model. Everyone else gets linking instructions,
with no AI call. Nothing is logged: updates carry the learner's own sentences, model
answers carry corrections of them, and every Bot API URL carries the token.
"""

import os
import threading
import time
from dataclasses import dataclass, field

from app.gemini import GeminiClient
from app.telegram_api import TelegramApi, synthesize_voice
from app.telegram_format import extract_conversation_only, strip_markdown
from app.telegram_tutor import (
    QUIZ_SIZE, QuizGrade, Tutor, compose_tutor_message, correction_cards, next_review,
    quick_grade, quiz_question_text, rewrite_is_exact,
)
from app.worker import SafeFailure, exchange, post_json

LEVELS = ("beginner", "intermediate", "advanced")
SCENARIOS = ("airport", "restaurant", "interview", "shopping", "meeting")
MAX_TEXT = 4000
MAX_VOICE_SECONDS = 120

WELCOME = """👋 Welcome to AI English Tutor!

I'm your personal English conversation partner powered by Google Gemini.

🎯 **Features:**
• Natural conversation practice
• Instant grammar feedback
• Voice message support
• Daily morning review
• Mistake notebook with spaced-repetition quizzes
• Topic suggestions
• Role-play scenarios

📚 **Commands:**
/review - Review your past mistakes (quiz)
/topic - Get conversation topic suggestions
/level [beginner|intermediate|advanced] - Set your level
/scenario [airport|restaurant|interview|shopping|meeting] - Start role-play
/voice_on - Enable voice responses
/voice_off - Disable voice responses
/set_review HH:MM - Set daily review time
/stats - View your learning statistics
/unlink - Unlink this chat from PaceOn
/help - Show this message again

💬 **How to use:**
Just send me a message in English and I'll respond with feedback!
Answers are hidden — tap them to reveal. Try rewriting your sentence first,
and the mistakes you make come back as review quizzes (1, 3, 7, 14, 30 days later).
They also show up in PaceOn's review on the web.

Let's start! Tell me about yourself. 😊"""

LINK_REQUIRED = """👋 PaceOn 영어 튜터예요.

먼저 PaceOn 계정과 연결해 주세요.
1. PaceOn 웹 → **설정** → **텔레그램 튜터**에서 연결 코드를 받아요.
2. 여기로 `/link 코드`를 보내 주세요. (예: `/link AB12CD34`)"""

LINK_RESULTS = {
    "LINKED": "✅ PaceOn 계정과 연결했어요!\n\n이제 영어로 말을 걸어 보세요. 교정받은 표현은 PaceOn 복습에도 쌓여요. 명령어는 /help 에서 볼 수 있어요.",
    "INVALID_CODE": "❌ 코드가 맞지 않거나 만료됐어요. PaceOn 설정에서 새 코드를 받아 `/link 코드`로 보내 주세요.",
    "TELEGRAM_IN_USE": "❌ 이 텔레그램 계정은 다른 PaceOn 계정에 연결돼 있어요. 그 계정에서 먼저 연결을 해제해 주세요.",
}
LINK_USAGE = "PaceOn 설정에서 받은 코드를 함께 보내 주세요. 예: `/link AB12CD34`"
UNLINKED = "연결을 해제했어요. 지금까지의 대화와 복습 카드는 PaceOn에 남아 있어요. 다시 이으려면 새 코드를 받아 주세요."
DAILY_LIMIT = "오늘은 대화를 충분히 했어요. 내일 다시 이야기해요! 😊"
TOO_LONG = "메시지가 너무 길어요. 4000자 이내로 나눠 보내 주세요."
VOICE_TOO_LONG = "음성은 2분 이내로 보내 주세요."
TUTOR_ERROR = "Sorry, I encountered an error. Please try again."
VOICE_ERROR = "Sorry, I couldn't process your voice message. Please try again."

LEVEL_DESCRIPTIONS = {
    'beginner': "Simple vocabulary and clear explanations",
    'intermediate': "Natural expressions and everyday vocabulary",
    'advanced': "Idioms, phrasal verbs, and sophisticated language",
}
SCENARIO_INTROS = {
    'airport': "✈️ Welcome to the airport! I'll help you check in. May I see your passport and ticket?",
    'restaurant': "🍽️ Good evening! Welcome to our restaurant. Have you made a reservation?",
    'interview': "👔 Hello! Thank you for coming in today. Please have a seat. Tell me about yourself.",
    'shopping': "👕 Hi! Welcome to our store. Are you looking for something specific today?",
    'meeting': "💼 Good morning everyone. Let's start our meeting. Shall we review the project status?",
}
SCENARIO_LIST = (
    "🎭 **Available Scenarios:**\n\n"
    "/scenario airport - Airport check-in\n"
    "/scenario restaurant - Restaurant ordering\n"
    "/scenario interview - Job interview\n"
    "/scenario shopping - Clothes shopping\n"
    "/scenario meeting - Business meeting\n\n"
    "/scenario off - Exit scenario mode"
)


@dataclass(frozen=True)
class TelegramSettings:
    enabled: bool
    supabase_url: str
    service_key: str = field(repr=False)
    bot_token: str = field(repr=False)
    gemini_key: str = field(repr=False)
    gemini_model: str
    openai_key: str = field(default="", repr=False)
    tts_model: str = "gpt-4o-mini-tts"
    tts_voice: str = "marin"
    daily_turn_limit: int = 300
    poll_timeout: int = 25

    @classmethod
    def from_env(cls):
        url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
        service = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        key = os.getenv("GEMINI_API_KEY", "").strip()
        model = os.getenv("GEMINI_MODEL", "").strip()
        try:
            limit = int(os.getenv("TELEGRAM_DAILY_TURN_LIMIT", "300"))
            if not 1 <= limit <= 5000:
                limit = 300
        except ValueError:
            limit = 300
        enabled = os.getenv("TELEGRAM_ENABLED") == "true" and bool(url and service and token and key and model)
        return cls(
            enabled, url, service, token, key, model,
            os.getenv("OPENAI_API_KEY", "").strip(),
            os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts").strip() or "gpt-4o-mini-tts",
            os.getenv("OPENAI_TTS_VOICE", "marin").strip() or "marin",
            limit,
        )


class TelegramWorker:
    def __init__(self, settings: TelegramSettings, api=None, gemini=None, transport=post_json,
                 exchange_fn=exchange, clock=time.monotonic):
        self.settings = settings
        self.transport = transport
        self.exchange = exchange_fn
        self.clock = clock
        self.api = api or TelegramApi(settings.bot_token, exchange_fn)
        self.tutor = Tutor(gemini or GeminiClient(settings.gemini_key, settings.gemini_model, transport))

    # ---------- plumbing ----------

    def rpc(self, name, payload):
        return self.transport(
            self.settings.supabase_url + "/rest/v1/rpc/" + name, payload,
            {"apikey": self.settings.service_key, "Authorization": "Bearer " + self.settings.service_key}, 15,
        )

    def say(self, chat_id, text):
        self.api.send_formatted(chat_id, text)

    def run(self, stop: threading.Event):
        if not self.settings.enabled:
            return
        try:
            self.api.set_my_commands()
        except Exception:
            pass
        offset = None
        next_review_check = 0.0
        while not stop.is_set():
            if self.clock() >= next_review_check:
                next_review_check = self.clock() + 60
                try:
                    self.send_morning_reviews()
                except Exception:
                    pass
            try:
                updates = self.api.get_updates(offset, self.settings.poll_timeout)
            except SafeFailure as failure:
                # Another reader of this token means two bots are polling. Back off rather than fight.
                stop.wait(30 if str(failure) == "TELEGRAM_CONFLICT" else 5)
                continue
            except Exception:
                stop.wait(5)
                continue
            for update in updates:
                if isinstance(update, dict) and isinstance(update.get("update_id"), int):
                    offset = update["update_id"] + 1
                try:
                    self.handle_update(update)
                except Exception:
                    pass

    # ---------- one update ----------

    def handle_update(self, update):
        message = update.get("message") if isinstance(update, dict) else None
        if not isinstance(message, dict):
            return
        chat = message.get("chat") or {}
        sender = message.get("from") or {}
        if chat.get("type") != "private" or not isinstance(sender.get("id"), int) or sender.get("is_bot"):
            return
        chat_id = chat.get("id")
        if not isinstance(chat_id, int):
            return
        text = message.get("text") if isinstance(message.get("text"), str) else None
        voice = message.get("voice") if isinstance(message.get("voice"), dict) else None
        if text is None and voice is None:
            return
        context = self.rpc("get_telegram_context", {"p_telegram_user_id": sender["id"]})
        if not isinstance(context, dict):
            context = None
        if text is not None and text.startswith("/"):
            self.handle_command(text, chat_id, sender["id"], context)
            return
        if context is None:
            # Not linked: no model call, ever.
            self.say(chat_id, LINK_REQUIRED)
            return
        if voice is not None:
            self.handle_voice(message, voice, chat_id, context)
            return
        if len(text) > MAX_TEXT:
            self.say(chat_id, TOO_LONG)
            return
        if self.handle_quiz_answer(chat_id, context, text):
            return
        if self.limit_reached(chat_id, context):
            return
        try:
            self.api.send_chat_action(chat_id)
        except Exception:
            pass
        self.run_tutor_turn(message, chat_id, context, text=text)

    def limit_reached(self, chat_id, context) -> bool:
        if int(context.get("turnsToday") or 0) >= self.settings.daily_turn_limit:
            self.say(chat_id, DAILY_LIMIT)
            return True
        return False

    def handle_voice(self, message, voice, chat_id, context):
        """음성 메시지 처리 (퀴즈 진행 중이어도 일반 대화로 처리하고 퀴즈는 유지)"""
        duration = voice.get("duration")
        if isinstance(duration, (int, float)) and duration > MAX_VOICE_SECONDS:
            self.say(chat_id, VOICE_TOO_LONG)
            return
        if self.limit_reached(chat_id, context):
            return
        self.say(chat_id, "🎧 Processing your voice message...")
        try:
            audio = self.api.download_voice(str(voice.get("file_id") or ""))
        except Exception:
            self.say(chat_id, VOICE_ERROR)
            return
        self.run_tutor_turn(message, chat_id, context, audio=audio)

    # ---------- tutor turn ----------

    def run_tutor_turn(self, message, chat_id, context, text=None, audio=None):
        """텍스트/음성 메시지 1건을 튜터로 처리 (교정, 고쳐 쓰기 채점, 교정 카드 저장, 응답 전송)"""
        pending = context.get("pendingRewrite") if isinstance(context.get("pendingRewrite"), dict) else None
        # 음성은 히스토리 없이 처리 (텍스트는 최근 3턴을 배경 컨텍스트로)
        history = [] if audio is not None else (context.get("history") or [])
        level = str(context.get("level") or "INTERMEDIATE").lower()
        scenario = context.get("scenario")
        try:
            turn = self.tutor.tutor_turn(
                level, scenario.lower() if isinstance(scenario, str) else None, history,
                text=text, audio=audio, pending_rewrite=pending,
            )
        except Exception:
            self.say(chat_id, TUTOR_ERROR if audio is None else VOICE_ERROR)
            return

        user_content = text if audio is None else (turn.transcript or "[Voice message]")
        attempted = pending if (pending and turn.rewrite_check.is_attempt) else None
        # 목표 문장과 똑같이 썼으면 모델 판정과 무관하게 정답 처리
        if rewrite_is_exact(user_content, attempted):
            turn.rewrite_check.correct = True

        reply, new_pending = compose_tutor_message(turn, user_content, attempted, audio is not None)
        # 고쳐 쓰기 시도는 새 실수로 세지 않음 (같은 실수를 두 번 기록하지 않도록)
        cards = [] if attempted else correction_cards(turn, user_content)
        try:
            self.rpc("record_telegram_turn", {"p_user_id": context["userId"], "p_turn": {
                "chatId": chat_id,
                "messageId": message.get("message_id"),
                "inputKind": "TEXT" if audio is None else "VOICE",
                "learnerText": user_content[:MAX_TEXT],
                "tutorTurn": turn.model_dump(),
                "replyText": reply[:8000],
                "mistakeCount": 0 if attempted else len(turn.mistakes),
                "rewriteAttempt": attempted is not None,
                "rewriteCorrect": turn.rewrite_check.correct if attempted else None,
                "cards": cards,
                "pendingRewrite": new_pending,
            }})
        except Exception:
            # The learner still gets the answer; this turn is just not kept.
            pass
        self.say(chat_id, reply)
        if context.get("voiceReplies"):
            self.send_voice_reply(chat_id, reply)

    def send_voice_reply(self, chat_id, reply):
        """대화 내용만 음성으로 (피드백 제외, Markdown 기호 제거). 실패하면 텍스트만 남는다."""
        if not self.settings.openai_key:
            return
        spoken = strip_markdown(extract_conversation_only(reply))
        if not spoken:
            return
        try:
            audio = synthesize_voice(self.settings.openai_key, self.settings.tts_model,
                                     self.settings.tts_voice, spoken, self.exchange)
            self.api.send_voice(chat_id, audio)
        except Exception:
            pass

    # ---------- quiz ----------

    def start_quiz(self, user_id):
        """오늘 복습할 교정 카드로 퀴즈 시작. 복습할 카드가 없으면 None"""
        due = self.rpc("get_telegram_quiz_cards", {"p_user_id": user_id, "p_limit": QUIZ_SIZE})
        if not isinstance(due, list) or not due:
            return None
        state = {"cards": due, "total": len(due), "correct": 0}
        self.rpc("save_telegram_quiz_state", {"p_user_id": user_id, "p_state": state})
        return (
            f"🧠 오늘 복습할 표현이 {len(due)}개 있어요. 지난번에 고친 표현을 떠올려 봐요!\n\n"
            + quiz_question_text(due[0], 1, len(due))
        )

    def handle_quiz_answer(self, chat_id, context, answer) -> bool:
        """진행 중인 퀴즈가 있으면 답으로 채점. 메시지를 처리했으면 True"""
        state = context.get("quizState")
        if not isinstance(state, dict) or not state.get("cards"):
            return False
        user_id = context["userId"]
        card = state["cards"][0]
        if quick_grade(card, answer):
            grade = QuizGrade(is_answer=True, correct=True, feedback="")
        else:
            try:
                grade = self.tutor.grade_quiz_answer(card, answer)
            except Exception:
                self.say(chat_id, "채점 중 오류가 났어요. 다시 한 번 답해 주세요.")
                return True
        if not grade.is_answer:
            # 퀴즈 대신 다른 이야기를 시작함 → 퀴즈 종료 후 일반 대화로 처리 (남은 카드는 다음 복습 때 다시 나옴)
            self.rpc("save_telegram_quiz_state", {"p_user_id": user_id, "p_state": None})
            return False

        following = next_review(card.get("reviewStep", 0), "EASY" if grade.correct else "HARD", context["today"])
        recorded = True
        try:
            self.rpc("record_correction_review", {
                "p_user_id": user_id, "p_id": card["id"], "p_step": following["step"],
                "p_due_on": following["dueOn"], "p_today": context["today"],
            })
        except Exception:
            # The card may have been removed on the web in the meantime.
            recorded = False
        if grade.correct:
            state["correct"] = int(state.get("correct") or 0) + 1
            lines = ["✅ 정답이에요!"]
        else:
            lines = [f"❌ 아쉬워요. 정답은 **{card['correctText']}** 예요."]
        if grade.feedback:
            lines.append(grade.feedback)
        if card.get("ruleText"):
            lines.append(f"📌 {card['ruleText']}")
        if recorded:
            lines.append("🗓️ 내일 다시 물어볼게요." if not grade.correct else f"🗓️ 다음 복습: {following['dueOn']}")

        state["cards"] = state["cards"][1:]
        total = int(state.get("total") or 1)
        if state["cards"]:
            number = total - len(state["cards"]) + 1
            lines.append("\n" + quiz_question_text(state["cards"][0], number, total))
            self.rpc("save_telegram_quiz_state", {"p_user_id": user_id, "p_state": state})
        else:
            self.rpc("save_telegram_quiz_state", {"p_user_id": user_id, "p_state": None})
            lines.append(
                f"\n🎉 복습 끝! {total}문제 중 {state['correct']}개 맞혔어요. "
                "이제 자유롭게 영어로 대화해 볼까요?"
            )
        self.say(chat_id, "\n".join(lines))
        return True

    # ---------- morning review ----------

    def send_morning_reviews(self):
        """아침 복습: 어제 대화 요약, 이어서 그날 차례가 된 교정 카드 퀴즈."""
        claimed = self.rpc("claim_due_telegram_reviews", {"p_limit": 20})
        for item in claimed if isinstance(claimed, list) else []:
            try:
                summary = self.tutor.summarize_for_review_english(
                    [t for t in item.get("yesterdayTurns") or [] if isinstance(t, str)],
                    [c for c in item.get("yesterdayCorrections") or [] if isinstance(c, dict)],
                )
                self.say(item["chatId"], summary)
                quiz = self.start_quiz(item["userId"])
                if quiz:
                    self.say(item["chatId"], quiz)
            except Exception:
                pass

    # ---------- commands ----------

    def handle_command(self, text, chat_id, telegram_user_id, context):
        head, *args = text.split()
        command = head[1:].split("@", 1)[0].lower()
        # PaceOn settings open t.me/<bot>?start=CODE, which arrives as "/start CODE".
        if command == "start" and args:
            command = "link"
        if command in ("start", "help"):
            self.say(chat_id, WELCOME if context else LINK_REQUIRED)
            return
        if command == "link":
            if not args:
                self.say(chat_id, LINK_USAGE)
                return
            result = self.rpc("link_telegram", {"p_code": args[0], "p_telegram_user_id": telegram_user_id, "p_chat_id": chat_id})
            self.say(chat_id, LINK_RESULTS.get(result, LINK_RESULTS["INVALID_CODE"]))
            return
        if context is None:
            self.say(chat_id, LINK_REQUIRED)
            return
        user_id = context["userId"]
        if command == "unlink":
            self.rpc("unlink_telegram_user", {"p_telegram_user_id": telegram_user_id})
            self.say(chat_id, UNLINKED)
        elif command == "review":
            self.review_command(chat_id, context)
        elif command == "topic":
            self.say(chat_id, "🤔 Generating interesting topics for you...")
            topics = self.tutor.generate_topics(3)
            body = "💡 **Here are some conversation topics:**\n\n"
            body += "".join(f"{i}. {topic}\n" for i, topic in enumerate(topics, 1))
            self.say(chat_id, body + "\nPick one and let's talk! 😊")
        elif command == "level":
            self.level_command(chat_id, user_id, context, args)
        elif command == "scenario":
            self.scenario_command(chat_id, user_id, args)
        elif command in ("voice_on", "voice_off"):
            on = command == "voice_on"
            self.rpc("update_telegram_settings", {"p_user_id": user_id, "p_settings": {"voiceReplies": on}})
            self.say(chat_id, "🔊 Voice mode **enabled**!\n\nI'll now respond with voice messages. 🎤" if on
                     else "🔇 Voice mode **disabled**!\n\nI'll respond with text only.")
        elif command == "set_review":
            self.set_review_command(chat_id, user_id, context, args)
        elif command == "stats":
            self.stats_command(chat_id, user_id, context)
        else:
            self.say(chat_id, WELCOME)

    def level_command(self, chat_id, user_id, context, args):
        if not args:
            current = str(context.get("level") or "INTERMEDIATE").lower()
            self.say(chat_id, f"📊 Your current level: **{current}**\n\n"
                              "To change your level, use:\n/level beginner\n/level intermediate\n/level advanced")
            return
        level = args[0].lower()
        if level not in LEVELS:
            self.say(chat_id, "❌ Invalid level. Choose: beginner, intermediate, or advanced")
            return
        self.rpc("update_telegram_settings", {"p_user_id": user_id, "p_settings": {"level": level.upper()}})
        self.say(chat_id, f"✅ Level set to **{level}**!\n\n{LEVEL_DESCRIPTIONS[level]}\n\nLet's continue our conversation! 😊")

    def scenario_command(self, chat_id, user_id, args):
        if not args:
            self.say(chat_id, SCENARIO_LIST)
            return
        scenario = args[0].lower()
        if scenario == "off":
            self.rpc("update_telegram_settings", {"p_user_id": user_id, "p_settings": {"scenario": None}})
            self.say(chat_id, "✅ Scenario mode disabled. Back to normal conversation!")
            return
        if scenario not in SCENARIOS:
            self.say(chat_id, "❌ Invalid scenario. Use /scenario to see available options.")
            return
        self.rpc("update_telegram_settings", {"p_user_id": user_id, "p_settings": {"scenario": scenario.upper()}})
        self.say(chat_id, f"🎭 **Scenario: {scenario.title()}**\n\n{SCENARIO_INTROS[scenario]}")

    def set_review_command(self, chat_id, user_id, context, args):
        if not args:
            self.say(chat_id, f"⏰ Current review time: **{context.get('reviewAt') or '07:00'}**\n\n"
                              "To change, use: /set_review HH:MM\nExample: /set_review 08:30")
            return
        value = args[0]
        parts = value.split(":")
        valid = (len(parts) == 2 and all(p.isdigit() for p in parts) and len(parts[1]) == 2
                 and 0 <= int(parts[0]) <= 23 and 0 <= int(parts[1]) <= 59)
        if not valid:
            self.say(chat_id, "❌ Invalid time format. Use HH:MM (e.g., 08:30)")
            return
        normalized = f"{int(parts[0]):02d}:{parts[1]}"
        self.rpc("update_telegram_settings", {"p_user_id": user_id, "p_settings": {"reviewAt": normalized}})
        self.say(chat_id, f"✅ Daily review time set to **{normalized}**!\n\n"
                          "I'll send you a summary of yesterday's learning every day at this time. 📚")

    def review_command(self, chat_id, context):
        """교정 카드 복습 퀴즈 시작"""
        state = context.get("quizState")
        if isinstance(state, dict) and state.get("cards"):
            total = int(state.get("total") or 1)
            number = total - len(state["cards"]) + 1
            self.say(chat_id, "진행 중인 복습이 있어요.\n\n" + quiz_question_text(state["cards"][0], number, total))
            return
        quiz = self.start_quiz(context["userId"])
        if quiz:
            self.say(chat_id, quiz)
            return
        stats = self.rpc("get_telegram_stats", {"p_user_id": context["userId"]}) or {}
        if not stats.get("cards"):
            self.say(chat_id, (
                "📒 아직 오답노트가 비어 있어요.\n"
                "영어로 대화하다가 교정받은 표현이 여기에 쌓이고, "
                "1 · 3 · 7 · 14 · 30일 간격으로 복습 퀴즈가 나와요."
            ))
        else:
            self.say(chat_id, (
                f"📒 지금 복습할 표현이 없어요.\n"
                f"오답노트 {stats['cards']}개\n"
                f"다음 복습일: {stats.get('nextDue') or '-'}"
            ))

    def stats_command(self, chat_id, user_id, context):
        stats = self.rpc("get_telegram_stats", {"p_user_id": user_id}) or {}
        recurring = "\n".join(
            f"• \"{m['wrongText']}\" → {m['correctText']} ({m['occurrences']}회)" for m in stats.get("recurring") or []
        ) or "• 아직 없어요"
        self.say(chat_id, f"""📊 **Your Learning Statistics**

🗓️ **This Week:**
• Messages sent: {stats.get('turns', 0)}
• Corrections received: {stats.get('corrections', 0)}
• Learning streak: {stats.get('streak', 0)} days 🔥

📒 **오답노트:**
• 총 {stats.get('cards', 0)}개 · 오늘 복습 {stats.get('due', 0)}개
• /review 로 지금 복습할 수 있어요

🔁 **자주 하는 실수:**
{recurring}

👤 **Profile:**
• Level: {str(context.get('level') or 'INTERMEDIATE').lower()}

Keep up the great work! 💪""")
