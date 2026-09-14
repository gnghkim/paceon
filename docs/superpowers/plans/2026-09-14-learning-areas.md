# 학습실 영역 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학습실을 리스닝·스피킹·라이팅 탭으로 나누고, 공간마다 영역을 저장해 그 영역 기능만 보여 주며, YouTube 계정 연결을 설정 페이지로 옮긴다.

**Architecture:** `learning_workspaces.kind`를 추가하고, 기존 공개 RPC를 `learning_private`로 옮긴 뒤 영역 검사를 하는 얇은 공개 함수로 감싼다(기존 20260925·20260926 패턴). 새 공간의 종류는 트랜잭션 설정값 `paceon.workspace_kind`를 insert 트리거가 읽어 채운다. 웹은 목록 API에 `kind` 필터를 추가하고, `/learn/(areas)` route group에 탭 레이아웃을 둔다.

**Tech Stack:** Supabase Postgres 17 (PL/pgSQL, pgTAP), Next.js 16.3 App Router, React 19, zod 4, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-14-learning-areas-design.md`

## Global Constraints

- 브랜치 `feat/learning-areas`. 태스크마다 커밋한다.
- 영역 값: `LISTENING`, `SPEAKING`, `WRITING`. `CREATE`는 `SPEAKING`·`WRITING`만 받는다.
- 새 오류 코드 `LEARNING_KIND` → HTTP 409, 메시지 `이 영역에서는 사용할 수 없는 기능이에요.`
- 기존 공간 주소 유지: 리스닝 `/learn/items/[id]`, 스피킹·라이팅 `/learn/[id]`.
- 탭 주소: `/learn/listening`, `/learn/speaking`, `/learn/writing`. `/learn`은 마지막 탭(기본 리스닝)으로 이동.
- 설정 주소 `/settings`. OAuth 완료 후 `/settings?youtube=connected|denied|failed`.
- 주 메뉴·모바일 하단 메뉴는 바꾸지 않는다.
- Next.js 코드를 쓰기 전 `apps/web/node_modules/next/dist/docs/`의 해당 문서를 확인한다(`apps/web/AGENTS.md`).
- DB 함수는 `security definer set search_path=''`, 테이블·함수는 스키마를 명시한다. 새 공개 함수마다 `revoke ... from public,anon,service_role` + `grant execute ... to authenticated`, migration 끝에 `revoke all on all functions in schema learning_private from public,anon,authenticated;`.

## Spec 보완 (Task 7에서 spec 문서에 반영)

1. 공간 종류는 불변이므로 화면이 `LEARNING_KIND`를 받을 정상 경로가 없다. spec 5.3의 "화면은 이 오류를 받으면 공간 정보를 다시 불러온다"를 삭제한다.
2. `learningRoomFeatures(kind)`는 종류만 받는다. 이전 말하기 기록은 `LegacySpeechRecords`가 스스로 불러와 기록이 없으면 렌더링하지 않는다.
3. 이전 말하기 기록은 `RECORDING` 항목만 보여 준다. AI 모범 음성(`PROMPT`)은 보관 기간 정리에 맡긴다.
4. 스피킹 공간의 타이머 안내 문구는 `녹음하거나 음성을 들으면 시작돼요`.

## File Structure

| 파일 | 역할 |
| --- | --- |
| Create `supabase/migrations/20261001000000_learning_workspace_kind.sql` | 컬럼·분류·트리거·영역 검사 공개 함수 |
| Create `supabase/tests/learning_workspace_kind.test.sql` | 분류·생성·허용표·불변성 |
| Modify `supabase/tests/{learning_room,learning_room_timing,learning_speech,learning_speech_audio_delete,learning_speech_quota,learning_speech_timing}.test.sql` | fixture에 종류 지정 |
| Modify `packages/shared/src/database.types.ts` | `pnpm db:types`로 재생성 |
| Modify `apps/web/src/lib/learning.ts` | `learningKindSchema`, `CREATE.kind`, `parseLearningListQuery` |
| Modify `apps/web/src/lib/learning-api.ts` | 목록 `kind` 필터, `LEARNING_KIND` |
| Modify `apps/web/src/lib/speech-api.ts`, `learning-videos-api.ts` | `LEARNING_KIND` |
| Create `apps/web/src/components/learning-areas.ts` | 영역 목록, 탭 결정, 주소, 표시 기능, 이어서 공부하기 선택 |
| Modify `apps/web/src/components/learning-types.ts` | `LearningKind`, `LearningWorkspace.kind` |
| Create `apps/web/src/components/youtube-client.ts` | YouTube API 호출·상태 타입 |
| Create `apps/web/src/components/youtube-connection.tsx` | 설정용 연결 관리 |
| Create `apps/web/src/components/youtube-import.tsx` | 리스닝 탭 가져오기 |
| Delete `apps/web/src/components/youtube-account.tsx` | 위 두 파일로 대체 |
| Create `apps/web/src/app/(workspace)/settings/page.tsx` | 설정 페이지 |
| Modify `apps/web/src/components/app-shell.tsx` | 헤더 설정 입구, 제목 |
| Modify `apps/web/src/lib/youtube-oauth.ts` | OAuth 완료 이동 주소 |
| Create `apps/web/src/components/learn-redirect.tsx` | `/learn` → 마지막 탭 |
| Create `apps/web/src/components/learning-areas-shell.tsx` | 제목·이어서 공부하기·탭 |
| Create `apps/web/src/components/learning-area-home.tsx` | 탭 내용 |
| Delete `apps/web/src/components/learning-home.tsx` | 위 파일들로 대체 |
| Modify `apps/web/src/app/(workspace)/learn/page.tsx` | `LearnRedirect` |
| Create `apps/web/src/app/(workspace)/learn/(areas)/layout.tsx`, `listening/page.tsx`, `speaking/page.tsx`, `writing/page.tsx` | 탭 라우트 |
| Modify `apps/web/src/components/learning-video-library.tsx` | 가져오기 버튼 |
| Modify `apps/web/src/components/learning-room.tsx` | 종류별 표시, 정규 주소 이동, 뒤로 가기 |
| Modify `apps/web/src/components/learning-room-view.ts` | `timerStatusLabel`이 `kind`를 받음 |
| Modify `apps/web/src/components/speech-panel.tsx` | `writingLink`, `SpeechResult` export·`readOnly` |
| Create `apps/web/src/components/legacy-speech-records.tsx` | 라이팅 공간의 이전 말하기 기록 |
| Tests `tests/learning-api.test.mjs`, `tests/speech-api.test.mjs`, `tests/learning-videos-api.test.mjs`, `tests/youtube-oauth.test.mjs`, `tests/learning-areas.test.mjs`, `tests/learning-room-view.test.mjs`, `tests/learning-integration.test.mjs`, `tests/speech-integration.test.mjs` | |
| Docs `docs/LEARNING_ROOM.md`, `docs/YOUTUBE_SETUP.md`, `docs/ARCHITECTURE.md`, spec | |

---

### Task 1: DB — 공간 종류와 영역별 명령 제한

**Files:**
- Create: `supabase/migrations/20261001000000_learning_workspace_kind.sql`
- Create: `supabase/tests/learning_workspace_kind.test.sql`
- Modify: 기존 pgTAP 6개, `packages/shared/src/database.types.ts`

**Interfaces:**
- Produces: `public.learning_workspaces.kind text not null`; `learning_private.classify_workspace_kind(public.learning_workspaces) returns text`; `learning_private.require_workspace_kind(uuid, text[])`; 공개 함수 시그니처는 그대로(`learning_command(jsonb)`, `learning_speech_command(jsonb)`, `learning_video_command(jsonb)`, `begin_speech_upload(uuid,uuid,uuid,text,text,bigint,text) returns jsonb`). `CREATE` 명령은 `kind` 키 필수. 예외 `LEARNING_KIND`.

- [ ] **Step 1: Supabase Local 준비와 백업**

Run: `supabase status` (실행 중이 아니면 `supabase start`), `supabase db dump --local --data-only -f .artifacts/before-learning-areas.sql`
Expected: 덤프 파일 생성 (`.artifacts/`는 gitignore 대상)

- [ ] **Step 2: 실패하는 pgTAP 작성**

Create `supabase/tests/learning_workspace_kind.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
select has_column('public','learning_workspaces','kind','Workspace kind exists');
select col_not_null('public','learning_workspaces','kind','Workspace kind is required');
insert into auth.users(id,email) values('30000000-0000-4000-8000-000000000001','kind-owner@paceon.example');
insert into learning_workspaces(id,user_id,title,kind,draft) values
('31000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Video','LISTENING',''),
('31000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','Mixed','WRITING',''),
('31000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','Draft only','WRITING','I went home.'),
('31000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','Speech only','WRITING',''),
('31000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000001','나의 영어 말하기','WRITING',''),
('31000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000001','Empty','SPEAKING','');
insert into learning_videos(workspace_id,user_id,video_id,start_seconds,position_seconds) values('31000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','dQw4w9WgXcQ',0,0);
insert into learning_messages(user_id,workspace_id,role,content) values('30000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','USER','I went home.');
insert into learning_speech(id,user_id,workspace_id,kind,status,storage_path) values
('32000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','RECORDING','READY','30000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/recording'),
('32000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000004','RECORDING','READY','30000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000002/recording');
insert into learning_ai_jobs(id,user_id,workspace_id,kind,status,input,attempts) values('36000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000006','WRITING_REPLY','FAILED','{}',1);
select is(learning_private.classify_workspace_kind(w),'LISTENING','Video workspace is listening') from learning_workspaces w where id='31000000-0000-4000-8000-000000000001';
select is(learning_private.classify_workspace_kind(w),'WRITING','Messages win over speech records') from learning_workspaces w where id='31000000-0000-4000-8000-000000000002';
select is(learning_private.classify_workspace_kind(w),'WRITING','A non-empty draft is writing') from learning_workspaces w where id='31000000-0000-4000-8000-000000000003';
select is(learning_private.classify_workspace_kind(w),'SPEAKING','Speech-only workspace is speaking') from learning_workspaces w where id='31000000-0000-4000-8000-000000000004';
select is(learning_private.classify_workspace_kind(w),'SPEAKING','Untouched speaking start is speaking') from learning_workspaces w where id='31000000-0000-4000-8000-000000000005';
select is(learning_private.classify_workspace_kind(w),'WRITING','Other empty workspaces are writing') from learning_workspaces w where id='31000000-0000-4000-8000-000000000006';
select throws_ok($$insert into learning_workspaces(id,user_id,title) values('31000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000001','No kind')$$,'23502',null,'Direct insert without kind fails');
select throws_ok($$insert into learning_workspaces(id,user_id,title,kind) values('31000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000001','Bad','READING')$$,'23514',null,'Unknown kind fails');
create temporary table kind_fixture(k text primary key,v jsonb);
grant all on kind_fixture to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
-- Creation
select throws_ok($$select learning_command('{"action":"CREATE","requestId":"33000000-0000-4000-8000-000000000001","workspaceId":"34000000-0000-4000-8000-000000000001","title":"No kind","prompt":""}')$$,'P0001','LEARNING_INVALID','CREATE requires kind');
select throws_ok($$select learning_command('{"action":"CREATE","requestId":"33000000-0000-4000-8000-000000000001","workspaceId":"34000000-0000-4000-8000-000000000001","title":"Listen","prompt":"","kind":"LISTENING"}')$$,'P0001','LEARNING_INVALID','CREATE cannot make listening workspaces');
select is(learning_command('{"action":"CREATE","requestId":"33000000-0000-4000-8000-000000000002","workspaceId":"34000000-0000-4000-8000-000000000002","title":"Speak","prompt":"","kind":"SPEAKING"}')->'workspace'->>'kind','SPEAKING','CREATE stores speaking');
select throws_ok($$select learning_command('{"action":"CREATE","requestId":"33000000-0000-4000-8000-000000000002","workspaceId":"34000000-0000-4000-8000-000000000002","title":"Speak","prompt":"","kind":"WRITING"}')$$,'P0001','LEARNING_CONFLICT','Replay with another kind conflicts');
select is(learning_command('{"action":"CREATE","requestId":"33000000-0000-4000-8000-000000000003","workspaceId":"34000000-0000-4000-8000-000000000003","title":"Write","prompt":"","kind":"WRITING"}')->'workspace'->>'kind','WRITING','CREATE stores writing');
select is(learning_video_command('{"action":"VIDEO_ADD","requestId":"33000000-0000-4000-8000-000000000004","workspaceId":"34000000-0000-4000-8000-000000000004","videoId":"abcdefghijk","startSeconds":0,"title":"Clip"}')->'workspace'->>'kind','LISTENING','VIDEO_ADD creates listening');
-- Text commands
select throws_ok($$select learning_command('{"action":"SAVE_DRAFT","requestId":"33000000-0000-4000-8000-000000000010","workspaceId":"34000000-0000-4000-8000-000000000002","expectedVersion":0,"draft":"x"}')$$,'P0001','LEARNING_KIND','Speaking rejects drafts');
select lives_ok($$select learning_command('{"action":"SAVE_DRAFT","requestId":"33000000-0000-4000-8000-000000000011","workspaceId":"34000000-0000-4000-8000-000000000003","expectedVersion":0,"draft":"x"}')$$,'Writing accepts drafts');
select lives_ok($$select learning_command('{"action":"SAVE_DRAFT","requestId":"33000000-0000-4000-8000-000000000012","workspaceId":"34000000-0000-4000-8000-000000000004","expectedVersion":0,"draft":"x"}')$$,'Listening accepts drafts');
select throws_ok($$select learning_command('{"action":"RETRY","requestId":"33000000-0000-4000-8000-000000000013","jobId":"36000000-0000-4000-8000-000000000001"}')$$,'P0001','LEARNING_KIND','Speaking rejects writing job retry');
-- Speech commands
select throws_ok($$select learning_speech_command('{"action":"PROMPT","requestId":"33000000-0000-4000-8000-000000000020","id":"37000000-0000-4000-8000-000000000001","workspaceId":"34000000-0000-4000-8000-000000000003","level":"EASY","topic":""}')$$,'P0001','LEARNING_KIND','Writing rejects new prompts');
select lives_ok($$select learning_speech_command('{"action":"PROMPT","requestId":"33000000-0000-4000-8000-000000000021","id":"37000000-0000-4000-8000-000000000002","workspaceId":"34000000-0000-4000-8000-000000000002","level":"EASY","topic":""}')$$,'Speaking accepts prompts');
select throws_ok($$select begin_speech_upload('37000000-0000-4000-8000-000000000003','34000000-0000-4000-8000-000000000003',null,'','audio/webm',100,repeat('a',64))$$,'P0001','LEARNING_KIND','Writing rejects uploads');
select lives_ok($$select begin_speech_upload('37000000-0000-4000-8000-000000000004','34000000-0000-4000-8000-000000000002',null,'','audio/webm',100,repeat('a',64))$$,'Speaking accepts uploads');
select throws_ok($$select learning_speech_command('{"action":"EDIT","requestId":"33000000-0000-4000-8000-000000000022","id":"32000000-0000-4000-8000-000000000001","text":"edited"}')$$,'P0001','LEARNING_KIND','Writing legacy speech is not editable');
select throws_ok($$select learning_speech_command('{"action":"RETRY","requestId":"33000000-0000-4000-8000-000000000023","id":"32000000-0000-4000-8000-000000000001"}')$$,'P0001','LEARNING_KIND','Writing legacy speech cannot be retried');
select lives_ok($$select learning_speech_command('{"action":"KEEP","requestId":"33000000-0000-4000-8000-000000000024","id":"32000000-0000-4000-8000-000000000001","keep":true}')$$,'Writing legacy speech retention can change');
select lives_ok($$select learning_speech_command('{"action":"DELETE_AUDIO","requestId":"33000000-0000-4000-8000-000000000025","id":"32000000-0000-4000-8000-000000000001"}')$$,'Writing legacy audio can be deleted');
select lives_ok($$select learning_speech_command('{"action":"DELETE","requestId":"33000000-0000-4000-8000-000000000026","id":"32000000-0000-4000-8000-000000000002"}')$$,'Speech records in any workspace can be deleted');
insert into kind_fixture select 'writing_session',learning_command('{"action":"START","requestId":"33000000-0000-4000-8000-000000000030","workspaceId":"34000000-0000-4000-8000-000000000003","deviceId":"35000000-0000-4000-8000-000000000001","timezone":"UTC"}');
select throws_ok(format($$select learning_speech_command('{"action":"SPEECH_TICK","requestId":"33000000-0000-4000-8000-000000000031","sessionId":"%s","deviceId":"35000000-0000-4000-8000-000000000001","generation":1,"playing":true}')$$,(select v->'session'->>'id' from kind_fixture where k='writing_session')),'P0001','LEARNING_KIND','Writing rejects speech ticks');
-- Video commands
select throws_ok($$select learning_video_command('{"action":"VIDEO_NOTE","requestId":"33000000-0000-4000-8000-000000000040","workspaceId":"34000000-0000-4000-8000-000000000003"}')$$,'P0001','LEARNING_KIND','Writing rejects video commands');
reset role;
-- Immutability
select throws_ok($$update learning_workspaces set kind='SPEAKING' where id='34000000-0000-4000-8000-000000000003'$$,'P0001','LEARNING_KIND','Kind cannot change');
select lives_ok($$update learning_workspaces set title='Renamed' where id='34000000-0000-4000-8000-000000000003'$$,'Other columns still update');
select is((select kind from learning_workspaces where id='34000000-0000-4000-8000-000000000003'),'WRITING','Commands never change kind');
select * from finish();
rollback;
```

- [ ] **Step 3: 실패 확인**

Run: `supabase test db`
Expected: `learning_workspace_kind.test.sql` FAIL (`column "kind" does not exist`).

- [ ] **Step 4: migration 작성**

Create `supabase/migrations/20261001000000_learning_workspace_kind.sql`:

```sql
-- Each workspace belongs to one learning area. Kind is chosen at creation and never changes.
alter table public.learning_workspaces add column kind text;

