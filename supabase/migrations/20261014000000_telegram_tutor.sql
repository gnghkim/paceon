-- 텔레그램 영어 튜터. 미니 PC에서 돌던 TAIET를 Worker의 소비자로 옮기면서 필요한 자리다.
--
-- 텔레그램에서 영어로 말을 걸면 튜터가 실수를 고쳐 주고, 고친 실수는 복습 카드가 된다.
-- 카드는 새 표가 아니라 learning_expressions의 kind='CORRECTION'이다. 간격 계산,
-- 하루 세 장, 웹 /review가 그대로 쓰이고, 텔레그램 퀴즈와 웹이 같은 행을 갱신한다.
--
-- "AI가 고른 표현은 자동 저장하지 않는다"의 명시적 예외다. AI가 권한 표현이 아니라
-- 학습자가 실제로 틀린 것을 담는다. 표현 카드(EXPRESSION)는 지금처럼 직접 고를 때만 생긴다.
--
-- 쓰기는 Worker의 service_role 함수만 한다. 브라우저는 자기 행을 읽고, 연결 코드를
-- 받고, 연결을 끊는 것만 한다. 계약은 docs/TELEGRAM_TUTOR.md.

/* ---------- 연결과 튜터 설정 ---------- */

create table public.telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- 한 텔레그램 계정은 한 PaceOn 계정에만 이어진다.
  telegram_user_id bigint not null unique check (telegram_user_id > 0),
  chat_id bigint not null,
  level text not null default 'INTERMEDIATE' check (level in ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')),
  scenario text check (scenario is null or scenario in ('AIRPORT', 'RESTAURANT', 'INTERVIEW', 'SHOPPING', 'MEETING')),
  voice_replies boolean not null default false,
  -- 아침 복습 시각. 시간대는 learner_profiles.timezone을 따른다.
  review_at time not null default '07:00',
  review_last_sent_on date check (review_last_sent_on is null or isfinite(review_last_sent_on)),
  -- 다음 메시지를 고쳐 쓰기로 채점할 때 쓰는 목표 문장과 필수 수정 목록.
  pending_rewrite jsonb check (pending_rewrite is null
    or (jsonb_typeof(pending_rewrite) = 'object' and length(pending_rewrite::text) <= 4000)),
  -- 진행 중인 퀴즈의 카드(최대 3장)와 맞힌 수. 카드 글을 담으므로 넉넉히 둔다.
  quiz_state jsonb check (quiz_state is null
    or (jsonb_typeof(quiz_state) = 'object' and length(quiz_state::text) <= 8000)),
  -- 마지막으로 이은 때. 다른 텔레그램으로 다시 이으면 바뀐다.
  linked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.telegram_links enable row level security;
revoke all on public.telegram_links from anon, authenticated;
-- 설정은 봇 명령으로만 바꾼다. 브라우저는 보고 끊는 것만 한다.
grant select, delete on public.telegram_links to authenticated;
grant all on public.telegram_links to service_role;
create policy owner_select on public.telegram_links for select to authenticated
  using ((select auth.uid()) = user_id);
create policy owner_delete on public.telegram_links for delete to authenticated
  using ((select auth.uid()) = user_id);
create trigger touch_updated_at before update on public.telegram_links
  for each row execute function private.touch_updated_at();

/* ---------- 일회용 연결 코드 ---------- */

-- 평문은 발급할 때 한 번만 보여 주고 해시만 남긴다. 10분, 한 번, 한 시간에 다섯 번.
-- 여덟 자 32진 코드는 40비트다. 유효한 코드가 사용자마다 하나뿐이고 10분 안에
-- 사라지므로 봇에 코드를 대입해 맞힐 수 없다.
create table public.telegram_link_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index telegram_link_codes_owner_idx on public.telegram_link_codes(user_id, created_at desc);
alter table public.telegram_link_codes enable row level security;
revoke all on public.telegram_link_codes from anon, authenticated;
grant all on public.telegram_link_codes to service_role;

/* ---------- 대화 기록 ---------- */

create table public.telegram_turns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 같은 메시지를 두 번 받아도 한 번만 남긴다. update_id는 봇마다 따로 세어 토큰을
  -- 바꾸면 처음부터 다시 셀 수 있지만, 메시지 ID는 대화 안에서 고유하다.
  chat_id bigint not null,
  message_id bigint not null check (message_id > 0),
  input_kind text not null check (input_kind in ('TEXT', 'VOICE')),
  -- 텍스트 또는 받아쓰기. 음성 원본은 남기지 않는다.
  learner_text text not null check (length(btrim(learner_text)) between 1 and 4000),
  tutor_turn jsonb not null check (jsonb_typeof(tutor_turn) = 'object' and length(tutor_turn::text) <= 20000),
  reply_text text not null check (length(btrim(reply_text)) between 1 and 8000),
  mistake_count smallint not null default 0 check (mistake_count between 0 and 3),
  rewrite_attempt boolean not null default false,
  rewrite_correct boolean check (rewrite_correct is null or rewrite_attempt),
  created_at timestamptz not null default now(),
  unique (chat_id, message_id),
  -- 교정 카드가 남의 대화를 가리키지 못하게 소유자까지 묶는 데 쓴다.
  unique (id, user_id)
);
create index telegram_turns_owner_idx on public.telegram_turns(user_id, created_at desc);
alter table public.telegram_turns enable row level security;
revoke all on public.telegram_turns from anon, authenticated;
grant select on public.telegram_turns to authenticated;
grant all on public.telegram_turns to service_role;
create policy owner_select on public.telegram_turns for select to authenticated
  using ((select auth.uid()) = user_id);

