"""Telegram Bot API calls and OpenAI voice synthesis for the tutor.

The bot token sits in every URL path, so no URL, request or response body is ever put
into an exception or a log. Failures carry fixed codes only:

- TELEGRAM_PARSE     Telegram refused the HTML (the caller resends as plain text)
- TELEGRAM_CONFLICT  another process is reading this bot's updates
- TELEGRAM_RATE_LIMIT, TELEGRAM_ERROR, PROVIDER_ERROR, RESPONSE_TOO_LARGE
"""

import json
import re
import uuid

from app.telegram_format import FORMATTED_CHUNK_LIMIT, markdown_to_telegram_html, split_telegram_message, strip_markdown
from app.worker import SafeFailure, exchange

API = "https://api.telegram.org/bot{token}/{method}"
FILE = "https://api.telegram.org/file/bot{token}/{path}"
FILE_PATH = re.compile(r"^[A-Za-z0-9_\-]+(?:/[A-Za-z0-9_\-.]+)*$")
MAX_VOICE_BYTES = 5 * 1024 * 1024
MAX_UPDATES_BYTES = 2 * 1024 * 1024

# gpt-4o-mini-tts는 말투 지시를 받을 수 있으므로 학습자가 알아듣기 쉽게 요청 (TAIET 그대로)
OPENAI_TTS_INSTRUCTIONS = (
    "You are a friendly English tutor speaking to a Korean learner. "
    "Speak clearly at a slightly slower pace than normal, with natural intonation."
)

COMMANDS = [
    {"command": "start", "description": "Start the bot and see welcome message"},
    {"command": "help", "description": "Show help and all commands"},
    {"command": "review", "description": "Review your past mistakes (quiz)"},
    {"command": "topic", "description": "Get conversation topic suggestions"},
    {"command": "level", "description": "Check or set your difficulty level"},
    {"command": "scenario", "description": "Practice role-play scenarios"},
    {"command": "voice_on", "description": "Enable voice responses"},
    {"command": "voice_off", "description": "Disable voice responses"},
    {"command": "set_review", "description": "Set daily review time"},
    {"command": "stats", "description": "View your learning statistics"},
    {"command": "link", "description": "Link this chat to your PaceOn account"},
    {"command": "unlink", "description": "Unlink this chat from PaceOn"},
]


class TelegramApi:
    def __init__(self, token: str, exchange_fn=exchange):
        self.token = token
        self.exchange = exchange_fn

    def call(self, method: str, payload: dict, timeout: int = 15, limit: int = 256 * 1024):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        status, raw = self.exchange(
            "POST", API.format(token=self.token, method=method), body,
            {"Content-Type": "application/json"}, timeout, limit=limit,
        )
        return self._result(status, raw)

    @staticmethod
    def _result(status, raw):
        try:
            answer = json.loads(raw)
        except ValueError:
            raise SafeFailure("TELEGRAM_ERROR") from None
        if status == 200 and isinstance(answer, dict) and answer.get("ok") is True:
            return answer.get("result")
        description = str((answer or {}).get("description") or "").lower() if isinstance(answer, dict) else ""
        if status == 400 and "can't parse entities" in description:
            raise SafeFailure("TELEGRAM_PARSE")
        if status == 409:
            raise SafeFailure("TELEGRAM_CONFLICT")
        if status == 429:
            raise SafeFailure("TELEGRAM_RATE_LIMIT")
        raise SafeFailure("TELEGRAM_ERROR")

    def get_updates(self, offset, timeout: int = 25) -> list:
        payload = {"timeout": timeout, "limit": 20, "allowed_updates": ["message"]}
        if offset is not None:
            payload["offset"] = offset
        result = self.call("getUpdates", payload, timeout=timeout + 10, limit=MAX_UPDATES_BYTES)
        return result if isinstance(result, list) else []

    def send_message(self, chat_id: int, text: str, html: bool = True):
        payload = {"chat_id": chat_id, "text": text, "link_preview_options": {"is_disabled": True}}
        if html:
            payload["parse_mode"] = "HTML"
        return self.call("sendMessage", payload)

    def send_formatted(self, chat_id: int, text: str):
        """Markdown을 텔레그램 HTML로 변환해 길이 제한에 맞게 나눠 전송

        Gemini 응답의 Markdown이 깨져 있어 텔레그램이 거부하면 일반 텍스트로 다시 보낸다.
        """
        for chunk in split_telegram_message(text, limit=FORMATTED_CHUNK_LIMIT):
            try:
                self.send_message(chat_id, markdown_to_telegram_html(chunk))
            except SafeFailure as failure:
                if str(failure) != "TELEGRAM_PARSE":
                    raise
                self.send_message(chat_id, strip_markdown(chunk), html=False)

    def send_chat_action(self, chat_id: int, action: str = "typing"):
        return self.call("sendChatAction", {"chat_id": chat_id, "action": action})

    def set_my_commands(self, commands=COMMANDS):
        return self.call("setMyCommands", {"commands": commands})

    def download_voice(self, file_id: str) -> bytes:
        info = self.call("getFile", {"file_id": file_id})
        path = (info or {}).get("file_path") if isinstance(info, dict) else None
        size = (info or {}).get("file_size") if isinstance(info, dict) else None
        if not isinstance(path, str) or not FILE_PATH.match(path) or ".." in path:
            raise SafeFailure("TELEGRAM_ERROR")
        if isinstance(size, int) and size > MAX_VOICE_BYTES:
            raise SafeFailure("RESPONSE_TOO_LARGE")
        status, raw = self.exchange("GET", FILE.format(token=self.token, path=path), None, {}, 30, limit=MAX_VOICE_BYTES)
        if status != 200 or not raw:
            raise SafeFailure("TELEGRAM_ERROR")
        return raw

    def send_voice(self, chat_id: int, audio: bytes):
        boundary = "paceon" + uuid.uuid4().hex
        body = b"".join([
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n{chat_id}\r\n".encode(),
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"voice\"; filename=\"reply.ogg\"\r\n"
            "Content-Type: audio/ogg\r\n\r\n".encode(),
            audio,
            f"\r\n--{boundary}--\r\n".encode(),
        ])
        status, raw = self.exchange(
            "POST", API.format(token=self.token, method="sendVoice"), body,
            {"Content-Type": f"multipart/form-data; boundary={boundary}"}, 30,
        )
        return self._result(status, raw)


def synthesize_voice(api_key: str, model: str, voice: str, text: str, exchange_fn=exchange) -> bytes:
    """OpenAI TTS as OGG/Opus, the format Telegram plays as a voice message."""
    body = json.dumps({
        "model": model, "voice": voice, "input": text[:4000],
        "instructions": OPENAI_TTS_INSTRUCTIONS, "response_format": "opus",
    }).encode("utf-8")
    status, raw = exchange_fn(
        "POST", "https://api.openai.com/v1/audio/speech", body,
        {"Content-Type": "application/json", "Authorization": "Bearer " + api_key}, 45, limit=MAX_VOICE_BYTES,
    )
    if status != 200 or not raw:
        raise SafeFailure("PROVIDER_ERROR")
    return raw