create function learning_private.classify_workspace_kind(w public.learning_workspaces) returns text language sql stable set search_path='' as $$
 select case
  when exists(select 1 from public.learning_videos v where v.workspace_id=w.id) then 'LISTENING'
  when w.draft<>'' or exists(select 1 from public.learning_messages m where m.workspace_id=w.id) then 'WRITING'
  when exists(select 1 from public.learning_speech s where s.workspace_id=w.id) then 'SPEAKING'
  when w.title='나의 영어 말하기' then 'SPEAKING'
  else 'WRITING' end;
$$;
update public.learning_workspaces w set kind=learning_private.classify_workspace_kind(w);
alter table public.learning_workspaces alter column kind set not null;
alter table public.learning_workspaces add constraint learning_workspaces_kind check(kind in ('LISTENING','SPEAKING','WRITING'));
create index learning_workspaces_kind_recent on public.learning_workspaces(user_id,kind,updated_at desc,id desc);

-- Creation paths pass the kind through a transaction-local setting; direct inserts must name it.
create function learning_private.workspace_kind_default() returns trigger language plpgsql set search_path='' as $$
begin
 new.kind:=coalesce(new.kind,nullif(current_setting('paceon.workspace_kind',true),''));
 return new;
end;
$$;
create trigger learning_workspaces_kind_default before insert on public.learning_workspaces for each row execute function learning_private.workspace_kind_default();
create function learning_private.workspace_kind_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind is distinct from old.kind then raise exception 'LEARNING_KIND'; end if;
 return new;
end;
$$;
create trigger learning_workspaces_kind_immutable before update of kind on public.learning_workspaces for each row execute function learning_private.workspace_kind_immutable();

-- Missing or foreign workspaces pass through so the wrapped command keeps its NOT_FOUND contract.
create function learning_private.require_workspace_kind(p_workspace_id uuid,p_allowed text[]) returns void language plpgsql set search_path='' as $$
declare k text;
begin
 select kind into k from public.learning_workspaces where id=p_workspace_id and user_id=auth.uid();
 if found and not (k=any(p_allowed)) then raise exception 'LEARNING_KIND'; end if;
end;
$$;