/* ---------- 교정 카드 ---------- */

-- phrase는 틀린 부분, meaning은 고친 것으로 채운다. 화면은 전용 칼럼으로 그린다.
alter table public.learning_expressions drop constraint learning_expressions_kind_check;
alter table public.learning_expressions
  add constraint learning_expressions_kind_check check (kind in ('EXPRESSION', 'RECALL', 'CORRECTION')),
  add column wrong_text text check (wrong_text is null or length(btrim(wrong_text)) between 1 and 200),
  add column correct_text text check (correct_text is null or length(btrim(correct_text)) between 1 and 200),
  add column rule_text text check (rule_text is null or length(btrim(rule_text)) between 1 and 300),
  add column mistake_category text check (mistake_category is null
    or mistake_category in ('GRAMMAR', 'VOCABULARY', 'WORD_CHOICE', 'SPELLING', 'OTHER')),
  -- 그 실수가 있던 문장. 같은 실수를 또 하면 가장 최근 문장으로 바꾼다.
  add column source_sentence text check (source_sentence is null or length(btrim(source_sentence)) between 1 and 1000),
  add column occurrences integer not null default 1 check (occurrences between 1 and 1000000),
  add column source_turn_id uuid,
  -- 대화를 지워도 카드는 남는다. 어디서 왔는지만 잊는다.
  add constraint learning_expressions_source_turn_fk
    foreign key (source_turn_id, user_id) references public.telegram_turns(id, user_id)
    on delete set null (source_turn_id),
  add constraint learning_expressions_correction_fields check (
    (kind = 'CORRECTION' and wrong_text is not null and correct_text is not null and rule_text is not null
      and mistake_category is not null and source_sentence is not null)
    or (kind <> 'CORRECTION' and wrong_text is null and correct_text is null and rule_text is null
      and mistake_category is null and source_sentence is null and source_turn_id is null));

-- 같은 실수는 한 장이다. 대소문자는 가리지 않는다.
create unique index learning_expressions_correction_once_idx
  on public.learning_expressions(user_id, lower(wrong_text), lower(correct_text))
  where kind = 'CORRECTION';

-- 교정 카드는 Worker만 만든다. 브라우저는 읽고, 복습하고, 빼는 것만 한다.
drop policy owner_insert on public.learning_expressions;
create policy owner_insert on public.learning_expressions for insert to authenticated
  with check ((select auth.uid()) = user_id and kind <> 'CORRECTION');

-- 카드의 종류는 만든 뒤 바뀌지 않는다. 바뀌면 종류마다 다른 제약이 서로를 우회한다.
create function private.keep_expression_kind() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'Card kind cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.keep_expression_kind() from public;
create trigger keep_kind before update of kind on public.learning_expressions
  for each row execute function private.keep_expression_kind();

