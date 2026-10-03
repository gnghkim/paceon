# 텔레그램 영어 튜터

텔레그램에서 영어로 말을 걸면 튜터가 대화를 이어 가며 실수를 고쳐 준다. 고쳐 준 실수는 PaceOn의 복습 카드가 되어 텔레그램 퀴즈와 웹 `/review`에서 같은 간격으로 다시 나온다.

미니 PC에서 따로 돌던 TAIET(`gnghkim/TAIET`, `main.py` @`2c7def5`)를 PaceOn Worker의 소비자로 옮긴 것이다. 병합 설계안은 TAIET 저장소 `docs/PACEON_MERGE.md`(@`53cce55`)이고, 이 문서는 그 설계를 PaceOn 관례에 맞춰 확정한 계약이다. 둘이 다르면 이 문서를 따른다.

> 상태: **설계 확정 전**. 14절 질문의 답을 받은 뒤 구현한다.

## 1. 결정 사항

| 항목 | 결정 |
| --- | --- |
| 실행 위치 | VPS Worker 안의 새 소비자 `TelegramWorker` 스레드 |
| 수신 | `getUpdates` long polling(`timeout` 25초, `allowed_updates=["message"]`). webhook과 작업 큐는 쓰지 않는다 |
| 튜터 AI | Gemini `gemini-3.5-flash-lite`. Worker transport로 REST 호출, `thinkingLevel` `MINIMAL`, temperature 미지정, 구조화 출력 |
| 음성 답장 | 기존 OpenAI TTS(`OPENAI_TTS_MODEL`) 그대로 |
| 교정 카드 | 교정받은 실수를 `learning_expressions.kind='CORRECTION'`으로 **자동 저장**. "AI가 고른 표현은 자동 저장하지 않는다" 원칙의 명시적 예외다. AI가 권한 표현이 아니라 학습자가 실제로 틀린 것이기 때문이다. `EXPRESSION`은 지금처럼 사용자가 직접 고를 때만 저장한다 |
| 복습 | 웹 `/review`와 텔레그램 퀴즈가 **같은 카드 행**을 갱신한다. 간격은 `expression-review.ts`의 `nextReview`를 따른다 |
| 계정 | 웹에서 발급한 일회용 코드로 텔레그램 사용자와 PaceOn 계정을 잇는다. 연결 안 된 사용자에게는 AI를 부르지 않는다 |
| 옮기지 않는 것 | 날씨·뉴스 브리핑(`/set_location`), 터미널 대시보드, gTTS, SQLite, backcom |

## 2. 사용자가 보는 것

### 텔레그램

| 명령 | 하는 일 |
| --- | --- |
| `/start`, `/help` | 사용법. 미연결이면 연결 방법을 안내한다 |
| `/link 코드` | 웹 설정에서 받은 코드로 계정을 잇는다 |
| `/unlink` | 연결을 끊는다. 쌓인 대화와 카드는 PaceOn에 남는다 |
| `/review` | 오늘 차례가 된 교정 카드로 퀴즈(최대 3문제) |
| `/topic` | 대화 주제 3개 |
| `/level beginner\|intermediate\|advanced` | 튜터의 말 수준 |
| `/scenario 이름` / `/scenario off` | 롤플레이(공항, 식당, 면접, 쇼핑, 회의) |
| `/voice_on`, `/voice_off` | 음성 답장 |
| `/set_review HH:MM` | 아침 복습 시각 |
| `/stats` | 이번 주 대화 수, 연속일, 자주 하는 실수 |

일반 메시지(텍스트·음성)는 튜터 1턴이 된다.

1. 실수는 최대 3개를 받고 메시지에는 2개만 설명한다. 정답은 스포일러로 가린다.
2. 고쳐 준 뒤 "직접 다시 써 보세요"를 청한다. 다음 메시지를 필수 수정 목록으로 채점한다.
3. 설명한 실수는 교정 카드로 저장한다. 같은 실수를 또 하면 횟수를 올리고 처음 간격으로 되돌린다.
4. 아침 복습 시각에 어제 대화 요약과 그날 차례가 된 카드 퀴즈를 보낸다.

