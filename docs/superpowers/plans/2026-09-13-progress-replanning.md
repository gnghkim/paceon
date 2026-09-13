# Phase 5 — Progress / Replanning

Goal: record actual reading, show effective progress, and recompute mutable future sessions atomically while retaining history, pinned sessions and shared time limits.

- [x] Pure domain: validate new reading/review/latest-reading correction/replan requests; project continuous pages excluding VOID; estimate speed from valid samples; invoke replanBook and return a candidate.
- [x] Persistence: progress revision + pending-replan flag on resources; persisted fallback speed on plans; submission ledger for exact retries; RLS transaction RPC validates state and applies events/history/future sessions together. Schedule conflicts preserve the actual record and mark replan pending.
- [x] API/read model: authenticated user-token flow, early idempotent replay, real progress/history, manual retry after conflicts; enforce day/timezone/owner/version and bounded reads.
- [x] UI: record from Today/detail, remaining-page input, duration/date/memo, separate review, last-reading correction, before/after forecast, pending-replan explanation and retry settings. No deletion of history.
- [x] Verification: pure regressions; real Auth/RPC ownership/retry/CAS/duplicate ranges/correction/shared budget/history preservation; browser under/over target recording/reload; complete workspace checks and docs.

## Shared implementation contract

New resource fields: `progress_version bigint default 0`, `replan_required boolean default false`. New plan field: `minutes_per_page numeric default 1` (initial input persists here; observed speed is per-result and does not overwrite fallback).

`ProgressRequest`: `{kind:'LEARNING'|'REVIEW'|'CORRECTION'|'REPLAN', idempotencyKey:uuid, planId:uuid, expectedPlanVersion:positive integer, expectedProgressVersion:nonnegative integer, studyDate?:YYYY-MM-DD, endPage?:integer, startPage?:integer, durationMinutes?:integer|null, memo?:string, eventId?:uuid, mode?:PACE|DEADLINE|BALANCED, dailyPages?:integer, targetDate?:YYYY-MM-DD|null}`. Learning uses current+1..endPage; REVIEW requires explicit range (no progress contribution); CORRECTION targets the latest active LEARNING, can replace its end/duration/date/memo or VOID it entirely with endPage=startPage-1. REPLAN accepts mode/dailyPages/targetDate overrides only. Only LEARNING/REVIEW/CORRECTION require studyDate, which cannot be future in plan timezone.

`ProgressCandidate`: `{completedThroughPage:number, minutesPerPage:number, speedSource:'observed'|'fallback', schedule:ScheduleResult, mode:PlanMode, dailyPages:number|null, targetDate:string|null}`. Sessions' stored estimatedMinutes use integer ceiling of page×speed with floating error correction. Forecast when fully complete is the server's asOfDate. Domain throws on non-contiguous/corrupt existing active learning ranges.

RPC `submit_book_progress(p_resource_id uuid, p_request jsonb, p_candidate jsonb, p_expected_sessions jsonb, p_expected_total integer, p_expected_initial numeric, p_as_of_date date)` returns summary JSON. `p_expected_sessions` is ALL target plan sessions sorted by id, mapped exactly to `{id,study_date,start_page,end_page,estimated_minutes,status,is_locked,plan_version}`. User advisory lock seed4 matches initial-plan RPC, then resource/plan locks. Ledger `progress_submissions(user_id,idempotency_key,resource_id,request,result,created_at)`, unique owner/key; immutable, RLS SELECT/INSERT, exact canonical request compare before revision validation. Server reads ledger first to allow replay after completed plans/corrections.

RPC independently validates active learning contiguity and request page changes under lock, candidate matches resulting completedThroughPage, own session snapshot, date/preservation/replacement set, remaining-page coverage (including fixed future ranges), forecast and current shared capacity. Only PLANNED/SKIPPED, unlocked sessions AFTER asOfDate may be replaced, and event-referenced sessions are preserved/guarded. Never delete past/today/completed/locked/in-progress sessions. Current/past session status may be updated from actual continuous progress, without changing their assigned ranges. Successful schedule increments plan version once and writes APPLIED replan_run. Conflict writes SKIPPED (same plan version unless completion status changes, which advances it once), retains schedule, marks resource pending; actual records still commit. Every new submission increments progress_version; exact replay does not.

Result: `{submissionId:string,eventId:string|null,runId:string,completedThroughPage:number,progressVersion:number,planVersion:number,replanStatus:'applied'|'pending',forecastBefore:string|null,forecastAfter:string|null,conflicts:Conflict[],reasons:ChangeReason[]}`.

API `POST /api/resources/books/[id]/progress` body ProgressRequest ->201 new/200 replay,400 invalid,404 foreign/missing,409 stale/key reuse. Workspace data adds `progress: Record<resourceId,{completedThroughPage:number,percent:number,latestLearningId:string|null}>`, `events:ProgressEvent[]`, `replans:ReplanRun[]`; existing resources/plans remain DB rows. Include COMPLETED plans for detail/history; show ACTIVE plans only in calendar. History and all candidate inputs use bounded pagination.

Existing uncommitted local-admin alias changes remain separate from Phase 5 implementation. No commit is requested in this turn.
