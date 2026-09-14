# Quick learning record implementation plan

**Goal:** Record reading or review from any workspace screen without visiting book details.

**Approved design:** Global record button; mobile center navigation action opens a bottom sheet. One eligible book is selected automatically; otherwise today's books appear first. Ask for the last page, show the newly read page count, default date to today, and collapse date/time/memo/review into additional input. Save stays reachable with the keyboard open. Successful saves close the sheet and refresh visible progress/schedules. Keep resource creation in the header.

**Architecture:** Reuse ProgressForm and its existing idempotent/versioned API in compact mode. A workspace-scoped provider owns a native modal dialog, selection and save confirmation. Workspace hooks refresh through a local event after saving. Never send a scheduled page as an assumed actual result. Preserve ambiguous requests until retry or explicit reload; lock dismiss/selection while saving or the result is unknown.

**Tech Stack:** React, Next.js client components, native dialog, Tailwind, existing Supabase progress API.

- [x] Add tested eligibility/ordering helper in `apps/web/src/lib/quick-record.ts`; tests cover active/latest completed plans, paused/archived/unplanned exclusions, today's priority and no mutation.
- [x] Extend `progress-form.tsx` with compact fields, page delta, optional details, numeric input mode, sticky submit, and saving/ambiguous-state notification. Keep full detail form intact.
- [x] Add `quick-record.tsx` provider/dialog: focus restore, Escape, scroll lock, visual viewport sizing, selected-resource reset, loading/errors/empty state and success notice.
- [x] Wire `app-shell.tsx`, `session-card.tsx`, `today-view.tsx` and `workspace-data.tsx` so record opens in place and all existing workspace data refreshes after save. Statistics listens for the same update.
- [x] Run focused unit/API tests, typecheck, lint and build. Verify mobile and desktop in a separate browser with isolated test data; include save/reopen, review, error retry, zero/one/multiple books and keyboard/focus behavior where browser tooling allows. See `docs/QUICK_RECORD.md` for evidence and physical-keyboard limitations.

No database migration or changes to user records are required by installation. Live verification must create and clean up its own fixture user/books.
