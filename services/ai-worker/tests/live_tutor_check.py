"""Opt-in check against the real Gemini (and OpenAI TTS for the voice case). Costs money.

    pnpm test:tutor:live

Runs only when PACEON_LIVE_TUTOR=1 and GEMINI_API_KEY is set. The file name does not
start with test_, so `pnpm test:ai:worker` never picks it up. The cases are the ones
TAIET passed with the real model (TAIET docs/PACEON_MERGE.md section 9). Model output is
not deterministic; a single miss is worth a rerun before it is called a regression.
"""

import os
import unittest

from app.gemini import GeminiClient
from app.telegram_api import synthesize_voice
from app.telegram_tutor import Tutor, compose_tutor_message, rewrite_is_exact

LIVE = os.getenv("PACEON_LIVE_TUTOR") == "1" and bool(os.getenv("GEMINI_API_KEY"))
BUYED = "Yesterday I go to the park and buyed a apple."
CAMPING = "It was great experience go camping with my family."
COFFEE = "He don't like coffee, he prefer tea."
PENDING = {
    BUYED: {"original": BUYED, "target": "Yesterday I went to the park and bought an apple.",
            "fixes": [["go", "went"], ["buyed", "bought"], ["a apple", "an apple"]]},
    CAMPING: {"original": CAMPING, "target": "It was a great experience going camping with my family.",
              "fixes": [["great experience", "a great experience"], ["go camping", "going camping"]]},
    COFFEE: {"original": COFFEE, "target": "He doesn't like coffee, he prefers tea.",
             "fixes": [["don't", "doesn't"], ["prefer", "prefers"]]},
}


@unittest.skipUnless(LIVE, "set PACEON_LIVE_TUTOR=1 and GEMINI_API_KEY to call the real model")
class LiveTutor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tutor = Tutor(GeminiClient(os.environ["GEMINI_API_KEY"], os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")))

    def turn(self, text, pending=None):
        return self.tutor.tutor_turn("intermediate", None, [], text=text, pending_rewrite=pending)

    def test_mistakes_found_in_one_turn(self):
        for text, expected in [
            (BUYED, 3),
            ("I am very interesting in learn English because I want to travel abroad.", 2),
            ("Could you explain me the difference between 'make' and 'do'?", 1),
            ("I have been working here for three years.", 0),
            (COFFEE, 2),
        ]:
            with self.subTest(text=text):
                turn = self.turn(text)
                self.assertEqual(len(turn.mistakes), expected, [(m.wrong, m.correct) for m in turn.mistakes])
                message, _ = compose_tutor_message(turn, text, None, False)
                if expected == 0:
                    self.assertIn("👍", message)
                if expected == 3:
                    self.assertIn("그 밖에 1곳", message, "three found, two explained")

    def test_a_korean_question_gets_english_and_a_request_to_write_it(self):
        text = "이거 영어로 어떻게 말해? 회의가 다음 주로 미뤄졌어"
        turn = self.turn(text)
        self.assertTrue(turn.learner_used_korean)
        self.assertEqual(turn.mistakes, [])
        self.assertTrue(turn.natural_version)
        message, pending = compose_tutor_message(turn, text, None, False)
        self.assertIn("✍️ 위 문장을 직접 한 번 써 보세요!", message)
        self.assertIsNotNone(pending)

    def test_rewrites_are_graded_against_every_required_fix(self):
        for original, attempt, expected in [
            (BUYED, "Yesterday I went to the park and bought an apple.", True),
            (BUYED, "I went to the park yesterday and bought an apple.", True),
            (BUYED, "Yesterday I went to the park and buyed an apple.", False),
            (BUYED, "Yesterday I went to the park and bought a apple.", False),
            (BUYED, "Yesterday I go to the park and bought an apple.", False),
            (BUYED, "By the way, what's your favorite movie?", None),
            (CAMPING, "It was a great experience going camping with my family.", True),
            (CAMPING, "It was great experience going camping with my family.", False),
            (COFFEE, "He doesn't like coffee, he prefers tea.", True),
            (COFFEE, "He doesn't like coffee, he prefer tea.", False),
        ]:
            with self.subTest(attempt=attempt):
                pending = PENDING[original]
                turn = self.turn(attempt, pending)
                if expected is None:
                    self.assertFalse(turn.rewrite_check.is_attempt, "a new topic is not an attempt")
                    continue
                self.assertTrue(turn.rewrite_check.is_attempt)
                correct = turn.rewrite_check.correct or rewrite_is_exact(attempt, pending)
                self.assertEqual(correct, expected, turn.rewrite_check.comment)

    @unittest.skipUnless(os.getenv("OPENAI_API_KEY"), "the voice case makes its audio with OpenAI TTS")
    def test_a_voice_note_is_transcribed_and_corrected_in_one_call(self):
        audio = synthesize_voice(os.environ["OPENAI_API_KEY"], os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
                                 os.getenv("OPENAI_TTS_VOICE", "marin"),
                                 "Last weekend I go to Busan with my family and we eats a lot of seafood.")
        turn = self.tutor.tutor_turn("intermediate", None, [], audio=audio)
        self.assertIn("busan", turn.transcript.lower())
        self.assertIn("eats", turn.transcript.lower())
        fixes = {(m.wrong.lower(), m.correct.lower()) for m in turn.mistakes}
        self.assertEqual(len(turn.mistakes), 2, fixes)
        self.assertTrue(any(w == "go" and c == "went" for w, c in fixes), fixes)
        self.assertTrue(any("eats" in w and "ate" in c for w, c in fixes), fixes)


if __name__ == "__main__":
    unittest.main()
