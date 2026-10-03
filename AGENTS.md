# Project Agent Guide

> Shared instructions for all coding agents (Codex, Claude Code, OpenCode, ...).
> Keep this file short. Common procedures live in the `project-doc-manager` skill, not here.

## Project

| Key | Value |
|---|---|
| Project Name | PaceOn |
| Project Key | paceon |
| Notion Project URL | https://app.notion.com/p/3eeed3a0f8a781a08608eeebc456a80f |
| Status | Development |
| Phase | <!-- optional: Concept / MVP / Alpha / Beta / Production / Maintenance --> |

One-line description: Adaptive learning scheduler — reading plans, English learning room, review, word book (pnpm monorepo: Next.js web, scheduler/books packages, FastAPI AI worker, Supabase).

## Commands

| Purpose | Command |
|---|---|
| Install | `pnpm install --frozen-lockfile` |
| Dev | `pnpm dev` |
| Test | `pnpm test` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Build | `pnpm build` |
| DB test (Supabase Local running) | `pnpm db:test` |
| DB types check | `pnpm db:types:check` |

Before commit run at least `pnpm typecheck`, `pnpm lint`, `pnpm test` (same as CI).
Integration tests (`pnpm test:*:integration`) need Supabase Local / AI Worker — run them when touching those areas.

## Documents

Read before coding: `README.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`.
Read when relevant: the rest of the table below.

| Document | Path | Status |
|---|---|---|
| PRD | `docs/PRD.md` | active |
| Architecture | `docs/ARCHITECTURE.md` | active |
| Design | `docs/DESIGN.md` | active |
| Database | `docs/DATABASE.md` | active |
| API | `docs/<FEATURE>.md` — the API section of the feature doc that owns the endpoint (no single API.md) | active |
| Roadmap | `README.md` — "구조와 다음 단계" section | active |
| Changelog | `docs/CHANGELOG.md` | active |
| Feature specs | `docs/<FEATURE>.md` (AI, BOOKS, SCHEDULER, LEARNING_ROOM, QUICK_RECORD, WORD_BOOK, ...) | active |

Feature specs are the source of truth for each domain's behavior and API contracts. Update the one that owns the change; do not create a new top-level `API.md` or `ROADMAP.md`.

## Documentation Workflow

After meaningful code changes, follow the **project-doc-manager** skill.

- If your agent loads skills automatically, use the `project-doc-manager` skill.
- Otherwise read it directly: `~/.agents/skills/project-doc-manager/SKILL.md`
  (or `~/.claude/skills/project-doc-manager/SKILL.md`).

Rules that always apply, even without the skill:

1. GitHub `docs/` is the source of truth for technical docs. Never copy doc content to Notion.
2. Update only the documents (and sections) affected by the change. Do not touch unrelated docs.
3. Typos, formatting and comment-only changes need no doc update and no Notion log.
4. Notion failures must never block the work. Queue them in `.doc-manager/notion-pending.md` and report "Notion 업데이트 미완료".

## Git

| Key | Value |
|---|---|
| Git autonomy | `commit` |
| Default branch | `main` (protected by workflow: merge via PR only) |
| Branch naming | `feat/…`, `fix/…`, `perf/…`, `docs/…` |
| Commit style | Conventional Commits (`feat:`, `fix:`, `perf:`, `docs:`, `refactor:`, `chore:`) |

Never commit directly to `main` — create a branch first. Push and open a PR only when the user asks.
Before commit: run checks above → review `git diff` → update affected docs in the same commit.
Never force-push, rewrite history, or commit secrets (`.env*`, `client_secret*.json`).

## Notion

After meaningful work (change level L1+):

- Update the project page (only fields that changed)
- Create one Development Log entry
- Create a Decision Log entry only for significant technical decisions (L3)

## Project-specific Rules

- Docs and UI text are Korean; keep English for code identifiers.
- DB changes: add a migration under `supabase/migrations/`, update `docs/DATABASE.md`, then run `pnpm db:types` (CI fails on `db:types:check` drift).
- New feature doc in `docs/`: also add it to the "개발 문서" link line at the end of README "구조와 다음 단계".
- Scheduler logic lives in `packages/scheduler` (pure, Vitest) — keep it free of app/DB imports.
- Do not modify `docs/superpowers/` or `docs/prompt.md` (historical planning artifacts) unless asked.
