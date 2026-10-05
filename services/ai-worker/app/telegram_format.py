"""Telegram message formatting, carried over unchanged from TAIET (main.py @2c7def5).

Bot messages are written with a small Markdown (**bold**, *italic*, `code`, ||spoiler||)
and sent as Telegram HTML. Learner and model text is escaped before tags are added.
"""

import re
from html import escape as html_escape

TELEGRAM_MESSAGE_LIMIT = 4096
# HTML 변환 시 태그/이스케이프로 길이가 늘어나므로 여유를 둔 분할 기준
FORMATTED_CHUNK_LIMIT = 3500

_MD_HEADING = re.compile(r"^(\s*)#{1,6}\s+(.*)$", re.MULTILINE)
_MD_BULLET = re.compile(r"^(\s*)[*-]\s+", re.MULTILINE)
_MD_BOLD = re.compile(r"\*\*(.+?)\*\*")
_MD_ITALIC = re.compile(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])")
_MD_CODE = re.compile(r"`([^`\n]+)`")
# 텔레그램 MarkdownV2 문법과 같은 ||스포일러|| (탭해야 보이는 정답 가리기)
_MD_SPOILER = re.compile(r"\|\|(.+?)\|\|")
_MD_HORIZONTAL_RULE = re.compile(r"^[ \t]*([*_-])(?:[ \t]*\1){2,}[ \t]*$", re.MULTILINE)
_EXTRA_BLANK_LINES = re.compile(r"\n{3,}")


def _normalize_markdown_lines(text: str) -> str:
    """구분선(***, ---, ___)은 제거, 제목은 굵은 글씨로, '* '/'- ' 목록은 '• '로 통일"""
    text = _MD_HORIZONTAL_RULE.sub("", text)
    text = _EXTRA_BLANK_LINES.sub("\n\n", text)
    text = _MD_HEADING.sub(r"\1**\2**", text)
    return _MD_BULLET.sub(r"\1• ", text)


def markdown_to_telegram_html(text: str) -> str:
    """Gemini/봇 메시지의 간단한 Markdown을 텔레그램 HTML(parse_mode=HTML)로 변환"""
    html = html_escape(_normalize_markdown_lines(text), quote=False)
    html = _MD_BOLD.sub(r"<b>\1</b>", html)
    html = _MD_ITALIC.sub(r"<i>\1</i>", html)
    html = _MD_SPOILER.sub(r"<tg-spoiler>\1</tg-spoiler>", html)
    return _MD_CODE.sub(r"<code>\1</code>", html)


def strip_markdown(text: str) -> str:
    """Markdown 기호 제거 (HTML 전송 실패 시 대체 텍스트, TTS 입력용)"""
    text = _MD_BOLD.sub(r"\1", _normalize_markdown_lines(text))
    text = _MD_ITALIC.sub(r"\1", text)
    text = _MD_SPOILER.sub(r"\1", text)
    return _MD_CODE.sub(r"\1", text)


def normalize_sentence(text: str) -> str:
    """문장 비교용 정규화 (대소문자, 구두점, 둥근 따옴표, 공백 차이 무시)"""
    text = (text or "").lower().replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    text = re.sub(r"[^\w\s']", " ", text)
    return " ".join(text.split())


def split_telegram_message(text: str, limit: int = TELEGRAM_MESSAGE_LIMIT) -> list[str]:
    """텔레그램 길이 제한에 맞게 문단/줄 경계 기준으로 메시지 분할"""
    if len(text) <= limit:
        return [text]

    chunks = []
    remaining = text
    while len(remaining) > limit:
        cut = remaining.rfind("\n\n", 0, limit)
        if cut <= 0:
            cut = remaining.rfind("\n", 0, limit)
        if cut <= 0:
            cut = remaining.rfind(" ", 0, limit)
        if cut <= 0:
            cut = limit
        chunks.append(remaining[:cut].rstrip())
        remaining = remaining[cut:].lstrip()
    if remaining:
        chunks.append(remaining)
    return chunks


def extract_conversation_only(text: str) -> str:
    """피드백 섹션을 제외한 대화 내용만 추출"""
    if '[Feedback]' in text:
        return text.split('[Feedback]')[0].strip()
    elif '**Feedback**' in text:
        return text.split('**Feedback**')[0].strip()
    return text.strip()