/* ---------- 브라우저가 부르는 함수 ---------- */

/**
 * 연결 코드를 하나 만든다. 평문은 이 응답에서 한 번만 돌려준다.
 * 쓰지 않은 이전 코드는 그 자리에서 무효가 된다.
 * 브라우저가 쓸 수 없는 표에 쓰므로 security definer다.
 */
create function public.create_telegram_link_code()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  expires timestamptz := now() + interval '10 minutes';
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('telegram-link:' || owner_id::text, 0));
  if (select count(*) from public.telegram_link_codes
      where user_id = owner_id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'LINK_CODE_LIMIT' using errcode = 'P0001';
  end if;
  update public.telegram_link_codes set expires_at = least(expires_at, now())
    where user_id = owner_id and used_at is null;
  -- UUID v4의 첫 바이트는 온전히 무작위다. 32는 256을 나누므로 고르게 뽑힌다.
  for i in 1..8 loop
    code := code || substr(alphabet, get_byte(uuid_send(gen_random_uuid()), 0) % 32 + 1, 1);
  end loop;
  insert into public.telegram_link_codes(user_id, code_hash, expires_at)
    values (owner_id, encode(sha256(convert_to(code, 'UTF8')), 'hex'), expires);
  return jsonb_build_object('code', code, 'expiresAt', expires);
end;
$$;
revoke all on function public.create_telegram_link_code() from public, anon;
grant execute on function public.create_telegram_link_code() to authenticated;

/** 연결을 끊는다. 쌓인 대화와 카드는 PaceOn에 남는다. */
create function public.unlink_telegram()
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from public.telegram_links where user_id = auth.uid();
  return found;
end;
$$;
revoke all on function public.unlink_telegram() from public, anon;
grant execute on function public.unlink_telegram() to authenticated;

/* ---------- Worker가 부르는 함수 (service_role) ---------- */

/** 이 사람의 시간대. 정하지 않았으면 서비스 기본값이다. */
create function private.reader_timezone(p_user_id uuid)
returns text language sql stable set search_path = '' as $$
  select coalesce((select timezone from public.learner_profiles where user_id = p_user_id), 'Asia/Seoul');
$$;
revoke all on function private.reader_timezone(uuid) from public;
grant execute on function private.reader_timezone(uuid) to service_role;

/**
 * 봇에 /link 코드가 왔을 때. LINKED, INVALID_CODE(없음·만료·사용됨),
 * TELEGRAM_IN_USE(다른 계정에 이미 연결) 중 하나를 돌려준다.
 * 같은 계정이 새 텔레그램으로 다시 이으면 바꾼다. 거절한 코드는 쓰지 않은 채로 둔다.
 */
create function public.link_telegram(p_code text, p_telegram_user_id bigint, p_chat_id bigint)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  normalized text := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  claimed public.telegram_link_codes;
  holder uuid;
begin
  if p_telegram_user_id is null or p_telegram_user_id <= 0 or p_chat_id is null then
    raise exception 'Invalid Telegram identity' using errcode = '23514';
  end if;
  if normalized !~ '^[A-Z0-9]{8}$' then return 'INVALID_CODE'; end if;
  select * into claimed from public.telegram_link_codes
    where code_hash = encode(sha256(convert_to(normalized, 'UTF8')), 'hex')
      and used_at is null and expires_at > now()
    for update;
  if not found then return 'INVALID_CODE'; end if;
  select user_id into holder from public.telegram_links where telegram_user_id = p_telegram_user_id;
  if holder is not null and holder <> claimed.user_id then return 'TELEGRAM_IN_USE'; end if;
  update public.telegram_link_codes set used_at = now() where id = claimed.id;
  insert into public.telegram_links(user_id, telegram_user_id, chat_id)
    values (claimed.user_id, p_telegram_user_id, p_chat_id)
    on conflict (user_id) do update
      set telegram_user_id = excluded.telegram_user_id, chat_id = excluded.chat_id,
          linked_at = now(), pending_rewrite = null, quiz_state = null;
  return 'LINKED';
end;
$$;
revoke all on function public.link_telegram(text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.link_telegram(text, bigint, bigint) to service_role;

/**
 * 보낸 사람이 누구이고 지금 어떤 상태인지. 연결되지 않았으면 null이다.
 * 튜터의 맥락으로 쓸 최근 3턴(오래된 것부터)을 함께 돌려준다. 퀴즈 문답은 대화에 없다.
 */
create function public.get_telegram_context(p_telegram_user_id bigint)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'userId', l.user_id, 'chatId', l.chat_id, 'level', l.level, 'scenario', l.scenario,
    'voiceReplies', l.voice_replies, 'reviewAt', to_char(l.review_at, 'HH24:MI'),
    'pendingRewrite', l.pending_rewrite, 'quizState', l.quiz_state,
    'timezone', z.tz, 'today', (now() at time zone z.tz)::date,
    'turnsToday', (select count(*) from public.telegram_turns t
      where t.user_id = l.user_id
        and t.created_at >= (((now() at time zone z.tz)::date)::timestamp at time zone z.tz)),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('learnerText', h.learner_text, 'replyText', h.reply_text)
                  order by h.created_at, h.id), '[]'::jsonb)
                from (select t.learner_text, t.reply_text, t.created_at, t.id from public.telegram_turns t
                      where t.user_id = l.user_id order by t.created_at desc, t.id desc limit 3) h))
  from public.telegram_links l
  cross join lateral (select private.reader_timezone(l.user_id) as tz) z
  where l.telegram_user_id = p_telegram_user_id;