### 웹

| 경로 | 내용 |
| --- | --- |
| `/settings` → **텔레그램 튜터** 카드 | 코드 발급(10분 만료 표시), 봇에 보낼 `/link 코드` 안내, 연결 상태·연결일, 해제 |
| `/learn/telegram` | 텔레그램 대화 보기(읽기 전용). 지역 날짜별로 학습자 문장, 답장, 실수(`틀린 것 → 고친 것`, 규칙), 자연스러운 문장, 고쳐 쓰기 결과, 교정 카드의 다음 복습일 |
| `/review` | 교정 카드. 앞면 "전에 이렇게 썼어요: … **go** …", 뒷면 "went — 과거형". 기존 어려움·보통·쉬움, 건너뛰기, 빼기 그대로 |
| `/learn/words` | 단어장에는 교정 카드를 섞지 않는다 |

## 3. 구조

```text
Telegram ⇄ Worker(VPS) TelegramWorker 스레드
             ├ getUpdates long polling
             ├ get_telegram_context → 미연결이면 /link 안내만 (AI 호출 0회)
             ├ Gemini REST (튜터 1턴, 퀴즈 채점, 주제, 아침 요약)
             ├ OpenAI TTS (음성 답장)
             └ service_role RPC → Supabase
Browser → Next.js(Vercel) → Supabase (RLS)
             ├ /api/telegram/link        연결 상태, 코드 발급, 해제
             ├ /api/telegram/turns       대화 보기
             └ /api/learning/expressions 복습(CORRECTION 포함)
```

- 응답은 큐에 넣지 않고 스레드에서 바로 처리한다(약 1.5초).
- 한 봇 토큰에는 `getUpdates` 소비자가 하나뿐이다. 운영 토큰은 VPS에서만 쓰고, 로컬 개발과 테스트는 **개발용 봇 토큰**만 쓴다.
- 업데이트를 한 스레드가 순서대로 처리한다. 업데이트 하나의 예외는 그 업데이트에서 잡고, 스레드와 다른 소비자를 멈추지 않는다.
- 개인 대화(`chat.type == "private"`)만 받는다. 그룹·채널 메시지는 무시한다.

## 4. 데이터 모델

마이그레이션 `20261014000000_telegram_tutor.sql`. 모든 행은 `auth.users(id) on delete cascade`로 소유한다. 브라우저는 자기 행을 읽기만 한다. 쓰기는 Worker의 service_role RPC가 하고, 코드 발급·해제만 authenticated RPC다. 값 목록은 PaceOn처럼 대문자 text와 check로 둔다.

### 4.1 `telegram_links` — 연결과 튜터 설정

| 칼럼 | 형식 | 비고 |
| --- | --- | --- |
| `user_id` | uuid PK | |
| `telegram_user_id` | bigint unique | 다른 계정에 이미 연결된 ID는 거절(14절 Q6) |
| `chat_id` | bigint | 개인 대화의 chat id |
| `level` | text | `BEGINNER` / `INTERMEDIATE`(기본) / `ADVANCED` |
| `scenario` | text null | `AIRPORT` / `RESTAURANT` / `INTERVIEW` / `SHOPPING` / `MEETING` |
| `voice_replies` | boolean | 기본 false |
| `review_at` | time | 기본 07:00. 시간대는 `learner_profiles.timezone` |
| `review_last_sent_on` | date null | 하루 한 번 보장 |
| `pending_rewrite` | jsonb null | `{original, target, fixes[]}`, 길이 제한 |
| `quiz_state` | jsonb null | `{cardIds[], index}` |
| `linked_at`, `updated_at` | timestamptz | |