alter function public.learning_command(jsonb) set schema learning_private;
alter function learning_private.learning_command(jsonb) rename to learning_command_admission;
create function public.learning_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a text:=p_command->>'action'; k text; wid uuid; result jsonb;
begin
 if a='CREATE' then
  if jsonb_typeof(p_command->'kind') is distinct from 'string' or p_command->>'kind' not in ('SPEAKING','WRITING') then raise exception 'LEARNING_INVALID'; end if;
  k:=p_command->>'kind';
  perform set_config('paceon.workspace_kind',k,true);
  result:=learning_private.learning_command_admission(p_command-'kind');
  perform set_config('paceon.workspace_kind','',true);
  -- The core stores the command without kind, so a replay with another kind must be caught here.
  if result->'workspace' ? 'kind' and result->'workspace'->>'kind'<>k then raise exception 'LEARNING_CONFLICT'; end if;
  return result;
 end if;
 if a in ('SAVE_DRAFT','MESSAGE','SUMMARY') and jsonb_typeof(p_command->'workspaceId')='string' then
  perform learning_private.require_workspace_kind((p_command->>'workspaceId')::uuid,array['WRITING','LISTENING']);
 elsif a='RETRY' and jsonb_typeof(p_command->'jobId')='string' then
  select workspace_id into wid from public.learning_ai_jobs where id=(p_command->>'jobId')::uuid and user_id=auth.uid();
  if found then perform learning_private.require_workspace_kind(wid,array['WRITING','LISTENING']); end if;
 end if;
 return learning_private.learning_command_admission(p_command);
exception when invalid_text_representation then raise exception 'LEARNING_INVALID';
end;
$$;
revoke all on function public.learning_command(jsonb) from public,anon,service_role;
grant execute on function public.learning_command(jsonb) to authenticated;

alter function public.learning_speech_command(jsonb) set schema learning_private;
alter function learning_private.learning_speech_command(jsonb) rename to speech_retention_command;
create function public.learning_speech_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a text:=p_command->>'action'; wid uuid;
begin
 -- DELETE, DELETE_AUDIO and KEEP manage personal data and stay available in every area.
 if a='PROMPT' and jsonb_typeof(p_command->'workspaceId')='string' then
  wid:=(p_command->>'workspaceId')::uuid;
 elsif a in ('EDIT','RETRY') and jsonb_typeof(p_command->'id')='string' then
  select workspace_id into wid from public.learning_speech where id=(p_command->>'id')::uuid and user_id=auth.uid();
 elsif a='SPEECH_TICK' and jsonb_typeof(p_command->'sessionId')='string' then
  select workspace_id into wid from public.learning_sessions where id=(p_command->>'sessionId')::uuid and user_id=auth.uid();
 end if;
 if wid is not null then perform learning_private.require_workspace_kind(wid,array['SPEAKING','LISTENING']); end if;
 return learning_private.speech_retention_command(p_command);
exception when invalid_text_representation then raise exception 'LEARNING_INVALID';
end;
$$;
revoke all on function public.learning_speech_command(jsonb) from public,anon,service_role;
grant execute on function public.learning_speech_command(jsonb) to authenticated;

alter function public.begin_speech_upload(uuid,uuid,uuid,text,text,bigint,text) set schema learning_private;
alter function learning_private.begin_speech_upload(uuid,uuid,uuid,text,text,bigint,text) rename to begin_speech_upload_core;
create function public.begin_speech_upload(p_id uuid,p_workspace_id uuid,p_session_id uuid,p_reference_text text,p_mime_type text,p_file_size bigint,p_content_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform learning_private.require_workspace_kind(p_workspace_id,array['SPEAKING','LISTENING']);
 return learning_private.begin_speech_upload_core(p_id,p_workspace_id,p_session_id,p_reference_text,p_mime_type,p_file_size,p_content_sha256);
end;
$$;
revoke all on function public.begin_speech_upload(uuid,uuid,uuid,text,text,bigint,text) from public,anon,service_role;
grant execute on function public.begin_speech_upload(uuid,uuid,uuid,text,text,bigint,text) to authenticated;

alter function public.learning_video_command(jsonb) set schema learning_private;
alter function learning_private.learning_video_command(jsonb) rename to learning_video_command_core;
create function public.learning_video_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a text:=p_command->>'action'; wid uuid; result jsonb;
begin
 if a='VIDEO_ADD' then
  perform set_config('paceon.workspace_kind','LISTENING',true);
  result:=learning_private.learning_video_command_core(p_command);
  perform set_config('paceon.workspace_kind','',true);
  return result;
 end if;
 if jsonb_typeof(p_command->'workspaceId')='string' then
  wid:=(p_command->>'workspaceId')::uuid;
 elsif jsonb_typeof(p_command->'sessionId')='string' then
  select workspace_id into wid from public.learning_sessions where id=(p_command->>'sessionId')::uuid and user_id=auth.uid();
 end if;
 if wid is not null then perform learning_private.require_workspace_kind(wid,array['LISTENING']); end if;
 return learning_private.learning_video_command_core(p_command);
exception when invalid_text_representation then raise exception 'LEARNING_INVALID';
end;
$$;
revoke all on function public.learning_video_command(jsonb) from public,anon,service_role;
grant execute on function public.learning_video_command(jsonb) to authenticated;
revoke all on all functions in schema learning_private from public,anon,authenticated;
```

- [ ] **Step 5: 기존 fixture에 종류 지정**

각 파일의 `insert into learning_workspaces(id,user_id,title) values(...,'<title>');`를 `insert into learning_workspaces(id,user_id,title,kind) values(...,'<title>','<KIND>');`로 바꾼다(열 목록에 `,kind`, 값 끝에 종류 추가).

| 파일 | 종류 | 근거 |
| --- | --- | --- |
| `learning_room_timing.test.sql` | `WRITING` | 세션·글 AI 작업만 사용 |
| `learning_speech.test.sql` | `SPEAKING` | 음성 명령만 사용 |
| `learning_speech_audio_delete.test.sql` | `SPEAKING` | `DELETE_AUDIO`만 사용 |
| `learning_speech_quota.test.sql` | `LISTENING` | `MESSAGE`와 음성을 함께 사용 |
| `learning_speech_timing.test.sql` | `SPEAKING` | `START`·`SPEECH_TICK` |

`learning_room.test.sql` 12행의 CREATE JSON `..."title":"Practice","prompt":"Daily life"}`를 `..."title":"Practice","prompt":"Daily life","kind":"WRITING"}`로 바꾼다. 16행(잘못된 UUID)은 그대로 둔다: `kind`가 없어도 기대값이 `LEARNING_INVALID`이다.

- [ ] **Step 6: migration 적용과 전체 pgTAP 통과**

Run: `supabase migration up --local` 후 `supabase test db`
Expected: 전체 PASS. 실패하면 새 wrapper가 기존 오류 코드를 바꿨는지 해당 테스트의 기대 코드와 비교한다.

- [ ] **Step 7: DB 타입 재생성**

Run: `pnpm db:types` 후 `pnpm db:types:check`
Expected: `Database types match the local schema.`, `learning_workspaces.Row`에 `kind: string`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20261001000000_learning_workspace_kind.sql supabase/tests packages/shared/src/database.types.ts
git commit -m "feat(db): store learning workspace kind and enforce area commands"
```

---

### Task 2: API — 목록 필터, 생성 종류, 오류 매핑

**Files:**
- Modify: `apps/web/src/lib/learning.ts`, `apps/web/src/lib/learning-api.ts:5-10,51-65`, `apps/web/src/lib/speech-api.ts:17-22`, `apps/web/src/lib/learning-videos-api.ts:11-16`, `apps/web/src/components/learning-types.ts:1-10`
- Test: `tests/learning-api.test.mjs`, `tests/speech-api.test.mjs`, `tests/learning-videos-api.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `CREATE.kind`, `kind` 컬럼, `LEARNING_KIND`.
- Produces: `learningKindSchema` (`z.enum(['LISTENING','SPEAKING','WRITING'])`), `type LearningKind`, `parseLearningListQuery(params: URLSearchParams): { offset: string; kind: LearningKind | null } | null`; `GET /api/learning/workspaces?kind=&offset=` 응답 형식 유지(각 공간에 `kind`); `POST /api/learning/workspaces` 본문 `kind` 필수; `LearningWorkspace.kind: LearningKind`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/learning-api.test.mjs`:
- 8행 `create`를 `{action:'CREATE',requestId:id,workspaceId:id,title:'영어 한 문장',prompt:'',kind:'WRITING'}`로 바꾼다.
- 29행 거부 목록 배열에 `{...create,kind:'LISTENING'}`, `(({kind,...rest})=>rest)(create)`를 추가한다.
- 57행 배열에 `['LEARNING_KIND',409]`를 추가한다.
- import에 `parseLearningListQuery`를 추가하고 파일 끝에 추가:

```js
test('list query accepts one known kind and offset only',()=>{
 const q=s=>parseLearningListQuery(new URLSearchParams(s));
 assert.deepEqual(q(''),{offset:'0',kind:null});
 assert.deepEqual(q('kind=SPEAKING&offset=100'),{offset:'100',kind:'SPEAKING'});
 for(const bad of ['kind=READING','kind=writing','kind=WRITING&kind=SPEAKING','offset=1&offset=2','offset=-1','offset=100001','surprise=1']) assert.equal(q(bad),null,bad);
});
test('workspace list filters workspaces and sessions by kind without exposing the join',async()=>{
 const urls=[];
 const handlers=createLearningHandlers({url:'http://127.0.0.1:55321',key:'public'},true,async(url)=>{
  const u=new URL(url);
  if(u.pathname.endsWith('/auth/v1/user'))return Response.json({id});
  urls.push(u);
  if(u.pathname.endsWith('/learning_sessions'))return Response.json([{id:other,workspace_id:id,learning_workspaces:{kind:'WRITING'}}]);
  if(u.pathname.endsWith('/learning_workspaces'))return Response.json([{id,kind:'WRITING'}]);
  return Response.json([]);
 });
 const list=query=>handlers.LIST(new Request(`http://localhost/api/learning/workspaces${query}`,{headers:{Authorization:'Bearer owner'}}));
 const body=await (await list('?kind=WRITING')).json();
 assert.equal(urls.find(u=>u.pathname.endsWith('/learning_workspaces')).searchParams.get('kind'),'eq.WRITING');
 const sessions=urls.find(u=>u.pathname.endsWith('/learning_sessions'));
 assert.equal(sessions.searchParams.get('select'),'*,learning_workspaces!inner(kind)');
 assert.equal(sessions.searchParams.get('learning_workspaces.kind'),'eq.WRITING');
 assert.deepEqual(body.sessions,[{id:other,workspace_id:id}]);
 assert.equal(urls.some(u=>u.pathname.endsWith('/learning_videos')),false,'writing list skips videos');
 assert.equal((await list('?kind=READING')).status,400);
 urls.length=0;
 await list('');
 assert.equal(urls.find(u=>u.pathname.endsWith('/learning_workspaces')).searchParams.has('kind'),false);
 assert.equal(urls.some(u=>u.pathname.endsWith('/learning_videos')),true,'all-area list keeps videos for resume links');
});
test('workspace creation requires a speaking or writing kind',async()=>{
 const {handlers,writes}=fixture();
 const post=body=>handlers.POST(request(body));
 assert.equal((await post({requestId:id,workspaceId:id,title:'x',prompt:''})).status,400);
 assert.equal((await post({requestId:id,workspaceId:id,title:'x',prompt:'',kind:'LISTENING'})).status,400);
 assert.equal((await post({requestId:id,workspaceId:id,title:'x',prompt:'',kind:'SPEAKING'})).status,201);
 assert.equal(writes.at(-1).p_command.kind,'SPEAKING');
});
```

`tests/speech-api.test.mjs` 파일 끝에 추가:

```js
test('speech area violations map to a safe conflict',async()=>{
 const {handlers}=fixture(parsed=>parsed.pathname.endsWith('learning_speech_command')?Response.json({message:'LEARNING_KIND',details:'secret'},{status:400}):null);
 const response=await handlers.COMMAND(command({action:'PROMPT',requestId:id,id,workspaceId:id,level:'EASY',topic:''}));
 assert.equal(response.status,409);
 assert.deepEqual(await response.json(),{error:'이 영역에서는 사용할 수 없는 기능이에요.'});
});
```

`tests/learning-videos-api.test.mjs` 파일 끝에 추가:

```js
test('video area violations are reported per item without raw details',async()=>{
 const {handler}=fixture('LEARNING_KIND');
 const result=await (await handler.POST(req({requestId:id,items:[{url:'https://youtu.be/dQw4w9WgXcQ'}]}))).json();
 assert.equal(result.results[0].error,'이 영역에서는 사용할 수 없는 기능이에요.');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/learning-api.test.mjs tests/speech-api.test.mjs tests/learning-videos-api.test.mjs`
Expected: FAIL (`parseLearningListQuery` export 없음, `LEARNING_KIND` 503).

- [ ] **Step 3: 구현**

`apps/web/src/lib/learning.ts` — 3행 아래에 추가하고 CREATE 스키마를 바꾼다:

```ts
export const learningKindSchema = z.enum(['LISTENING', 'SPEAKING', 'WRITING']);
export type LearningKind = z.infer<typeof learningKindSchema>;
```

```ts
  z.strictObject({ action:z.literal('CREATE'), ...workspace, title:z.string().trim().min(1).max(120), prompt:z.string().max(1000).default(''), kind:z.enum(['SPEAKING','WRITING']) }),
```

파일 끝에 추가:

```ts
export function parseLearningListQuery(params: URLSearchParams): { offset: string; kind: LearningKind | null } | null {
  if ([...params.keys()].some(key => key !== 'offset' && key !== 'kind') || params.getAll('offset').length > 1 || params.getAll('kind').length > 1) return null;
  const offset = params.get('offset') ?? '0', kind = params.get('kind');
  if (!/^\d+$/.test(offset) || Number(offset) > 100000) return null;
  if (kind !== null && !learningKindSchema.safeParse(kind).success) return null;
  return { offset, kind: kind as LearningKind | null };
}
```

`apps/web/src/lib/learning-api.ts` — import에 `parseLearningListQuery`를 추가하고, `errors`에 `LEARNING_KIND:[409,'이 영역에서는 사용할 수 없는 기능이에요.'],`를 추가한다. `LIST`의 try 본문을 교체한다:

```ts
        const auth = await authenticate(request);
        const query = parseLearningListQuery(new URL(request.url).searchParams);
        if(!query) throw new ApiError(400,'목록 조회 범위를 확인해 주세요.');
        const [workspaces,sessionRows] = await Promise.all([
          rows(auth,'learning_workspaces',{order:'updated_at.desc,id.desc',offset:query.offset,...(query.kind?{kind:`eq.${query.kind}`}:{})}),
          rows(auth,'learning_sessions',{order:'updated_at.desc,id.desc',limit:'100',...(query.kind?{select:'*,learning_workspaces!inner(kind)','learning_workspaces.kind':`eq.${query.kind}`}:{})}),
        ]);
        const sessions=sessionRows.map(row=>{const {learning_workspaces:joined,...session}=row;void joined;return session;});
        const page=workspaces.slice(0,100);
        const withVideos=!query.kind||query.kind==='LISTENING';
        const videos=withVideos&&page.length?await rows(auth,'learning_videos',{select:'workspace_id,video_id,start_seconds,position_seconds,duration_seconds,favorite,archived,updated_at',workspace_id:`in.(${page.map(w=>w.id).join(',')})`,limit:'100'}):[];
        return json({workspaces:page,sessions,videos,aiEnabled,nextOffset:workspaces.length>100?Number(query.offset)+100:null});
```

`speech-api.ts` `errorMessages`와 `learning-videos-api.ts` `messages`에 각각 `LEARNING_KIND: [409, '이 영역에서는 사용할 수 없는 기능이에요.'],`를 추가한다.

`apps/web/src/components/learning-types.ts` 맨 위에 `export type LearningKind = 'LISTENING' | 'SPEAKING' | 'WRITING';`를 추가하고 `LearningWorkspace`에 `kind: LearningKind;`를 추가한다.

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/learning-api.test.mjs tests/speech-api.test.mjs tests/learning-videos-api.test.mjs` 후 `pnpm typecheck`
Expected: PASS. typecheck는 `learning-home.tsx`의 CREATE 본문에 `kind`가 없어도 통과한다(JSON 본문이라 타입 검사 대상 아님). 화면은 Task 5에서 바꾼다.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/learning.ts apps/web/src/lib/learning-api.ts apps/web/src/lib/speech-api.ts apps/web/src/lib/learning-videos-api.ts apps/web/src/components/learning-types.ts tests/learning-api.test.mjs tests/speech-api.test.mjs tests/learning-videos-api.test.mjs
git commit -m "feat(api): filter learning lists by area and require workspace kind"
```

---

### Task 3: 영역 순수 함수

**Files:**
- Create: `apps/web/src/components/learning-areas.ts`
- Test: `tests/learning-areas.test.mjs`

**Interfaces:**
- Consumes: `LearningKind`, `LearningList`, `LearningWorkspace` (Task 2).
- Produces:
  - `learningAreas: readonly { kind: LearningKind; slug: LearningAreaSlug; label: string }[]` (리스닝·스피킹·라이팅 순서)
  - `type LearningAreaSlug = 'listening' | 'speaking' | 'writing'`
  - `LAST_AREA_KEY = 'paceon:learn:last-area'`
  - `resolveLearningArea(stored: string | null): LearningAreaSlug`
  - `areaForKind(kind: LearningKind)`
  - `workspaceHref(workspace: { id: string; kind: LearningKind }): string`
  - `learningRoomFeatures(kind: LearningKind): { video: boolean; writing: boolean; speech: boolean; legacySpeech: boolean }`
  - `resumeWorkspaces(list: LearningList | null, limit?: number): LearningWorkspace[]`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/learning-areas.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { learningAreas, resolveLearningArea, areaForKind, workspaceHref, learningRoomFeatures, resumeWorkspaces } from '../apps/web/src/components/learning-areas.ts';

test('areas keep a fixed tab order and fall back to listening',()=>{
 assert.deepEqual(learningAreas.map(a=>a.slug),['listening','speaking','writing']);
 assert.equal(resolveLearningArea('writing'),'writing');
 for(const stored of [null,'','reading','WRITING']) assert.equal(resolveLearningArea(stored),'listening');
 assert.equal(areaForKind('SPEAKING').label,'스피킹');
});
test('workspace links keep existing room addresses',()=>{
 assert.equal(workspaceHref({id:'a',kind:'LISTENING'}),'/learn/items/a');
 assert.equal(workspaceHref({id:'b',kind:'SPEAKING'}),'/learn/b');
 assert.equal(workspaceHref({id:'c',kind:'WRITING'}),'/learn/c');
});
test('rooms show only their area features',()=>{
 assert.deepEqual(learningRoomFeatures('LISTENING'),{video:true,writing:true,speech:true,legacySpeech:false});
 assert.deepEqual(learningRoomFeatures('SPEAKING'),{video:false,writing:false,speech:true,legacySpeech:false});
 assert.deepEqual(learningRoomFeatures('WRITING'),{video:false,writing:true,speech:false,legacySpeech:true});
});
test('resume picks the three most recent workspaces and skips archived videos',()=>{
 const w=(id,kind,updated_at)=>({id,kind,updated_at,user_id:'u',title:id,prompt:'',draft:'',draft_version:0,created_at:updated_at});
 const list={aiEnabled:true,sessions:[],workspaces:[w('old','WRITING','2026-09-01'),w('archived','LISTENING','2026-09-05'),w('new','SPEAKING','2026-09-04'),w('mid','LISTENING','2026-09-03'),w('low','WRITING','2026-09-02')],videos:[{workspace_id:'archived',archived:true},{workspace_id:'mid',archived:false}]};
 assert.deepEqual(resumeWorkspaces(list).map(x=>x.id),['new','mid','low']);
 assert.deepEqual(resumeWorkspaces(null),[]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/learning-areas.test.mjs`
Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: 구현**

Create `apps/web/src/components/learning-areas.ts`:

```ts
import type { LearningKind, LearningList, LearningWorkspace } from './learning-types';

export type LearningAreaSlug = 'listening' | 'speaking' | 'writing';
export const LAST_AREA_KEY = 'paceon:learn:last-area';
export const learningAreas: readonly { kind: LearningKind; slug: LearningAreaSlug; label: string }[] = [
  { kind: 'LISTENING', slug: 'listening', label: '리스닝' },
  { kind: 'SPEAKING', slug: 'speaking', label: '스피킹' },
  { kind: 'WRITING', slug: 'writing', label: '라이팅' },
];

export const resolveLearningArea = (stored: string | null): LearningAreaSlug =>
  learningAreas.find(area => area.slug === stored)?.slug ?? 'listening';

export const areaForKind = (kind: LearningKind) => learningAreas.find(area => area.kind === kind) ?? learningAreas[0];

export const workspaceHref = (workspace: { id: string; kind: LearningKind }) =>
  workspace.kind === 'LISTENING' ? `/learn/items/${workspace.id}` : `/learn/${workspace.id}`;

/** Listening keeps questions and shadowing; writing only lists speech recorded before the area split. */
export const learningRoomFeatures = (kind: LearningKind) => ({
  video: kind === 'LISTENING',
  writing: kind !== 'SPEAKING',
  speech: kind !== 'WRITING',
  legacySpeech: kind === 'WRITING',
});

export function resumeWorkspaces(list: LearningList | null, limit = 3): LearningWorkspace[] {
  if (!list) return [];
  const archived = new Set((list.videos ?? []).filter(video => video.archived).map(video => video.workspace_id));
  return list.workspaces
    .filter(workspace => !archived.has(workspace.id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/learning-areas.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/learning-areas.ts tests/learning-areas.test.mjs
git commit -m "feat(web): add learning area helpers"
```

---

### Task 4: 설정 페이지와 YouTube 분리

**Files:**
- Create: `apps/web/src/components/youtube-client.ts`, `youtube-connection.tsx`, `youtube-import.tsx`, `apps/web/src/app/(workspace)/settings/page.tsx`
- Delete: `apps/web/src/components/youtube-account.tsx`
- Modify: `apps/web/src/lib/youtube-oauth.ts` (`redirect` 정의), `apps/web/src/components/app-shell.tsx`, `apps/web/src/components/learning-video-library.tsx`, `apps/web/src/components/learning-home.tsx:7,124`
- Test: `tests/youtube-oauth.test.mjs`

**Interfaces:**
- Produces: `youtubeApi<T>(path: string, body?: unknown): Promise<T>`, `type YouTubeStatus`; `<YouTubeConnection />`; `<YouTubeImport onSaved?: () => void />` (연결 설정이 없으면 렌더링하지 않음).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/youtube-oauth.test.mjs` 46행의 `/connected/`를 `/^http:\/\/localhost:3000\/settings\?youtube=connected$/`로, 52행의 `/denied/`를 `/\/settings\?youtube=denied$/`로 바꾼다.

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/youtube-oauth.test.mjs`
Expected: FAIL (location이 `/learn?youtube=connected`).

- [ ] **Step 3: OAuth 이동 주소 변경**

`apps/web/src/lib/youtube-oauth.ts`의 `redirect`에서 `` `${config?.appUrl ?? ''}/learn?youtube=${status}` ``를 `` `${config?.appUrl ?? ''}/settings?youtube=${status}` ``로 바꾼다.

Run: `node --test tests/youtube-oauth.test.mjs`
Expected: PASS.

- [ ] **Step 4: 공통 클라이언트 작성**

Create `apps/web/src/components/youtube-client.ts`:

```ts
import { getSupabaseBrowser } from '@/lib/supabase-browser';

export type YouTubeStatus = { configured: boolean; connected: boolean; channel?: { id: string; title: string; thumbnail?: string }; error?: string };

export async function youtubeApi<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await getSupabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('로그인이 필요합니다.');
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '요청을 처리하지 못했습니다.');
  return result as T;
}
```

- [ ] **Step 5: 설정용 연결 관리 작성**

Create `apps/web/src/components/youtube-connection.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Button } from './ui/button';
import { youtubeApi, type YouTubeStatus } from './youtube-client';

const results: Record<string, string> = {
  connected: 'YouTube 계정이 연결되었습니다.',
  denied: 'Google 연결을 취소했습니다.',
  failed: 'YouTube 연결을 완료하지 못했습니다. 다시 시도해 주세요.',
};

export function YouTubeConnection() {
  const [status, setStatus] = useState<YouTubeStatus>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    const result = new URLSearchParams(window.location.search).get('youtube');
    if (result) window.history.replaceState(null, '', '/settings');
    void youtubeApi<YouTubeStatus>('/api/youtube/status').then(value => {
      if (cancelled) return;
      setStatus(value);
      if (result) setMessage(results[result] ?? results.failed);
    }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : '연결을 확인할 수 없습니다.'); });
    return () => { cancelled = true; };
  }, []);
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(''); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'); } finally { setBusy(false); } }
  return <div className="space-y-3 rounded-xl border border-border bg-card p-5" aria-label="YouTube 계정 연결">
    <h3 className="font-semibold">YouTube</h3>
    <p className="text-sm text-muted-foreground">연결하면 학습실 리스닝에서 내 재생목록과 구독 채널의 영상을 골라 가져올 수 있어요. 읽기 권한만 사용하며, Premium 활성화나 전체 시청 기록·나중에 볼 동영상 동기화는 제공하지 않아요.</p>
    {!status && !message && <p role="status" className="text-sm">연결 상태 확인 중…</p>}
    {status && !status.configured && <p className="text-sm">YouTube 계정 연결 설정이 아직 준비되지 않았습니다. 영상 링크 저장과 학습은 이용할 수 있습니다.</p>}
    {status?.configured && <div className="flex flex-wrap items-center gap-2">
      {status.connected && <span className="flex items-center gap-2 text-sm">{status.channel?.thumbnail && <Image unoptimized src={status.channel.thumbnail} width={28} height={28} alt="" className="rounded-full" />}{status.channel?.title || 'YouTube 계정 연결됨'}</span>}
      <Button variant="outline" disabled={busy} onClick={() => void run(async () => { const result = await youtubeApi<{ url: string }>('/api/youtube/connect', {}); window.location.assign(result.url); })}>{status.connected ? '다시 연결' : 'Google로 연결'}</Button>
      {status.connected && <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
        const result = await youtubeApi<{ revoked: boolean }>('/api/youtube/disconnect', {});
        setStatus({ configured: true, connected: false });
        setMessage(result.revoked ? '연결 및 저장된 인증 정보를 삭제했습니다.' : '저장된 인증 정보는 삭제했습니다. Google 권한 철회는 완료하지 못했습니다. Google 계정의 연결된 앱에서도 접근 권한을 삭제해 주세요.');
      })}>연결 해제</Button>}
    </div>}
    {status?.error && <p className="text-sm" role="status">{status.error}</p>}
    {message && <p className="text-sm" role="status">{message}</p>}
    <a className="inline-block min-h-11 py-3 text-xs underline" href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">Google 계정에서 접근 권한 관리</a>
  </div>;
}
```

- [ ] **Step 6: 리스닝용 가져오기 작성**

Create `apps/web/src/components/youtube-import.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { mergeYouTubeLibraryItems, type YouTubeLibraryItem } from '@/lib/youtube-library';
import { Button } from './ui/button';
import { youtubeApi, type YouTubeStatus } from './youtube-client';

type Page = { items: YouTubeLibraryItem[]; nextPageToken?: string };

export function YouTubeImport({ onSaved }: { onSaved?: () => void }) {
  const [status, setStatus] = useState<YouTubeStatus>();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<YouTubeLibraryItem[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState(''), [next, setNext] = useState<string>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    let cancelled = false;
    // A failed status check hides the entry point; manual links keep working.
    void youtubeApi<YouTubeStatus>('/api/youtube/status').then(value => { if (!cancelled) setStatus(value); }).catch(() => { if (!cancelled) setStatus({ configured: false, connected: false }); });
    return () => { cancelled = true; };
  }, []);
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(''); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'); } finally { setBusy(false); } }
  async function load(value: string, pageToken?: string) {
    const requestGeneration = ++generation.current;
    const page = await youtubeApi<Page>(`/api/youtube/library?${value}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    if (generation.current !== requestGeneration) return;
    setItems(previous => mergeYouTubeLibraryItems(pageToken ? previous : [], page.items));
    setQuery(value); setNext(page.nextPageToken);
    if (!pageToken) setSelected([]);
  }
  if (!status?.configured) return null;
  if (!status.connected) return <p className="text-sm text-muted-foreground">내 재생목록에서 고르려면 <Link href="/settings" className="text-primary underline">설정에서 YouTube 계정을 연결</Link>하세요.</p>;
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>YouTube에서 가져오기</Button>;
  return <div className="space-y-3 rounded-xl border border-border bg-card p-5" aria-label="YouTube에서 가져오기">
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={busy} onClick={() => void run(() => load('kind=playlists'))}>내 재생목록</Button>
      <Button variant="outline" disabled={busy} onClick={() => void run(() => load('kind=subscriptions'))}>구독 채널</Button>
      <Button variant="ghost" onClick={() => { generation.current++; setOpen(false); setItems([]); setSelected([]); setNext(undefined); setQuery(''); }}>닫기</Button>
    </div>
    {query && items.length === 0 && !busy && <p className="text-sm">조회 가능한 항목이 없습니다.</p>}
    <ul className="max-h-80 space-y-2 overflow-auto">
      {items.map(item => <li key={`${item.kind}:${item.id}`}>
        {item.kind === 'video' ? <label className="flex min-h-11 items-start gap-2 rounded border border-border p-2 text-sm">
          <input type="checkbox" checked={selected.includes(item.id)} disabled={busy || (!selected.includes(item.id) && selected.length >= 20)} onChange={event => setSelected(previous => event.target.checked ? [...new Set([...previous, item.id])] : previous.filter(id => id !== item.id))} />
          <span>{item.title}</span>
        </label> : <Button variant="outline" className="w-full justify-start" disabled={busy} onClick={() => void run(() => load(`kind=videos&${item.kind === 'playlist' ? 'playlistId' : 'channelId'}=${encodeURIComponent(item.id)}`))}>{item.title} →</Button>}
      </li>)}
    </ul>
    {next && <Button variant="outline" disabled={busy} onClick={() => void run(() => load(query, next))}>다음 페이지</Button>}
    {items.some(item => item.kind === 'video') && <div className="space-y-2">
      <p className="text-xs text-muted-foreground">선택한 영상의 링크만 저장합니다. YouTube 제목은 현재 화면에서만 표시하며, 저장 후 학습 자료 이름을 직접 정할 수 있습니다.</p>
      <Button disabled={busy || !selected.length} onClick={() => void run(async () => {
        const chosen = [...selected];
        const result = await youtubeApi<{ results: { index: number; error?: string }[] }>('/api/learning/videos', { requestId: crypto.randomUUID(), items: chosen.map(id => ({ url: `https://www.youtube.com/watch?v=${id}` })) });
        const failures = result.results.filter(item => item.error);
        setSelected(failures.map(item => chosen[item.index]).filter((id): id is string => typeof id === 'string'));
        setMessage(`${result.results.length - failures.length}개 저장 또는 기존 자료 재사용${failures.length ? `, ${failures.length}개 실패: ${failures.map(item => item.error).join(', ')}` : ''}`);
        onSaved?.();
      })}>선택한 영상 {selected.length}/20개 저장</Button>
    </div>}
    {busy && <p className="text-sm" role="status">처리 중…</p>}
    {message && <p className="text-sm" role="status">{message}</p>}
  </div>;
}
```

- [ ] **Step 7: 설정 페이지와 헤더 입구**

Create `apps/web/src/app/(workspace)/settings/page.tsx`:

```tsx
import { YouTubeConnection } from '@/components/youtube-connection';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold">설정</h1>
      </header>
      <section aria-labelledby="accounts-title" className="space-y-3">
        <h2 id="accounts-title" className="font-semibold">연결된 계정</h2>
        <YouTubeConnection />
      </section>
    </div>
  );
}
```

`apps/web/src/components/app-shell.tsx`:
- lucide import에 `Settings`를 추가한다.
- `title` 계산을 교체한다:

```tsx
  const title =
    pathname === '/resources/new'
      ? '학습 자료 추가'
      : pathname === '/settings'
        ? '설정'
        : (navigation.find((item) => active(item.href))?.label ?? '서재');
