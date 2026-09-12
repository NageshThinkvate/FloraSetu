# Implementation Status — Build 0

Updated: 2026-06 (Build 0 freeze run)

## Implemented
- Docs-first deliverables 01–11 in `/app/docs/` (repo tree, ERD, module boundaries, dependency rules, table inventory, status storage, idempotency, audit, authorization, async/outbox, test strategy).
- Governance root docs: ARCHITECTURE_DECISIONS (ADR-001…006 RESOLVED), OPEN_DECISIONS (5+1 resolved, 6 provider decisions open), DOMAIN_MODEL.
- Monorepo: `apps/api` (NestJS + TS) and `apps/web` (React + TS PWA scaffold via Vite).
- PostgreSQL 15 + PostGIS 3.3 + Redis installed and running in-container; DBs `florasetu` + `florasetu_test` with extensions.
- Full SQL migrations (node-pg-migrate): all Build 0 tables across 12 contexts + cross-cutting `core` schema, CHECK constraints, immutability triggers, public-ref counters, PostGIS columns. Up/down verified.
- Infra code: error envelope + global filter, trace-ID middleware (AsyncLocalStorage), idempotency framework, audit writer (immutable), outbox writer + relay worker (SKIP LOCKED), feature flags (effective-dated), RBAC guard + org context, optimistic concurrency + row-lock helpers, media signed-URL abstraction (stub signer), realtime + device interfaces.
- 12 bounded-context module scaffolds with contracts/internal split.
- Dev-only seed (NODE_ENV=development gated).
- Architecture (anti-coupling) tests: boundary, no-cross-table, common-purity, contracts-only, no-cycles.
- Baseline e2e: tenant isolation, audit event, idempotency, outbox transactionality, migrations up/down.
- Lint + typecheck configs; CI baseline workflow.
- Supervisor repointed: `apps/api` on :8001, `apps/web` on :3000 (legacy template dirs untouched).

## Deferred (by design — NOT in Build 0)
All business functionality and feature screens; live auctions; AI; native code; provider selections (OD-01…06); real media signing; live push delivery; audit table partitioning; platform cron scheduling.

## Tech debt recorded
- Audit/outbox tables not yet partitioned (operational task pre-launch).
- Media signer is a stub until OD-03.
- Dev JWT verifier until OD-02.
- Queue = BullMQ/Redis behind `QueuePort`; revisit only if throughput demands.

## Master deviations
- Backend tooling: NestJS + PostgreSQL + Redis (vs environment default FastAPI + MongoDB) — **owner-approved** (see ARCHITECTURE_DECISIONS.md).

## Open blockers
None for Build 0 acceptance.