### 4.2 `telegram_link_codes` — 일회용 연결 코드

`id`, `user_id`, `code_hash text unique`(SHA-256, 평문은 저장하지 않는다), `expires_at`(발급 후 10분), `used_at`, `created_at`. 새 코드를 받으면 그 사용자의 쓰지 않은 코드는 무효가 된다. 발급은 한 시간에 5번까지다(트리거, `material_imports`의 하루 제한과 같은 방식). 코드는 8자리 영숫자(헷갈리는 0/O/1/I 제외)다.

### 4.3 `telegram_turns` — 대화 기록

| 칼럼 | 형식 | 비고 |
| --- | --- | --- |
| `id` | uuid PK | `unique (id, user_id)` (교정 카드의 소유자 묶음 FK용) |
| `user_id` | uuid | |
| `chat_id`, `message_id` | bigint | `unique (chat_id, message_id)`. 같은 메시지를 다시 받으면 아무것도 하지 않는다 |
| `input_kind` | text | `TEXT` / `VOICE` |
| `learner_text` | text | 텍스트 또는 받아쓰기, 1–4000자. 음성 원본은 저장하지 않는다 |
| `tutor_turn` | jsonb | 검증한 `TutorTurn` |
| `reply_text` | text | 보낸 메시지 원문, 1–8000자 |
| `mistake_count` | smallint | 받은 실수 수(0–3) |
| `rewrite_attempt` | boolean | |
| `rewrite_correct` | boolean null | 고쳐 쓰기였을 때만 |
| `created_at` | timestamptz | 지역 날짜는 조회할 때 시간대로 계산한다 |

멱등 키를 설계안의 `update_id`가 아니라 `(chat_id, message_id)`로 둔다. `update_id`는 봇마다 따로 세므로 토큰을 바꾸면 처음부터 다시 셀 수 있지만, 메시지 ID는 대화마다 고유하다. 퀴즈 문답은 여기에 넣지 않는다. 튜터의 대화 맥락에 섞이면 안 된다.

### 4.4 교정 카드 — `learning_expressions` 확장

`20261009000000_recall_cards.sql`이 `RECALL`을 더한 방식과 같다.

- `kind` check에 `CORRECTION`을 더한다.
- 칼럼 추가

| 칼럼 | 형식 | 비고 |
| --- | --- | --- |
| `wrong_text` | text | 틀린 부분만, 1–200자 |
| `correct_text` | text | 고친 것, 1–200자 |
| `rule_text` | text | 한국어 한 문장, 1–300자 |
| `mistake_category` | text | `GRAMMAR` / `VOCABULARY` / `WORD_CHOICE` / `SPELLING` / `OTHER` |
| `source_sentence` | text | 그 실수가 있던 문장, 1–1000자. 반복하면 최근 문장으로 바꾼다 |
| `occurrences` | integer | 기본 1 |
| `source_turn_id` | uuid null | `(source_turn_id, user_id) → telegram_turns(id, user_id) on delete set null (source_turn_id)` |

- 제약
  - `kind='CORRECTION'` ⇔ `wrong_text`·`correct_text`·`source_sentence` not null. 다른 kind에서는 모두 null이다.
  - 기존 `lookup_status='NONE'` 제약(`kind='EXPRESSION'`이 아니면 NONE)이 그대로 적용된다.
  - 유일 인덱스 `(user_id, lower(wrong_text), lower(correct_text)) where kind='CORRECTION'`. 기존 phrase 유일 인덱스는 `EXPRESSION` 조건부라 겹치지 않는다.
  - 브라우저는 `CORRECTION` 행을 직접 만들 수 없다(insert 정책에 kind 조건). 읽기·복습 갱신·빼기는 다른 카드와 같다.