```

- 헤더의 모바일 로그아웃 `Button` 바로 앞에 추가한다:

```tsx
            <Button asChild variant="ghost" size="icon" aria-label="설정">
              <Link href="/settings" aria-current={pathname === '/settings' ? 'page' : undefined}>
                <Settings aria-hidden="true" />
              </Link>
            </Button>
```

- [ ] **Step 8: 기존 화면 연결 교체**

- `learning-video-library.tsx`: `import { YouTubeImport } from './youtube-import';`를 추가하고, `실패한 링크만 다시 입력` 버튼 줄 다음(링크 입력 카드 `</div>` 앞)에 `<YouTubeImport onSaved={() => void reload()} />`를 추가한다.
- `learning-home.tsx`: 7행 import와 124행 `<YouTubeAccount onSaved={() => void reload()} />`를 삭제한다(파일 자체는 Task 5에서 삭제).
- `git rm apps/web/src/components/youtube-account.tsx`

- [ ] **Step 9: 검증**

Run: `pnpm test`, `pnpm typecheck`, `pnpm lint`
Expected: PASS.

Run: `pnpm dev` 후 브라우저에서 `/settings`
Expected: 헤더 톱니 아이콘 → 설정 화면, YouTube 카드 표시(설정이 없으면 준비 안내). 학습실 영상 링크 입력 아래 가져오기 버튼 또는 설정 링크.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/youtube-client.ts apps/web/src/components/youtube-connection.tsx apps/web/src/components/youtube-import.tsx "apps/web/src/app/(workspace)/settings/page.tsx" apps/web/src/components/app-shell.tsx apps/web/src/components/learning-video-library.tsx apps/web/src/components/learning-home.tsx apps/web/src/lib/youtube-oauth.ts tests/youtube-oauth.test.mjs
git commit -m "feat(web): move YouTube connection to settings and keep import in listening"
```

