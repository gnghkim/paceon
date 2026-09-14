# LR2 YouTube learning implementation plan

**Goal:** Save YouTube links, study in the official player, resume position, record bounded viewing intervals, keep timestamped notes and supplied transcript context, and connect a YouTube account for explicit library selection.

**Architecture:** Extend LR1 workspaces rather than create another timer. A video is a one-to-one workspace extension. Server RPCs serialize position/activity and preserve RLS, idempotency and device leases. OAuth tokens stay encrypted in a private server-owned store; API data is queried on demand. Existing approved design: `docs/LEARNING_ROOM_SPEC.md` sections 4 and 15.

**Tech Stack:** Next App Router, Supabase/PostgreSQL, YouTube IFrame/Data APIs, existing Python Responses Worker.

User has authorized the next approved stage. Continue in this session with subagent-driven-development for bounded independent components; no additional design approval or commit is required. The separate feature branch preserves existing local environment. Credentials are absent: implement honest unconfigured states and setup instructions; real account consent requires the user's Google project.

## Stable shared contract

- `learning_videos`: workspace_id UUID PK (same page ID), user_id, video_id 11 chars unique per owner, start_seconds numeric, position_seconds numeric, duration_seconds nullable numeric, favorite bool, archived bool, transcript text <=100000, transcript_version int, context_start int, context_end int (selected transcript character slice <=12000), updated_at. Title is the workspace title and is user editable. No persistent Google metadata cache; link cards use user title and video ID.
- `learning_video_notes`: id UUID, workspace_id,user_id,position_seconds numeric,content <=4000,created_at. Notes are user authored and immutable initially.
- `learning_video_visits`: id UUID,workspace_id,user_id,session_id,from_seconds,to_seconds,rate,created_at. Store only plausible forward playback segments, never seek jumps; repeated segments remain separate. Viewing seconds remain session elapsed (wall clock), not media seconds. RLS owner reads, no direct user writes.
- Additional RPC `learning_video_command(p_command jsonb)` returns `{video,workspace}`, `{video}`, `{note}`, or `{video,session}` as appropriate. All commands carry UUID requestId, strict keys, same user advisory lock as LR1 and private idempotency ledger.
  - VIDEO_ADD: workspaceId,videoId,startSeconds,title -> {workspace,video,duplicate:boolean}. Existing owner video reused regardless new requested workspaceId.
  - VIDEO_EDIT: workspaceId,title,favorite,archived -> {workspace,video}.
  - VIDEO_SOURCE: workspaceId,expectedVersion,transcript,contextStart,contextEnd -> {video}. CAS, chosen slice 0<=start<=end<=length, <=12000 chars.
  - VIDEO_NOTE: workspaceId,noteId,positionSeconds,content -> {note}.
  - VIDEO_TICK: sessionId,deviceId,generation,positionSeconds,durationSeconds,playing:boolean,rate:number -> {video,session}. Reject wrong ownership/generation, stale sessions and unreasonable bounds; receipt time measures elapsed, no client durations trusted. Keep private per-session playback observation for position delta plausibility, store last position even on seek but no visit for discontinuity. Do not override MANUAL pause. Player playback signals supplement LR1 heartbeat; one timer for concurrent writing+watching.
- GET existing workspace snapshot adds `video:object|null`, `videoNotes:[]`, `videoVisits:[]` (paged along existing page; cap100 each). GET list adds `videos:[]` for returned workspace IDs. Archived video filtering handled UI; user can show archived.
- POST `/api/learning/videos` accepts `{requestId,items:[{url,title?}]}` max20. Per-item normalize then deterministic UUID child request/workspace from requestId+index; return `{results:[{index,workspace?,video?,duplicate?,error?}]}`. No arbitrary user URL fetch. Valid host/path/ID required. Metadata failure never blocks registration; optional on-demand provider lookup can be added independently.
- POST `/api/learning/videos/commands` accepts the above strict commands (VIDEO_ADD server generated only through import route).
- UI route `/learn/items/[id]` uses shared LearningRoom with a video panel; `/learn/[id]` also recognizes video extension. UI controller must expose session/start/transition/activity to player, stop media on manual pause/end/hidden/takeover, and let visible PLAYING extend activity. Pause/buffering must stop viewing credit; text activity can keep the same session active.
- Worker input optional `source:{type:'YOUTUBE',videoId:string,transcript:string,notes:[{positionSeconds:number,content:string}]}`. On video MESSAGE/SUMMARY snapshot selected transcript and recent notes server-side, enforce total context20000, fail explicitly if too large. Existing writing kind/output schema retained. Prompt explicitly answers video questions from supplied text, never claims to watch video or treats transcript as user writing for corrections.
- Subtitle TXT/SRT/VTT import <=1MiB and normalized<=100000chars, parse timestamps into user-visible text (never invent timestamps). Store normalized text; user chooses selected AI excerpt via character range in transcript UI. No automatic caption downloads.
- OAuth endpoints/components are owned by separate worker, document exact contract before UI connection. Required env GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,YOUTUBE_TOKEN_ENCRYPTION_KEY(base64 32 bytes),APP_URL, server Supabase service-role config. State+PKCE, user binding, fixed callback, encrypted private tokens, refresh/revoke, read-only scope, on-demand playlists/subscriptions/videos pages. No Premium or watch-history claims.

## Tasks

- [x] DB: additive migration + pgTAP; video ownership, duplicates, CAS, device stale events, seek/rate accounting, no double timer; source snapshot extension preserving LR1. Root applies migration/types after review.
- [x] OAuth: server client/store/routes, private migration, test provider fixtures, setup instructions; unavailable without configuration. No live credential output.
- [x] UI: link batch results, saved/favorite/archive cards, official player loading/cleanup/error handling, resume/A-B/rates, notes/transcripts, mobile and timer integration. Existing writing flow remains usable.
- [x] Root API/Worker: parser, subtitle normalization, strict boundaries, video snapshot reads, API tests, source-aware AI worker validation/instructions.
- [x] Verify: focused red/green tests, full Node/Python/DB checks, typecheck/lint/build, isolated browser user, real embed where available, OAuth fixture validation; document unverified external setup and clean test account. Do not claim OAuth live verified without credentials.

## Required cases

URL fixtures include watch/youtu.be/shorts/embed, timestamps, duplicate IDs, hostile hostname/credentials/ports, invalid playlist-only URLs, partial batch failure. Time fixtures include pause/buffer, seek,2x,repeat,hidden,olddevice,replay. OAuth fixtures include state mismatch/replay, denied consent, missing config, token refresh/revocation, sanitized errors and pagination. Existing LR1 integration remains part of regression.

## Delivery evidence

- Node/web + scheduler: 171 tests passed. Python Worker: 35 passed. PostgreSQL: 317 assertions passed. Lint, TypeScript/build, database types and LR1/LR2 Auth/API integration passed.
- Actual official YouTube embed: playback, restored position, 2x wall-time separation, about 4-second A?B repeated intervals, manual pause/end and hidden-tab final position verified with an isolated account. User-supplied text/notes reached real GPT; durable reply and Korean study summary verified. Temporary account removed.
- Added source-only whitespace rejection and video/workspace recency migrations after regression cases reproduced the issues.
- Google project absent by user confirmation: OAuth implementation/provider fixtures/private-store tests complete; actual consent/account data/Premium environment remain unverified until docs/YOUTUBE_SETUP.md setup. Link/player study works without OAuth.
- No commit or deployment requested/performed.