- `phrase` = `wrong_text`, `meaning` = `correct_text`로 채운다. 화면은 전용 칼럼으로 그린다.
- 저장 규칙(TAIET `Database.add_mistakes`)
  - 새 실수: `review_step 0`, `due_on` = 사용자 시간대 기준 내일.
  - 같은 실수 반복: `occurrences + 1`, `review_step 0`, `due_on` 내일, `source_sentence`·`source_turn_id` 갱신.
  - `wrong_text`와 `correct_text`가 대소문자만 다르면 저장하지 않는다.

### 4.5 RPC

| 함수 | 호출자 | 하는 일 |
| --- | --- | --- |
| `create_telegram_link_code()` | authenticated (security definer) | 평문 코드와 만료 시각을 한 번만 돌려준다 |
| `unlink_telegram()` | authenticated | 자기 연결을 지운다 |
| `link_telegram(p_code, p_telegram_user_id, p_chat_id)` | service_role | 결과 코드: `LINKED` / `INVALID_CODE`(없음·만료·사용됨) / `TELEGRAM_IN_USE`(다른 계정). 같은 계정이 새 텔레그램으로 다시 이으면 바꾼다 |
| `get_telegram_context(p_telegram_user_id)` | service_role | 연결 여부, 설정, 상태, 시간대, 오늘 날짜를 한 번에 |
| `update_telegram_settings(p_user_id, p_settings)` | service_role | `/level` `/scenario` `/voice_*` `/set_review` |
| `record_telegram_turn(p_user_id, p_turn)` | service_role | 한 트랜잭션에서 대화 저장, 설명한 실수(최대 2개) 카드 upsert, `pending_rewrite` 갱신. 같은 메시지면 이전 결과를 돌려준다 |
| `get_telegram_quiz_cards(p_user_id, p_limit)` | service_role | 오늘 차례가 된 `CORRECTION` 카드(오래된 순) |
| `save_telegram_quiz_state(p_user_id, p_state)` | service_role | 퀴즈 진행 상태 |
| `record_correction_review(p_user_id, p_id, p_step, p_due_on, p_today)` | service_role | 소유자와 kind를 확인하고 `record_expression_review`와 같은 규칙(단계 0–4, 오늘 < 예정일 ≤ 오늘+400)으로 기록 |
| `claim_due_telegram_reviews(p_limit)` | service_role | 아침 복습 대상. 판정은 `private.notification_due`와 같다(지정 시각 후 2시간 안, 하루 한 번, 고르는 즉시 `review_last_sent_on` 갱신). 어제 대화 문장과 어제 교정도 함께 돌려준다 |
| `get_telegram_stats(p_user_id)` | service_role | `/stats` |

service_role 함수는 `security invoker`, `set search_path = ''`, `revoke ... from public, anon, authenticated`, `grant execute ... to service_role`이다(`claim_due_notifications`와 같다). 브라우저가 쓸 수 없는 표에 쓰는 `create_telegram_link_code`만 `security definer`다.

## 5. Worker

### 5.1 설정

| env | 기본 | 비고 |
| --- | --- | --- |
| `TELEGRAM_ENABLED` | `false` | `true`이고 아래 값이 모두 있어야 소비자를 붙인다(`NotifySettings` 방식) |
| `TELEGRAM_BOT_TOKEN` | | `repr=False`. URL 경로에 들어가므로 URL을 로그에 남기지 않는다 |
| `GEMINI_API_KEY` | | `repr=False`, 헤더 `x-goog-api-key`로 보낸다 |
| `GEMINI_MODEL` | | compose와 `.env.example`에 `gemini-3.5-flash-lite`. 코드에는 기본값을 두지 않는다(`OPENAI_MODEL`과 같다) |
| `TELEGRAM_DAILY_TURN_LIMIT` | `300` | 한 사용자가 하루에 부를 수 있는 튜터 턴. 넘으면 내일 다시 오라고만 답한다 |

음성 답장은 기존 `OPENAI_API_KEY`·`OPENAI_TTS_MODEL`·`OPENAI_TTS_VOICE`를 쓴다.

