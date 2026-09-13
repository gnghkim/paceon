# Phase 3 — Book Resource

Scope: manual registration, Google Books search, shared provider contract, and an explicit unsupported YES24 adapter. Resource screens and sign-in screens belong to Phase 4.

1. Add a framework-independent books package. Validate manual/corrected metadata, ISBN checksums, total/current pages, and normalize provider output.
2. Implement Google Books with bounded search, timeout and recoverable failure results. Manual entry must work without external search. Do not infer missing page counts.
3. Add authenticated book registration/list APIs. Verify bearer tokens with Supabase Auth, derive ownership on the server, and use the same user token for RLS-protected REST writes.
4. Test providers and validation without the network; test actual Auth → API → DB ownership and manual fallback against Supabase Local. Run workspace tests, typecheck, lint and build.
5. Document API contracts, configuration, and remaining Phase 4 work.

No schema migration is required: existing resources store source/source_id, bibliographic fields, total_pages and initial_completed_workload. Planning uses the Phase 2 scheduler with these page values; persisting plans is outside this phase.
