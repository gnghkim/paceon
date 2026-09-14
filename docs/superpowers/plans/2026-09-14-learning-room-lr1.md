# LR1 learning room implementation plan

**Goal:** An authenticated writing room with drafts, resume, measured sessions, pause/end controls, durable GPT feedback and study notes.

**Approved specification:** `docs/LEARNING_ROOM_SPEC.md`. This implementation starts LR1; YouTube/account connection, audio and spaced review remain LR2–LR5. No deployment or commit is requested.

**Architecture:** Next.js UI/API use user-scoped Supabase RPCs. A new durable learning queue is consumed by the existing private-key Worker. Database RPCs own concurrency, draft CAS, per-user single active device lease, idempotency and persisted user messages. Client sends activity signals rather than trusted total seconds. Existing book progress remains separate.

**Delivery choice:** LR1 uses durable queued AI replies with status polling, not token streaming. Original messages and complete validated responses survive navigation and worker restarts. Streaming and response cancellation need a later transport increment and are explicitly not claimed in LR1.

## Stable integration contract

New public tables: `learning_workspaces`, `learning_sessions`, `learning_messages`, `learning_ai_jobs`; private command/event ledgers may be added. All have owner-scoped reads and RPC-only writes.

Workspace fields: id, user_id, title, prompt, draft, draft_version, created_at, updated_at.
Session fields: id, user_id, workspace_id, status ACTIVE/PAUSED/ENDED, pause_reason MANUAL/IDLE/HIDDEN/EXPIRED or null, device_id UUID, generation integer, lease_expires_at, last_seen_at, last_activity_at, elapsed_seconds integer, timezone, started_at, ended_at, updated_at.
Message fields: id, user_id, workspace_id, session_id nullable, role USER/ASSISTANT, content, created_at, job_id nullable.
Job fields: id, user_id, workspace_id, session_id nullable, kind WRITING_REPLY/STUDY_SUMMARY, status QUEUED/RUNNING/SUCCEEDED/FAILED, input JSON, output JSON nullable, error_code nullable, created_at, updated_at; model/provider usage/lease internal only.

One authenticated RPC `learning_command(p_command jsonb)` returns JSON. Every mutation has requestId UUID. Actions:
- CREATE: workspaceId UUID, title (1–120), prompt (0–1000). Returns workspace.
- SAVE_DRAFT: workspaceId, expectedVersion integer, draft (0–8000). Returns workspace; CAS conflict is 409.
- START / TAKEOVER: workspaceId, deviceId, timezone. Returns session. START reuses same owned device's recent paused/active session; other active-device conflicts. TAKEOVER explicitly moves ownership and increments generation. End inactive sessions after 30 minutes.
- HEARTBEAT / PAUSE / END: sessionId, deviceId, generation, activity boolean. PAUSE also reason MANUAL/IDLE/HIDDEN. Returns session. 15s heartbeat; server elapsed bounded by its own timestamps and 60s activity/lease expiry; pause and end include final eligible interval. Manual pause never auto-resumes via heartbeat.
- MESSAGE: workspaceId, sessionId, content (1–8000), deviceId, generation. Returns {message,job}. Persist user text first with idempotency and one inflight reply per workspace. User explicitly clicks AI send; no silent automatic summary default.
- SUMMARY: workspaceId, sessionId. Returns job using existing session messages; no source content is a 400.
- RETRY: jobId. Returns queued job for failed owned job without duplicating user message.

RPC errors use SQLSTATE P0001 with safe constant text: LEARNING_NOT_FOUND, LEARNING_CONFLICT, LEARNING_INVALID, LEARNING_LIMIT. Auth required and no raw SQL error exposure.

Worker RPCs service_role only: `claim_learning_job()` returns job/null, `finish_learning_job(p_job_id uuid,p_lease_token uuid,p_output jsonb,p_error_code text,p_model text,p_provider_response_id text,p_input_tokens integer,p_output_tokens integer)`; lease safety, three attempts and persisted assistant message for successful replies.

Job input: {kind, messages:[{id,role,content}], prompt:string}. Max 20,000 total input characters. Output: {summary:string, corrections:[{original:string,revised:string,reason:string}], expressions:[{phrase:string,meaning:string,example:string}], nextPrompt:string}. Summary is Korean guidance, corrected text/examples in English. Corrections max3; expressions max10. No invented user proficiency, original messages untouched.

Web endpoints: GET/POST /api/learning/workspaces (list/create), GET/PATCH /api/learning/workspaces/[id] (owned snapshot/draft), POST /api/learning/commands (validated actions). Snapshot {workspace,sessions,messages,jobs,aiEnabled,page,hasMore:{sessions,messages,jobs}} with ?page=N; list {workspaces,sessions,aiEnabled,nextOffset} with ?offset=N. Public jobs omit input and leases/provider usage.

## Work items and checks

- [x] Database: migration + pgTAP for owner isolation, draft CAS, duplicate commands, lease races, pause/resume, job idempotency and worker ownership.
- [x] Worker: strict learning input/output validation, new queue consumer using existing Settings and transport; Python fixtures test valid/invalid output and completion payloads.
- [x] API: strict command schemas, authentication, bounded reads, sanitized errors, AI feature switch; meaningful API/unit tests.
- [x] UI: /learn list, /learn/[id] writing room, mobile navigation, timer controls, draft autosave/recovery, heartbeat lifecycle, feedback/notes polling and errors. No fabricated content when disabled.
- [x] Integration: apply additive migration, regenerate types, focused tests + full checks, worker rebuild, isolated user browser verification and cleanup. Record limitations honestly.

Implementation uses current repository context and feature branch so the existing local servers/env continue working. No user data resets; credentials remain ignored and never printed.

## Verification and delivery

See `docs/LEARNING_ROOM.md` for commands, observed browser/live-provider checks and explicit remaining scope. Added a second timing migration to preserve fractional seconds and refresh worker leases after lock acquisition. No commit or deployment performed.