$$;
revoke all on function public.get_telegram_context(bigint) from public, anon, authenticated;
grant execute on function public.get_telegram_context(bigint) to service_role;

/** 봇의 /unlink. 웹의 unlink_telegram과 같고, 텔레그램 쪽에서 끊는다. */
create function public.unlink_telegram_user(p_telegram_user_id bigint)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.telegram_links where telegram_user_id = p_telegram_user_id;
  return found;
end;
$$;
revoke all on function public.unlink_telegram_user(bigint) from public, anon, authenticated;
grant execute on function public.unlink_telegram_user(bigint) to service_role;

/** /level, /scenario, /voice_on|off, /set_review. 받은 칸만 바꾼다. */
create function public.update_telegram_settings(p_user_id uuid, p_settings jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  updated public.telegram_links;
begin
  if jsonb_typeof(p_settings) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_settings) k where k not in ('level', 'scenario', 'voiceReplies', 'reviewAt'))
    or (p_settings ? 'level' and (jsonb_typeof(p_settings->'level') is distinct from 'string'
        or p_settings->>'level' not in ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')))
    or (p_settings ? 'scenario' and jsonb_typeof(p_settings->'scenario') <> 'null'
        and (jsonb_typeof(p_settings->'scenario') <> 'string'
          or p_settings->>'scenario' not in ('AIRPORT', 'RESTAURANT', 'INTERVIEW', 'SHOPPING', 'MEETING')))
    or (p_settings ? 'voiceReplies' and jsonb_typeof(p_settings->'voiceReplies') is distinct from 'boolean')
    or (p_settings ? 'reviewAt' and (jsonb_typeof(p_settings->'reviewAt') is distinct from 'string'
        or p_settings->>'reviewAt' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')) then
    raise exception 'Invalid Telegram settings' using errcode = '23514';
  end if;
  update public.telegram_links set
      level = case when p_settings ? 'level' then p_settings->>'level' else level end,
      scenario = case when p_settings ? 'scenario' then p_settings->>'scenario' else scenario end,
      voice_replies = case when p_settings ? 'voiceReplies' then (p_settings->>'voiceReplies')::boolean else voice_replies end,
      review_at = case when p_settings ? 'reviewAt' then (p_settings->>'reviewAt')::time else review_at end
    where user_id = p_user_id
    returning * into updated;
  if updated.user_id is null then raise exception 'Telegram link not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('level', updated.level, 'scenario', updated.scenario,
    'voiceReplies', updated.voice_replies, 'reviewAt', to_char(updated.review_at, 'HH24:MI'));
end;
$$;
revoke all on function public.update_telegram_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_telegram_settings(uuid, jsonb) to service_role;

/**
 * 튜터 한 턴을 남긴다. 한 트랜잭션에서 대화를 저장하고, 설명한 실수(최대 2개)를
 * 교정 카드로 넣거나 올리고, 다음에 채점할 고쳐 쓰기를 바꾼다.
 *
 * 같은 메시지가 다시 오면(Worker가 다시 시작해 같은 업데이트를 받은 경우) 아무것도
 * 하지 않고 이전 턴을 알려 준다.
 *
 * 카드 규칙: 새 실수는 내일 첫 간격. 같은 실수는 횟수를 올리고 내일 첫 간격으로
 * 되돌리며 문장을 최근 것으로 바꾼다. 대소문자만 다른 것은 실수로 담지 않는다.
 */
create function public.record_telegram_turn(p_user_id uuid, p_turn jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  link public.telegram_links;
  existing uuid;
  turn_id uuid;
  today date;
  card jsonb;
  card_id uuid;
  card_ids uuid[] := '{}';
  wrong text;
  fixed text;
begin
  if jsonb_typeof(p_turn) is distinct from 'object' then
    raise exception 'Invalid turn' using errcode = '23514';
  end if;
  select * into link from public.telegram_links where user_id = p_user_id for update;
  if not found then raise exception 'Telegram link not found' using errcode = 'P0002'; end if;
  if (p_turn->>'chatId')::bigint is distinct from link.chat_id then
    raise exception 'Chat does not belong to the reader' using errcode = '42501';
  end if;
  select id into existing from public.telegram_turns
    where chat_id = link.chat_id and message_id = (p_turn->>'messageId')::bigint;
  if existing is not null then
    return jsonb_build_object('turnId', existing, 'duplicate', true, 'cardIds', '[]'::jsonb);
  end if;
  if jsonb_typeof(coalesce(p_turn->'cards', '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_turn->'cards', '[]'::jsonb)) > 2
    or coalesce(jsonb_typeof(p_turn->'pendingRewrite'), 'null') not in ('object', 'null') then
    raise exception 'Invalid turn' using errcode = '23514';
  end if;
  insert into public.telegram_turns(user_id, chat_id, message_id, input_kind, learner_text, tutor_turn,
      reply_text, mistake_count, rewrite_attempt, rewrite_correct)
    values (p_user_id, link.chat_id, (p_turn->>'messageId')::bigint, p_turn->>'inputKind',
      p_turn->>'learnerText', p_turn->'tutorTurn', p_turn->>'replyText',
      coalesce((p_turn->>'mistakeCount')::smallint, 0), coalesce((p_turn->>'rewriteAttempt')::boolean, false),
      (p_turn->>'rewriteCorrect')::boolean)
    returning id into turn_id;
  today := (now() at time zone private.reader_timezone(p_user_id))::date;
  for card in select value from jsonb_array_elements(coalesce(p_turn->'cards', '[]'::jsonb)) loop
    wrong := btrim(card->>'wrong');
    fixed := btrim(card->>'correct');
    if jsonb_typeof(card) <> 'object' or coalesce(wrong, '') = '' or coalesce(fixed, '') = '' then
      raise exception 'Invalid correction' using errcode = '23514';
    end if;
    continue when lower(wrong) = lower(fixed);
    insert into public.learning_expressions(user_id, kind, phrase, meaning, wrong_text, correct_text,
        rule_text, mistake_category, source_sentence, source_turn_id, review_step, due_on, lookup_status)
      values (p_user_id, 'CORRECTION', wrong, fixed, wrong, fixed, btrim(card->>'rule'), card->>'category',
        btrim(card->>'sourceSentence'), turn_id, 0, today + 1, 'NONE')
      on conflict (user_id, lower(wrong_text), lower(correct_text)) where kind = 'CORRECTION'
      do update set occurrences = least(public.learning_expressions.occurrences + 1, 1000000),
        review_step = 0, due_on = excluded.due_on,
        source_sentence = excluded.source_sentence, source_turn_id = excluded.source_turn_id
      returning id into card_id;
    card_ids := card_ids || card_id;
  end loop;
  update public.telegram_links
    set pending_rewrite = case when jsonb_typeof(p_turn->'pendingRewrite') = 'object' then p_turn->'pendingRewrite' end
    where user_id = p_user_id;
  return jsonb_build_object('turnId', turn_id, 'duplicate', false, 'cardIds', to_jsonb(card_ids));
end;
$$;
revoke all on function public.record_telegram_turn(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_telegram_turn(uuid, jsonb) to service_role;

/** 오늘 텔레그램 퀴즈로 물을 교정 카드. 써서 채점할 수 있는 것은 교정 카드뿐이다. */
create function public.get_telegram_quiz_cards(p_user_id uuid, p_limit integer default 3)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'wrongText', e.wrong_text, 'correctText', e.correct_text, 'ruleText', e.rule_text,
      'sourceSentence', e.source_sentence, 'category', e.mistake_category,
      'reviewStep', e.review_step, 'occurrences', e.occurrences)
      order by e.due_on, e.created_at, e.id), '[]'::jsonb)
  from (
    select * from public.learning_expressions
    where user_id = p_user_id and kind = 'CORRECTION'
      and due_on <= (now() at time zone private.reader_timezone(p_user_id))::date
    order by due_on, created_at, id
    limit greatest(1, least(coalesce(p_limit, 3), 10))
  ) e;
$$;
revoke all on function public.get_telegram_quiz_cards(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_telegram_quiz_cards(uuid, integer) to service_role;

/** 퀴즈 진행 상태. null이면 퀴즈를 끝낸다. */
create function public.save_telegram_quiz_state(p_user_id uuid, p_state jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if p_state is not null and jsonb_typeof(p_state) <> 'object' then
    raise exception 'Invalid quiz state' using errcode = '23514';
  end if;
  update public.telegram_links set quiz_state = p_state where user_id = p_user_id;
  return found;
end;
$$;
revoke all on function public.save_telegram_quiz_state(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_telegram_quiz_state(uuid, jsonb) to service_role;

/**
 * 텔레그램 퀴즈의 답을 기록한다. 웹의 record_expression_review와 같은 규칙이고,
 * 소유자와 kind를 함께 확인한다. 다음 단계와 예정일은 Worker가 nextReview와 같은
 * 규칙으로 정해 온다.
 */
create function public.record_correction_review(
  p_user_id uuid, p_id uuid, p_step smallint, p_due_on date, p_today date
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  updated public.learning_expressions;
begin
  if p_step is null or p_step < 0 or p_step > 4
     or p_due_on is null or not isfinite(p_due_on)
     or p_today is null or not isfinite(p_today)
     or p_due_on <= p_today or p_due_on > p_today + 400 then
    raise exception 'Invalid review' using errcode = '23514';
  end if;
  update public.learning_expressions
    set review_step = p_step, due_on = p_due_on, last_reviewed_on = p_today,
        review_count = least(review_count + 1, 2147483647)
    where id = p_id and user_id = p_user_id and kind = 'CORRECTION'
    returning * into updated;
  if updated.id is null then raise exception 'Correction not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', updated.id, 'reviewStep', updated.review_step, 'dueOn', updated.due_on);
end;
$$;
revoke all on function public.record_correction_review(uuid, uuid, smallint, date, date) from public, anon, authenticated;
grant execute on function public.record_correction_review(uuid, uuid, smallint, date, date) to service_role;

/**
 * 지금 아침 복습을 보낼 사람을 집어 온다. 판정은 웹 푸시 알림과 같다
 * (private.notification_due: 지정 시각 후 2시간 안, 하루 한 번). 고르는 즉시
 * review_last_sent_on을 오늘로 올린다. 보내다 실패해도 같은 날 다시 보내지 않는다.
 *
 * 요약에 쓸 어제 문장과 어제 교정을 함께 돌려준다. 집어 오는 김에 보관 기간(180일)이
 * 지난 대화와 하루 지난 연결 코드를 지운다. 대화를 지워도 교정 카드는 남는다.
 */
create function public.claim_due_telegram_reviews(p_limit integer default 20)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  size integer := case when p_limit is null or p_limit < 1 or p_limit > 200 then 20 else p_limit end;
  result jsonb;
begin
  delete from public.telegram_turns where created_at < now() - interval '180 days';
  delete from public.telegram_link_codes where created_at < now() - interval '1 day';
  with due as (
    select l.user_id, z.tz, (now() at time zone z.tz)::date as local_today
    from public.telegram_links l
    cross join lateral (select private.reader_timezone(l.user_id) as tz) z
    where private.notification_due(now() at time zone z.tz, l.review_at, l.review_last_sent_on)
    order by l.user_id
    limit size
    for update of l skip locked
  ), marked as (
    update public.telegram_links l
      set review_last_sent_on = due.local_today
      from due
      where l.user_id = due.user_id
      returning l.user_id, l.chat_id, due.tz, due.local_today
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'userId', m.user_id, 'chatId', m.chat_id, 'today', m.local_today,
      'yesterdayTurns', (
        select coalesce(jsonb_agg(y.learner_text order by y.created_at), '[]'::jsonb)
        from (select t.learner_text, t.created_at from public.telegram_turns t
              where t.user_id = m.user_id
                and t.created_at >= ((m.local_today - 1)::timestamp at time zone m.tz)
                and t.created_at < (m.local_today::timestamp at time zone m.tz)
              order by t.created_at limit 30) y),
      'yesterdayCorrections', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'wrongText', c.wrong_text, 'correctText', c.correct_text, 'ruleText', c.rule_text)), '[]'::jsonb)
        from (select e.wrong_text, e.correct_text, e.rule_text
              from public.learning_expressions e
              join public.telegram_turns t on t.id = e.source_turn_id
              where e.user_id = m.user_id and e.kind = 'CORRECTION'
                and t.created_at >= ((m.local_today - 1)::timestamp at time zone m.tz)
                and t.created_at < (m.local_today::timestamp at time zone m.tz)
              order by e.occurrences desc, e.id limit 10) c))
      order by m.user_id), '[]'::jsonb)
    into result
    from marked m;
  return result;
end;
$$;
revoke all on function public.claim_due_telegram_reviews(integer) from public, anon, authenticated;
grant execute on function public.claim_due_telegram_reviews(integer) to service_role;

/**
 * /stats. 최근 7일(오늘 포함)의 턴과 교정 수, 연속일, 교정 카드 현황, 두 번 이상 한 실수.
 * 연속일은 오늘 아직 말을 걸지 않았으면 어제부터 이어 센다.
 */
create function public.get_telegram_stats(p_user_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  zone text := private.reader_timezone(p_user_id);
  today date := (now() at time zone zone)::date;
  week_start timestamptz := ((today - 6)::timestamp at time zone zone);
  days date[];
  expected date;
  streak integer := 0;
  day date;
begin
  select array_agg(d order by d desc) into days
    from (select distinct (created_at at time zone zone)::date as d
          from public.telegram_turns where user_id = p_user_id) x;
  expected := today;
  if days is not null and days[1] = today - 1 then expected := today - 1; end if;
  foreach day in array coalesce(days, '{}'::date[]) loop
    exit when day <> expected;
    streak := streak + 1;
    expected := expected - 1;
  end loop;
  return jsonb_build_object(
    'turns', (select count(*) from public.telegram_turns where user_id = p_user_id and created_at >= week_start),
    'corrections', (select coalesce(sum(mistake_count), 0) from public.telegram_turns
                    where user_id = p_user_id and created_at >= week_start),
    'streak', streak,
    'cards', (select count(*) from public.learning_expressions where user_id = p_user_id and kind = 'CORRECTION'),
    'due', (select count(*) from public.learning_expressions
            where user_id = p_user_id and kind = 'CORRECTION' and due_on <= today),
    'nextDue', (select min(due_on) from public.learning_expressions
                where user_id = p_user_id and kind = 'CORRECTION' and due_on > today),
    'recurring', (select coalesce(jsonb_agg(jsonb_build_object(
                     'wrongText', r.wrong_text, 'correctText', r.correct_text, 'occurrences', r.occurrences)
                     order by r.occurrences desc, r.updated_at desc), '[]'::jsonb)
                  from (select wrong_text, correct_text, occurrences, updated_at
                        from public.learning_expressions
                        where user_id = p_user_id and kind = 'CORRECTION' and occurrences > 1
                        order by occurrences desc, updated_at desc limit 3) r));
end;
$$;
revoke all on function public.get_telegram_stats(uuid) from public, anon, authenticated;
grant execute on function public.get_telegram_stats(uuid) to service_role;