---

### Task 5: 학습실 영역 탭

**Files:**
- Create: `apps/web/src/components/learn-redirect.tsx`, `learning-areas-shell.tsx`, `learning-area-home.tsx`, `apps/web/src/app/(workspace)/learn/(areas)/layout.tsx`, `(areas)/listening/page.tsx`, `(areas)/speaking/page.tsx`, `(areas)/writing/page.tsx`
- Modify: `apps/web/src/app/(workspace)/learn/page.tsx`
- Delete: `apps/web/src/components/learning-home.tsx`

**Interfaces:**
- Consumes: Task 2 목록 API, Task 3 `learningAreas`·`LAST_AREA_KEY`·`resolveLearningArea`·`areaForKind`·`workspaceHref`·`resumeWorkspaces`, Task 4 `YouTubeImport`(`LearningVideoLibrary` 내부), PR #2 `sessionStatusLabel`.
- Produces: `<LearnRedirect />`, `<LearningAreasShell>{children}</LearningAreasShell>`, `<LearningAreaHome kind={LearningKind} />`.

- [ ] **Step 1: 라우트 문서 확인**

Read: `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md`, `.../layout.md`
확인할 것: `(areas)` 폴더는 URL에 포함되지 않고, `learn/page.tsx`와 `(areas)/*/page.tsx`의 경로가 겹치지 않는다.

- [ ] **Step 2: 라우트 파일 작성**

`apps/web/src/app/(workspace)/learn/page.tsx`:

```tsx
import { LearnRedirect } from '@/components/learn-redirect';

export default function Page() {
  return <LearnRedirect />;
}
```

`apps/web/src/app/(workspace)/learn/(areas)/layout.tsx`:

```tsx
import type { ReactNode } from 'react';
import { LearningAreasShell } from '@/components/learning-areas-shell';

export default function Layout({ children }: { children: ReactNode }) {
  return <LearningAreasShell>{children}</LearningAreasShell>;
}
```

`(areas)/listening/page.tsx` (speaking·writing은 `kind`만 `SPEAKING`·`WRITING`으로 바꿔 같은 형태로 작성):

```tsx
import { LearningAreaHome } from '@/components/learning-area-home';

export default function Page() {
  return <LearningAreaHome kind="LISTENING" />;
}
```

- [ ] **Step 3: 마지막 탭 이동 작성**

Create `apps/web/src/components/learn-redirect.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LAST_AREA_KEY, resolveLearningArea } from './learning-areas';

export function LearnRedirect() {
  const router = useRouter();
  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(LAST_AREA_KEY); } catch { /* Default area when storage is blocked. */ }
    router.replace(`/learn/${resolveLearningArea(stored)}`);
  }, [router]);
  return <p role="status" className="text-sm text-muted-foreground">학습실을 여는 중…</p>;
}
```

- [ ] **Step 4: 공통 레이아웃 작성**

Create `apps/web/src/components/learning-areas-shell.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from './auth-provider';
import { LAST_AREA_KEY, areaForKind, learningAreas, resumeWorkspaces, workspaceHref } from './learning-areas';
import { learningDuration, type LearningList } from './learning-types';

export function LearningAreasShell({ children }: { children: ReactNode }) {
  const { apiFetch } = useAuth();
  const pathname = usePathname();
  const [recent, setRecent] = useState<LearningList | null>(null);
  useEffect(() => {
    const area = learningAreas.find((item) => pathname === `/learn/${item.slug}`);
    if (!area) return;
    try { localStorage.setItem(LAST_AREA_KEY, area.slug); } catch { /* Tab memory is a convenience only. */ }
  }, [pathname]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void apiFetch('/api/learning/workspaces', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: LearningList | null) => { if (!cancelled) setRecent(body); })
        .catch(() => { /* Resume is optional; each tab reports its own load errors. */ });
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [apiFetch]);
  const resume = resumeWorkspaces(recent);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="mb-2 text-sm font-medium text-primary">나만의 작은 영어 연습</p>
        <h1 className="text-3xl font-semibold">학습실</h1>
        <p className="mt-3 text-muted-foreground">한 문장부터, 내 속도로 이어가요.</p>
      </header>
      {resume.length > 0 && (
        <section aria-labelledby="resume-title" className="space-y-3">
          <h2 id="resume-title" className="font-semibold">이어서 공부하기</h2>
          {resume.map((w) => {
            const video = recent?.videos?.find((v) => v.workspace_id === w.id);
            return (
              <Link key={w.id} href={workspaceHref(w)} className="flex min-h-20 items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 hover:border-primary">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-primary">{areaForKind(w.kind).label}</p>
                  <h3 className="mt-1 break-words font-medium">{w.title}</h3>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {video ? `YouTube · ${learningDuration(video.position_seconds)}에서 이어 보기` : w.draft || w.prompt || '이전 기록 이어 보기'}
                  </p>
                </div>
                <ArrowRight className="shrink-0 text-primary" aria-hidden="true" />
              </Link>
            );
          })}
        </section>
      )}
      <nav aria-label="학습 영역" className="flex gap-1 overflow-x-auto border-b border-border">
        {learningAreas.map((area) => {
          const current = pathname === `/learn/${area.slug}`;
          return (
            <Link key={area.slug} href={`/learn/${area.slug}`} aria-current={current ? 'page' : undefined}
              className={cn('min-h-11 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium', current ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {area.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: 탭 내용 작성**

Create `apps/web/src/components/learning-area-home.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Mic, PencilLine } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { LearningVideoLibrary } from './learning-video-library';
import { sessionStatusLabel } from './learning-room-view';
import { workspaceHref } from './learning-areas';
import { learningDuration, type LearningKind, type LearningList } from './learning-types';

const start = {
  SPEAKING: { icon: Mic, title: '영어로 한 문장 말해 볼까요?', body: 'AI가 만든 문장을 듣고 따라 읽거나 자유롭게 말해 보세요. 마이크와 AI는 버튼을 눌러야 시작돼요.', action: '새 스피킹 시작', name: '나의 영어 말하기', prompt: '', empty: '말하기를 시작하면 학습 시간이 기록돼요.' },
  WRITING: { icon: PencilLine, title: '영어로 한 문장 써 볼까요?', body: '목표나 수준 설정 없이 바로 시작하세요. 글은 자동 저장되고, 원할 때만 AI 피드백을 요청할 수 있어요.', action: '새 글 쓰기', name: '나의 영어 쓰기', prompt: '오늘 있었던 일이나 지금 떠오르는 생각을 영어로 써 보세요.', empty: '글을 쓰기 시작하면 학습 시간이 기록돼요.' },
} as const;

