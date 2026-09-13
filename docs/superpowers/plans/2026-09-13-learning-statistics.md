# Phase 8 Learning Statistics Implementation Plan

**Goal:** Show reliable statistics from saved book/PDF learning records, with selectable periods and resource breakdowns.

**Architecture:** Read-only authenticated `/api/statistics` uses existing user-token REST/RLS helpers. A pure TypeScript aggregator excludes voided events before applying study-date ranges. `/statistics` offers 7/30/90-day periods and custom inclusive dates (maximum 366 days), summaries, daily activity and resource links. No new database tables, model requests, or scheduler writes.

**Decision:** Existing phased plan ends at Phase 6. Phase 7 added PDF; Statistics is a PRD P1 feature and needs no external setup. Alternatives are PDF unit editing (changes scheduling contracts) and Habit tracking (new domain). User requested continuing; optional scope preference asked while inspecting code. Retain Phase 7 commit and leave Phase 8 implementation uncommitted for review.

## Metric contract

- Defaults: last 30 study dates including today in saved learner timezone (Asia/Seoul fallback). Validate real ISO dates; maximum 366 inclusive days; end cannot exceed today.
- Inputs: owned BOOK/PAGE resources (including PDF_IMPORT), all their progress events, explicit from/to/today/timezone. Filter VOID targets globally, including VOID outside the selected period, then select valid LEARNING/REVIEW by original study_date. Registration baseline is not period learning. Do not reinterpret stored study dates across timezone changes.
- New pages = LEARNING completed_workload; review pages counted separately, including repeated review. Duration sums non-null recorded minutes of both kinds. Unknown duration remains unknown: return timedEvents and untimedEvents, never infer duration from plans. Explicit zero is recorded time but excluded from speed.
- Active days = distinct dates with valid LEARNING/REVIEW events. Total event count, new/review pages, recorded minutes returned for summary, each date (including zero days), and each resource with activity. Book titles escaped by React; no memo/text/provider secrets returned.
- Observed minutes/page = positive-duration LEARNING minutes divided by their pages, null without timed learning. Display as recorded-period pace, not scheduler prediction. No mastery score, plan adherence, historical completion dates or lifetime streaks are inferred.
- API authenticates first, returns no-store, rejects foreign resource IDs with 404, accepts optional resourceId UUID; validates query and uses bounded existing pagination (fail rather than silently truncate). Each resource's projectProgress validates complete history and provides active events; corrupt data returns safe 409.

Response `StatisticsData`: `{from,to,today,timezone,summary,days,resources}`. Metrics `{learningPages,reviewPages,recordedMinutes,events,timedEvents,untimedEvents,activeDays,minutesPerPage:number|null}`. Daily item adds `date`; resource adds `id,title,source`. Zero input produces full empty day series and zeros/null.

## Tasks

- [x] Root: tests/statistics.test.mjs red/green for empty days, baseline exclusion, reviews/time omission/zero time, VOID outside period, corrections moving dates, leap dates/range max/future dates, resource filtering; implement apps/web/src/lib/statistics.ts.
- [x] Root: tests/statistics-api.test.mjs red/green for auth/range/owner filtering/private response/no-store/error; implement apps/web/src/lib/statistics-api.ts and app/api/statistics/route.ts using existing authentication/rows/settings. Add scripts to package.json.
- [x] UI worker: apps/web/src/components/statistics-view.tsx, app/(workspace)/statistics/page.tsx and app-shell.tsx navigation. Auth-aware abortable fetching, query-keyed state (no stale user/period values), date form submit, 7/30/90 controls, empty/loading/error states, semantic daily table/accessible chart bars and resource breakdown; 390px layout.
- [x] Root: actual local Auth/Next integration confirms values and foreign-user isolation using temporary accounts and records, with cleanup; no admin modification. Browser verifies page, period controls, empty and recorded data, mobile and console errors.
- [x] Final review against metric contract; run pnpm test/typecheck/lint/build and document Phase 8 usage, results, limitations. Keep local PDF worker active and AI disabled. No dependency additions needed.