### 5.2 파일

| 파일 | 내용 |
| --- | --- |
| `app/gemini.py` | Gemini REST 어댑터. `post_json`(연결 풀, 리다이렉트 거절, 응답 256KB 제한, 비로그)을 재사용한다 |
| `app/telegram_api.py` | Bot API 호출(`getUpdates`, `sendMessage`, `sendVoice`, `getFile`, `setMyCommands`). 오류는 고정 코드로만 다룬다 |
| `app/telegram_format.py` | `markdown_to_telegram_html`, `strip_markdown`, `split_telegram_message`, `normalize_sentence` |
| `app/telegram_tutor.py` | 출력 모델, 프롬프트, 피드백 문구 구성, 고쳐 쓰기·퀴즈 판정, `next_review` |
| `app/telegram_worker.py` | `TelegramSettings`, `TelegramWorker`(수신 루프, 명령, 아침 복습) |

### 5.3 Gemini 호출

- `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- `systemInstruction`, `contents`(최근 3턴 + 이번 메시지), `generationConfig`: `maxOutputTokens 2048`, `thinkingConfig.thinkingLevel = "MINIMAL"`, `responseMimeType = "application/json"`, 응답 스키마. temperature는 넣지 않는다.
- 음성은 `inlineData { mimeType: "audio/ogg", data: base64 }`. 히스토리 없이 보낸다.
- 필드 이름(`responseJsonSchema`/`responseSchema`), `thinkingLevel` 표기, 지원하는 JSON Schema 부분집합은 **구현 시 현재 Gemini REST 문서로 확인**한다. pydantic 스키마를 그대로 넣지 않고 지원 키워드만 담은 스키마를 손으로 둔다.
- 응답은 `StrictModel`로 검증한다. 파싱 실패는 1회 다시 묻고, 그래도 실패하면 `SafeFailure`다.
- Gemini에 보내는 것: 학습자 메시지, 최근 3턴, 고쳐 쓰기 목표 문장. 계정 ID·행 ID·chat ID는 보내지 않는다. 학습자 문장과 모델 응답 본문은 로그에 남기지 않는다.

### 5.4 흐름

1. `getUpdates(offset, timeout=25)`. 정지 신호는 한 주기 안에 확인한다. 처리 후 `offset = update_id + 1`.
2. `get_telegram_context`. 미연결이면 `/start`·`/help`·`/link`만 받고, 나머지에는 연결 안내만 보낸다. AI는 부르지 않는다.
3. 명령을 처리한다. 시작할 때 `setMyCommands`로 메뉴를 등록한다.
4. 일반 메시지
   - 퀴즈 중이면 채점한다. 퀴즈와 무관한 메시지면 퀴즈를 끝내고 아래로 넘긴다. 음성은 퀴즈에 답하지 않는다.
   - 그 밖에는 하루 한도 확인 → 튜터 1턴 → `record_telegram_turn` → 답장 → 음성 답장(켠 경우).
5. 아침 복습: 같은 스레드에서 1분마다 `claim_due_telegram_reviews`. 영어 요약을 보내고 이어서 퀴즈를 낸다.
6. 전송: Markdown → Telegram HTML, 3500자에서 문단 기준 분할. 400 "can't parse entities"면 서식을 지운 일반 텍스트로 다시 보낸다.
7. 음성 답장: TTS를 `response_format="opus"`로 받아 `sendVoice`. 실패하면 텍스트만 남는다.

### 5.5 이식표

| TAIET (`main.py` @`2c7def5`) | 이식 |
| --- | --- |
| `Mistake`, `RewriteCheck`, `TutorTurn`, `QuizGrade` | `StrictModel`, 길이 제한 추가 |
| `SYSTEM_PROMPTS`, `OUTPUT_RULES`, `SCENARIO_PROMPTS` | **문구 그대로**. 학습자 입력은 지시가 아닌 자료라는 PaceOn 문구만 덧붙인다 |
| `_pending_rewrite_prompt` | **그대로** |
| `tutor_turn` | 히스토리는 `telegram_turns`의 최근 3턴(피드백 제거) |
| `grade_quiz_answer`, `summarize_for_review_english`, `generate_topics` | 프롬프트 그대로 |
| `_compose_tutor_message` | 그대로, `MAX_SHOWN_MISTAKES = 2` |
| `_run_tutor_turn` | 목표 문장과 같으면 모델 판정과 무관하게 정답, 시도는 새 실수로 세지 않는다 |
| `_quiz_question_text`, `_start_quiz`, `_handle_quiz_answer` | 빠른 판정(`correct` 포함·`wrong` 미포함이면 모델 생략), 퀴즈 이탈. 결과는 `record_correction_review` |
| `markdown_to_telegram_html`, `strip_markdown`, `normalize_sentence`, `split_telegram_message` | 그대로 |
| `TTSEngine.OPENAI_TTS_INSTRUCTIONS` | TTS 요청의 `instructions`로 |
| `get_weekly_stats`의 연속일 | `/stats`에서 그대로 |

퀴즈 결과는 정답 → `EASY`, 오답 → `HARD`로 바꿔 기록한다. 다음 단계와 예정일은 `nextReview`를 Python으로 옮긴 `next_review`로 계산한다(마지막 간격에서 머문다, TAIET의 `mastered`는 없다). 두 구현은 같은 테스트 벡터 파일(`tests/fixtures/review-vectors.json`)을 통과한다. 텔레그램 퀴즈는 `CORRECTION` 카드만 낸다. 써서 채점할 수 있는 형식이 그것뿐이다. 한 번에 3문제(`DAILY_REVIEW_SIZE`)다.

## 6. 웹

- `CardKind`에 `CORRECTION`을 더하고, `expressions-api.ts`의 `toCard`가 `RECALL`이 아닌 모든 kind를 `EXPRESSION`으로 바꾸던 것을 고친다. `'RECALL'`로 갈라지는 모든 분기(`expression-review.tsx` 라벨·버튼·뒷면, `reviewPrompt`, 단어장 필터 `all=true`)를 함께 고친다.
- 단어장은 `kind='EXPRESSION'`만 보여 준다(지금 `all=true`가 그렇다).
- `dueToday`는 종류별 줄을 번갈아 뽑으므로 교정 카드가 세 번째 줄이 된다. 오늘의 3장에 단어·회상·교정이 섞인다.
- API: `GET /api/telegram/link`(상태), `POST /api/telegram/link`(코드 발급), `DELETE /api/telegram/link`(해제), `GET /api/telegram/turns?before=`(페이지 단위 20턴).

## 7. 보안·개인정보

- 연결되지 않은 텔레그램 사용자에게는 AI를 부르지 않는다. 연결된 사용자도 하루 한도가 있다.
- 연결 코드는 해시만 저장, 10분 만료, 1회용, 발급 빈도 제한.
- 봇 토큰이 든 URL, 학습자 문장, 모델 응답 본문은 로그에 남기지 않는다. 실패는 고정 코드로만 다룬다.
- 대화 원문은 Supabase Cloud에 저장된다. 보관 기간은 14절 Q1.
- 계정을 지우면 연결·코드·대화·교정 카드가 cascade로 지워진다(pgTAP로 확인).

## 8. 테스트

기존 검사(`pnpm typecheck`, `lint`, `build`, `test`, `db:test`, `db:types:check`, `test:ai:worker`)를 모두 통과한다. 추가:

- **pgTAP** `telegram_tutor.test.sql`: 표·RLS(본인만), RPC 권한(authenticated가 service_role 함수를 못 부름), 코드 만료·재사용·빈도 제한, 다른 계정의 텔레그램 ID 거절, `(chat_id, message_id)` 멱등, CORRECTION 제약·유일성·반복 시 횟수와 단계 초기화, 브라우저의 CORRECTION 직접 생성 거절, 복습 RPC의 소유자·kind 확인, 아침 복습 하루 한 번, cascade.
- **Worker 단위**(fake transport, 네트워크 없음): Gemini 요청 본문(`thinkingLevel`, temperature 없음, 스키마, inline 오디오), 파싱 실패 재시도 → `SafeFailure`, 미연결 사용자 AI 0회, 하루 한도, 서식(스포일러, 3500자 분할, HTML 거절 시 일반 텍스트), 고쳐 쓰기 정확 일치, 퀴즈 빠른 판정·이탈, `next_review` 공유 벡터, 로그에 문장·토큰이 없음.
- **웹**: CORRECTION 매핑과 단어장 제외, 리뷰 카드 문구, 연결 API.
- **실제 호출**(opt-in, 과금): `pnpm test:tutor:live`. 설계안 9장의 회귀 사례(튜터 1턴 6건, 고쳐 쓰기 채점 10건, 음성 1건)를 실제 Gemini·OpenAI로 확인한다. `GEMINI_API_KEY`가 있고 `PACEON_LIVE_TUTOR=1`일 때만 돈다.
- **개발용 봇 E2E**: 로컬 Supabase + 로컬 Worker + 개발용 봇으로 연결 → 대화 → 고쳐 쓰기 → (예정일을 당겨) 퀴즈 → 웹 `/review`.

## 9. 단계

1. 설계 확정(이 문서) — 사용자 확인
2. DB: 마이그레이션, pgTAP, `pnpm db:types`, `DATABASE.md`
3. Worker: Gemini 어댑터, TelegramWorker, 이식, 아침 복습, 단위 테스트
4. 웹: 연결 설정, 대화 보기, CORRECTION 복습
5. 개발용 봇 E2E
6. 배포 준비: 운영 마이그레이션, Vercel, VPS env(`TELEGRAM_ENABLED=false`로 먼저). 운영 반영은 승인 후

각 단계가 끝나면 보고하고 멈춘다. 운영 전환과 롤백은 설계안 11장을 따르며 승인 없이 하지 않는다.

## 10–13. 운영 전환, 기존 데이터, 참고

설계안 11–13장과 같다. 요약하면 미니 PC의 TAIET를 먼저 멈춘 뒤 VPS에 운영 토큰을 넣고, 롤백은 `TELEGRAM_ENABLED=false` 후 TAIET 재시작이다.

## 14. 확인할 질문

| # | 질문 | 제안 |
| --- | --- | --- |
| Q1 | 대화 원문 보관 기간 | 180일 뒤 대화만 지우고 교정 카드는 유지 |
| Q2 | 레벨·음성·아침 복습 시각을 웹에서도 바꿀지 | 이번에는 봇 명령으로만. 웹은 연결과 보기만 |
| Q3 | 텔레그램 아침 복습과 웹 푸시 알림이 둘 다 울려도 되는지 | 따로 둔다. 시각도 따로(`review_at`, `notify_at`) |
| Q4 | 텔레그램 퀴즈에서 푼 카드를 그날 웹 `/review`에서 다시 보일지 | 안 보인다(같은 행이라 예정일이 이미 미뤄짐) |
| Q5 | 기존 TAIET 기록(대화 34건, 오답노트) 옮길지 | 옮기지 않고 새로 시작 |
| Q6 | 다른 PaceOn 계정에 이미 연결된 텔레그램 ID | 거절. 같은 계정이 새 텔레그램으로 다시 이으면 바꾼다 |
| Q7 | 음성 답장 목소리 | PaceOn 설정(`OPENAI_TTS_VOICE`, 지금 marin). TAIET는 alloy였다 |
| Q8 | 하루 튜터 턴 한도 | 300턴 |