export function LearningAreaHome({ kind }: { kind: LearningKind }) {
  const { apiFetch } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<LearningList | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const creation = useRef<{ requestId: string; workspaceId: string } | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/learning/workspaces?kind=${kind}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('학습실을 불러오지 못했어요. 다시 시도해 주세요.');
      setData(await res.json());
      setError('');
    } catch (e) { setError((e as Error).message); }
  }, [apiFetch, kind]);
  useEffect(() => { const timer = setTimeout(() => void reload(), 0); return () => clearTimeout(timer); }, [reload]);
  async function create(target: 'SPEAKING' | 'WRITING') {
    if (busy) return;
    setBusy(true); setError('');
    creation.current ??= { requestId: crypto.randomUUID(), workspaceId: crypto.randomUUID() };
    try {
      const res = await apiFetch('/api/learning/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...creation.current, kind: target, title: start[target].name, prompt: start[target].prompt }) });
      if (!res.ok) throw new Error('학습실을 만들지 못했어요. 다시 시도하면 같은 요청을 이어갑니다.');
      const body = await res.json();
      router.push(`/learn/${body.workspace.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  async function more() {
    if (!data || data.nextOffset == null) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/learning/workspaces?kind=${kind}&offset=${data.nextOffset}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('이전 학습실을 불러오지 못했어요.');
      const page = (await res.json()) as LearningList;
      setData((previous) => previous ? {
        ...previous,
        videos: [...(previous.videos ?? []), ...(page.videos ?? [])],
        workspaces: [...new Map([...previous.workspaces, ...page.workspaces].map((w) => [w.id, w])).values()],
        nextOffset: page.nextOffset ?? null,
      } : page);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const creator = kind === 'LISTENING' ? null : start[kind];
  return (
    <div className="space-y-8">
      {error && (
        <div role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">
          {error}{' '}
          <Button variant="outline" onClick={() => void reload()}>다시 불러오기</Button>
        </div>
      )}
      {kind === 'LISTENING' && <LearningVideoLibrary data={data} reload={reload} />}
      {creator && kind !== 'LISTENING' && (
        <section className="rounded-2xl border border-border bg-primary-soft p-6 sm:p-8">
          <creator.icon className="mb-4 text-primary" aria-hidden="true" />
          <h2 className="text-xl font-semibold">{creator.title}</h2>
          <p className="mt-2 mb-5 text-sm leading-6 text-muted-foreground">{creator.body}</p>
          <Button className="min-h-11" disabled={busy} onClick={() => void create(kind)}>
            {busy ? '학습실 여는 중…' : creator.action}
            <ArrowRight aria-hidden="true" />
          </Button>
        </section>
      )}
      {kind !== 'LISTENING' && data?.aiEnabled === false && (
        <p className="text-sm text-muted-foreground">현재 AI 피드백은 사용할 수 없어요. 기록과 시간 저장은 계속할 수 있어요.</p>
      )}
      {kind !== 'LISTENING' && data && (data.workspaces.length > 0 || data.nextOffset != null) && (
        <section className="space-y-3" aria-labelledby="area-workspaces-title">
          <h2 id="area-workspaces-title" className="font-semibold">저장한 학습실</h2>
          {data.workspaces.map((w) => (
            <Link key={w.id} href={workspaceHref(w)} className="block min-h-16 rounded-xl border border-border p-4 text-sm">
              <p className="font-medium">{w.title}</p>
              {(w.draft || w.prompt) && <p className="mt-1 truncate text-muted-foreground">{w.draft || w.prompt}</p>}
            </Link>
          ))}
          {data.nextOffset != null && <Button variant="outline" disabled={busy} onClick={() => void more()}>학습실 더 보기</Button>}
        </section>
      )}
      <section aria-labelledby="area-records-title" className="space-y-3">
        <h2 id="area-records-title" className="font-semibold">최근 학습 기록</h2>
        {!data ? (
          <p role="status" className="text-sm text-muted-foreground">학습 기록을 불러오는 중…</p>
        ) : !data.sessions.length ? (
          <p className="text-sm text-muted-foreground">{kind === 'LISTENING' ? '영상을 재생하면 학습 시간이 기록돼요.' : start[kind].empty}</p>
        ) : (
          data.sessions.slice(0, 12).map((s) => (
            <Link key={s.id} href={`${workspaceHref({ id: s.workspace_id, kind })}${kind === 'WRITING' ? '#learning-notes' : ''}`}
              className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium">{data.workspaces.find((w) => w.id === s.workspace_id)?.title ?? '학습 기록'}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(s.started_at).toLocaleDateString('ko-KR')} · {sessionStatusLabel(s.status)} · 기록 보기
                </p>
              </div>
              <span className="font-mono text-sm">{learningDuration(s.elapsed_seconds)}</span>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
```

`git rm apps/web/src/components/learning-home.tsx`

- [ ] **Step 6: 검증**

Run: `pnpm typecheck`, `pnpm lint`, `pnpm test`
Expected: PASS.

Run: `pnpm dev`, 브라우저 390px와 데스크톱에서 `/learn`
Expected:
- `/learn` → `/learn/listening`(처음) 이동, 탭을 바꾼 뒤 `/learn`을 다시 열면 마지막 탭으로 이동.
- 탭 3개가 가로로 들어가고 현재 탭에 밑줄. 이어서 공부하기에 영역 배지.
- 스피킹 탭 **새 스피킹 시작** → `/learn/{id}`, 라이팅 탭 **새 글 쓰기** → `/learn/{id}`.
- 주 메뉴 "학습실"이 탭 화면과 공간 화면 모두에서 활성.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(workspace)/learn" apps/web/src/components/learn-redirect.tsx apps/web/src/components/learning-areas-shell.tsx apps/web/src/components/learning-area-home.tsx apps/web/src/components/learning-home.tsx
git commit -m "feat(web): split learning home into listening, speaking and writing tabs"
```

---

### Task 6: 종류별 공간 화면

**Files:**
- Modify: `apps/web/src/components/learning-room-view.ts` (`timerStatusLabel`), `apps/web/src/components/learning-room.tsx`, `apps/web/src/components/speech-panel.tsx`
- Create: `apps/web/src/components/legacy-speech-records.tsx`
- Test: `tests/learning-room-view.test.mjs`

**Interfaces:**
- Consumes: Task 3 `learningRoomFeatures`·`areaForKind`·`workspaceHref`, `LearningWorkspace.kind`.
- Produces: `timerStatusLabel({ locked, pendingEnd, current, stale, kind: LearningKind })`; `SpeechPanel` 새 선택 prop `writingLink?: boolean` (기본 `true`); `export function SpeechResult({ item, busy, readOnly?, onCommand, onPlay })`; `<LegacySpeechRecords workspaceId={string} />`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/learning-room-view.test.mjs`의 마지막 테스트에서 `base`를 `{ locked: false, pendingEnd: false, current: session(), stale: false, kind: 'WRITING' }`로 바꾸고, `hasVideo: true` 줄을 다음으로 교체한다:

```js
 assert.equal(timerStatusLabel({ ...base, current: null, kind: 'LISTENING' }), '재생하거나 글을 쓰면 시작돼요');
 assert.equal(timerStatusLabel({ ...base, current: null, kind: 'SPEAKING' }), '녹음하거나 음성을 들으면 시작돼요');
 assert.equal(timerStatusLabel({ ...base, current: null }), '글을 쓰면 시작돼요');
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/learning-room-view.test.mjs`
Expected: FAIL (SPEAKING 안내가 `글을 쓰면 시작돼요`).

- [ ] **Step 3: 타이머 안내 구현**

`apps/web/src/components/learning-room-view.ts`: import를 `import type { LearningKind, LearningSession, LearningSnapshot } from './learning-types';`로 바꾸고 `timerStatusLabel`을 교체한다:

```ts
const startHints: Record<LearningKind, string> = {
  LISTENING: '재생하거나 글을 쓰면 시작돼요',
  SPEAKING: '녹음하거나 음성을 들으면 시작돼요',
  WRITING: '글을 쓰면 시작돼요',
};

export function timerStatusLabel({ locked, pendingEnd, current, stale, kind }: {
  locked: boolean; pendingEnd: boolean; current: LearningSession | null; stale: boolean; kind: LearningKind;
}) {
  if (locked) return '다른 기기에서 학습 중';
  if (pendingEnd) return '종료 동기화 대기';
  if (!current) return startHints[kind];
  if (current.status === 'ENDED') return '학습 종료 · 기록됨';
  if (current.status === 'PAUSED' || stale) return '일시 정지';
  return '학습 중 · 시간 동기화 중';
}
```

Run: `node --test tests/learning-room-view.test.mjs`
Expected: PASS.

- [ ] **Step 4: SpeechPanel 조정**

`apps/web/src/components/speech-panel.tsx`:
- props 타입과 구조 분해에 `writingLink = true`(`writingLink?: boolean`)를 추가한다.
- 녹음 불가 오류 두 문구를 교체한다: `'이 브라우저는 녹음을 지원하지 않아요. 아래 영어 쓰기를 이용해 주세요.'` → `'이 브라우저는 녹음을 지원하지 않아요.'`, `'마이크를 허용하지 않았거나 사용할 수 없어요. 아래 영어 쓰기를 이용할 수 있어요.'` → `'마이크를 허용하지 않았거나 사용할 수 없어요. 브라우저의 마이크 권한을 확인해 주세요.'`
- `!enabled` 안내 `'지금은 AI를 사용할 수 없어요. 녹음 보관과 영어 쓰기는 계속할 수 있어요.'` → `'지금은 AI를 사용할 수 없어요. 녹음은 이 기기에 계속 보관할 수 있어요.'`
- `<a className="min-h-11 px-3 py-2 text-sm underline" href="#learning-draft">말하기 어려워요 · 영어 쓰기</a>`를 `{writingLink && <a ...>말하기 어려워요 · 영어 쓰기</a>}`로 감싼다.
- `function SpeechResult({ item, busy, onCommand, onPlay }: { item: LearningSpeech; busy: boolean; onCommand: ...; onPlay: ... })`를 `export function SpeechResult({ item, busy, readOnly = false, onCommand, onPlay }: { item: LearningSpeech; busy: boolean; readOnly?: boolean; onCommand: ...; onPlay: ... })`로 바꾼다.
- `SpeechResult` 안의 `<details><summary ...>인식 문장 수정</summary>...</details>`를 `{!readOnly && <details>...</details>}`로, `{item.status === 'FAILED' && <Button ...>분석 재시도</Button>}`를 `{!readOnly && item.status === 'FAILED' && <Button ...>분석 재시도</Button>}`로 바꾼다.

- [ ] **Step 5: 이전 말하기 기록 작성**

Create `apps/web/src/components/legacy-speech-records.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth-provider';
import { SpeechResult } from './speech-panel';
import type { LearningSpeech } from './learning-types';

/** Recordings made before the area split. Playback does not send SPEECH_TICK and adds no study time. */
export function LegacySpeechRecords({ workspaceId }: { workspaceId: string }) {
  const { apiFetch } = useAuth();
  const [items, setItems] = useState<LearningSpeech[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);
  const release = useCallback(() => {
    audio.current?.pause();
    if (audio.current) URL.revokeObjectURL(audio.current.src);
    audio.current = null;
  }, []);
  const reload = useCallback(async () => {
    const response = await apiFetch(`/api/learning/speech?workspaceId=${workspaceId}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '이전 말하기 기록을 불러오지 못했어요.');
    setItems((body.items as LearningSpeech[]).filter((item) => item.kind === 'RECORDING'));
  }, [apiFetch, workspaceId]);
  useEffect(() => {
    const timer = setTimeout(() => void reload().catch((e) => setError((e as Error).message)), 0);
    const hide = () => { if (document.visibilityState !== 'visible') release(); };
    document.addEventListener('visibilitychange', hide);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', hide); release(); };
  }, [reload, release]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function command(id: string, action: string, extra: Record<string, unknown> = {}) {
    const response = await apiFetch('/api/learning/speech/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, requestId: crypto.randomUUID(), id, ...extra }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '요청을 저장하지 못했어요.');
    await reload();
  }
  async function play(id: string) {
    const response = await apiFetch(`/api/learning/speech/${id}/audio`);
    if (!response.ok) throw new Error('음성을 불러오지 못했어요. 삭제 여부와 보관 기한을 확인해 주세요.');
    const blob = await response.blob();
    if (document.visibilityState !== 'visible') return;
    release();
    const player = new Audio(URL.createObjectURL(blob));
    audio.current = player;
    await player.play();
  }
  if (!items.length && !error) return null;
  return (
    <details className="rounded-xl border border-border p-4">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">이전 말하기 기록 {items.length}개</summary>
      <p className="text-xs text-muted-foreground">영역을 나누기 전에 이 공간에서 녹음한 기록이에요. 새 녹음은 스피킹에서 할 수 있어요. 여기서 재생한 시간은 학습 시간에 포함되지 않아요.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {items.map((item) => (
        <SpeechResult key={`${item.id}:${item.status}`} item={item} busy={busy} readOnly
          onCommand={(action, extra) => run(() => command(item.id, action, extra))}
          onPlay={() => run(() => play(item.id))} />
      ))}
    </details>
  );
}
```

- [ ] **Step 6: LearningRoom 종류별 표시**

`apps/web/src/components/learning-room.tsx`:

1. import 추가:

```tsx
import { usePathname, useRouter } from 'next/navigation';
import { areaForKind, learningRoomFeatures, workspaceHref } from './learning-areas';
import { LegacySpeechRecords } from './legacy-speech-records';
```

2. `const { apiFetch, session: auth } = useAuth();` 다음 줄에 추가:

```tsx
  const router = useRouter();
  const pathname = usePathname();
```

3. `if (!data)` 로딩 반환문 바로 **앞**에 추가(훅이므로 조기 반환보다 앞):

```tsx
  const canonical = data ? workspaceHref(data.workspace) : null;
  useEffect(() => {
    if (canonical && pathname !== canonical) router.replace(canonical);
  }, [canonical, pathname, router]);
```

4. 로딩 반환문 **다음**, `const { provisional, stale } = sessionTiming(...)` 앞에 추가:

```tsx
  const features = learningRoomFeatures(data.workspace.kind);
  const area = areaForKind(data.workspace.kind);
```

5. 헤더 뒤로 가기 링크의 `href="/learn"`을 `` href={`/learn/${area.slug}`} ``로, 링크 텍스트 `학습실`을 `{area.label}`로 바꾼다.
6. `timerStatusLabel({...})` 인자의 `hasVideo: !!data.video,`를 `kind: data.workspace.kind,`로 바꾼다.
7. `{data.video && <LearningVideoPanel`을 `{features.video && data.video && <LearningVideoPanel`로 바꾼다.
8. `<SpeechPanel ... />` 한 줄을 교체한다:

```tsx
      {features.speech && <SpeechPanel workspaceId={id} ownerId={auth!.user.id} stopped={locked || view.pendingEnd || current?.pause_reason === 'MANUAL'} stopToken={stopToken} stopSpeechRef={stopSpeechRef} onMedia={observeSpeech} stopVideo={async () => { await stopPlaybackRef.current?.(); }} writingLink={features.writing} />}
      {features.legacySpeech && <LegacySpeechRecords workspaceId={id} />}
```

9. `{recovery && (<DraftRecovery .../>)}`부터 `id="learning-notes"` `<section>`의 닫는 `</section>`까지를 `{features.writing && (<>` … `</>)}`로 감싼다. 이때 notes section 안의 `<SessionHistory sessions={sessions} />`는 잘라내어 감싼 블록 **다음**(최상위 `</div>` 앞)으로 옮긴다.

- [ ] **Step 7: 검증**

Run: `pnpm test`, `pnpm typecheck`, `pnpm lint`
Expected: PASS.

Run: `pnpm dev`, 브라우저 390px
Expected:
- 스피킹 공간: 타이머와 말하기 패널만, "말하기 어려워요 · 영어 쓰기" 링크 없음, 안내 `녹음하거나 음성을 들으면 시작돼요`.
- 라이팅 공간: 글쓰기·AI·노트·기록, 말하기 패널 없음. migration 전에 음성을 녹음한 공간이면 접힌 **이전 말하기 기록**에 수정·재분석 버튼 없이 재생·삭제·보관만 있음. 재생 중 타이머가 늘지 않음.
- 리스닝 공간: 기존과 동일(영상·질문·쉐도잉).
- 스피킹 공간 URL을 `/learn/items/{id}`로 열면 `/learn/{id}`로, 리스닝 공간을 `/learn/{id}`로 열면 `/learn/items/{id}`로 이동.
- 뒤로 가기 링크가 영역 탭으로 이동.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/learning-room.tsx apps/web/src/components/learning-room-view.ts apps/web/src/components/speech-panel.tsx apps/web/src/components/legacy-speech-records.tsx tests/learning-room-view.test.mjs
git commit -m "feat(web): show only area features in learning rooms"
```

---

### Task 7: 통합 테스트, 문서, 최종 검증

**Files:**
- Modify: `tests/learning-integration.test.mjs:34-37,81-83`, `tests/speech-integration.test.mjs:24`
- Modify: `docs/LEARNING_ROOM.md`, `docs/YOUTUBE_SETUP.md`, `docs/ARCHITECTURE.md`, `docs/superpowers/specs/2026-09-14-learning-areas-design.md`

- [ ] **Step 1: 통합 테스트에 종류 반영**

`tests/speech-integration.test.mjs` 24행 CREATE 객체에 `kind:'SPEAKING'`을 추가한다.

`tests/learning-integration.test.mjs`:
- 34행 `cmd('CREATE',{workspaceId,title:'Temporary LR1',prompt:'Write about today.'})`에 `kind:'WRITING'`을 추가한다.
- 37행 다음에 추가:

```js
    const writingList=await (await api(alice,'/api/learning/workspaces?kind=WRITING')).json();
    assert.ok(writingList.workspaces.some(w=>w.id===workspaceId&&w.kind==='WRITING'),'writing tab lists writing workspace');
    assert.equal((await (await api(alice,'/api/learning/workspaces?kind=SPEAKING')).json()).workspaces.some(w=>w.id===workspaceId),false,'speaking tab excludes writing workspace');
    const speakingId=randomUUID();
    await command(alice,cmd('CREATE',{workspaceId:speakingId,title:'Temporary speaking',prompt:'',kind:'SPEAKING'}),201);
    await command(alice,cmd('SAVE_DRAFT',{workspaceId:speakingId,expectedVersion:0,draft:'Not here.'}),409);
```

- 83행(`imported.results[0].workspace` 사용 줄) 다음에 `assert.equal(imported.results[0].workspace.kind,'LISTENING');`를 추가한다.

- [ ] **Step 2: 통합 테스트 실행**

Run: `pnpm build` 후 `pnpm test:learning:integration`, `pnpm test:speech:integration`
Expected: PASS. 실제 Worker가 켜져 있으면 테스트 문장이 AI로 전달될 수 있으므로 비용 없이 돌리려면 Worker를 멈춘다(`docs/LEARNING_ROOM.md` 실행 및 검사).

- [ ] **Step 3: 문서 갱신**

- `docs/LEARNING_ROOM.md`:
  - 사용 방법 1–2단계를 탭 기준으로 바꾼다: `/learn`은 마지막 탭으로 이동, **리스닝**에서 영상 링크 저장·YouTube 가져오기, **스피킹**에서 새 스피킹 시작, **라이팅**에서 새 글 쓰기.
  - "스피킹·쉐도잉" 첫 문장을 "학습실 **스피킹** 탭의 **새 스피킹 시작** 또는 리스닝 공간의 **짧은 구간 쉐도잉**에서 시작한다."로 바꾼다.
  - "YouTube 계정 연결" 문단에 "연결 관리는 **설정**(헤더 톱니 아이콘)에서 하고, 리스닝 탭에서는 **YouTube에서 가져오기**로 영상을 고른다."를 추가한다.
  - 새 절 `## 영역` 추가: 영역 3개와 공간 화면 표(spec 3.2), 기존 공간 분류 규칙(spec 4.2), 라이팅 공간의 이전 말하기 기록 설명.
  - 실행 및 검사에 `20261001000000` migration 적용을 추가한다.
- `docs/YOUTUBE_SETUP.md`: `/learn?youtube=` 표기를 `/settings?youtube=`로 바꾸고, 확인 절차의 시작 위치를 설정 페이지로 바꾼다.
- `docs/ARCHITECTURE.md` "현재 런타임 구성" 절 끝에 한 문단 추가: "학습실 공간은 `kind`(LISTENING·SPEAKING·WRITING)를 갖는다. 공개 명령 RPC가 영역별 허용 명령을 검사하고(`LEARNING_KIND`), 새 공간의 종류는 트랜잭션 설정 `paceon.workspace_kind`를 insert 트리거가 채운다."
- spec: 이 계획의 "Spec 보완" 1–4를 해당 절(5.3, 3.2, 3.2, 3.2)에 반영한다.

- [ ] **Step 4: 전체 검증**

Run:
```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
supabase test db
pnpm db:types:check
```
Expected: 모두 PASS.

- [ ] **Step 5: 브라우저 최종 확인 (390px, 데스크톱)**

- 탭 전환과 `/learn` 마지막 탭 이동
- 스피킹: 새 공간 → 문장 생성·녹음·분석 흐름
- 라이팅: 새 공간 → 초안 저장·AI 보내기·정리
- 리스닝: 링크 저장 → 영상 공간 → 쉐도잉·질문
- 기존 섞인 공간: 이전 말하기 기록 재생·보관·삭제
- 설정: 연결 상태 표시, (Google 프로젝트가 있으면) 연결 → `/settings?youtube=connected` 메시지 → 리스닝 탭 가져오기

- [ ] **Step 6: Commit**

```bash
git add tests/learning-integration.test.mjs tests/speech-integration.test.mjs docs/LEARNING_ROOM.md docs/YOUTUBE_SETUP.md docs/ARCHITECTURE.md docs/superpowers/specs/2026-09-14-learning-areas-design.md
git commit -m "test,docs: cover learning areas end to end and update guides"
```
