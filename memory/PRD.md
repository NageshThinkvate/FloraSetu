# FloraSetu — Product/Architecture Requirements Document

## Original problem statement
Build 0 — Architecture Freeze (LOCKED): web-based B2B floriculture platform, mobile-first PWA, zero native code (Capacitor-ready, ADR-006). Implementation-grade architectural foundation only — no business functionality, no feature screens. Master Spec v2.0 is the single source of truth. Modular monolith, 12 strict bounded contexts, PostgreSQL + PostGIS authoritative store, Redis cache/locks/rate-limit, S3-compatible media via signed URLs, transactional outbox + queue (no Kafka). Cross-cutting: outbox, idempotency, optimistic concurrency, row locking, immutable audit, feature flags, effective-dated config, UTC, public ref IDs, webhook signature validation, trace-ID middleware, standard error envelope. ADR-001…006 resolved/owner-approved and baked into schema. Acceptance gate: build, typecheck, lint, migrations up/down, unit tests, tenant-isolation, audit-event, idempotency baselines — then STOP.

## User choices (Build 0 kickoff)
1. NestJS + TypeScript + PostgreSQL/PostGIS + Redis installed in-container (owner-approved deviation from env default FastAPI/MongoDB).
2. Monorepo: `/app/apps/api` + `/app/apps/web`; legacy template dirs untouched.
3. Docs-first deliverables as markdown under `/app/docs/` + root governance files.
4. Acceptance gate exactly as specified; no feature screens.

## User personas (future builds)
Org admin, buyer, supplier, QC agent, logistics ops, finance ops, support agent, read-only stakeholder. Build 0 models them as RBAC system roles only.

## Core requirements (static)
12 bounded contexts with enforced isolation; immutable historical/financial records; never-oversell inventory (ADR-001); cold-chain excursion HOLD gating with versioned handling profiles (ADR-002); post-settlement claims via adjustments/recoveries (ADR-003); payout/bank-change freeze + dual approval + irreversible submit (ADR-004); webhook dedupe + pre-transaction signature checks (ADR-005); mobile convertibility via bearer/OIDC + device abstractions (ADR-006).

## Implemented — 2026-06 (Build 0)
- Docs 01–11 (`/app/docs/`) + root governance: ARCHITECTURE_DECISIONS, OPEN_DECISIONS, DOMAIN_MODEL, REQUIREMENTS_TRACEABILITY_MATRIX, IMPLEMENTATION_STATUS, TEST_TRACEABILITY.
- Monorepo scaffold: NestJS API (:8001, `/api` prefix) + React/TS PWA shell (:3000) under supervisor (`florasetu-api`, `florasetu-web`).
- PostgreSQL 15 + PostGIS 3.3 + Redis 7 provisioned; 6 reversible migrations; 13 schemas, 68 tables incl. all later-phase tables (UI-inactive).
- Infra: error envelope, trace-ID middleware (AsyncLocalStorage), idempotency framework, immutable audit + security audit streams, transactional outbox + relay (SKIP LOCKED), feature flags, RBAC guard + org context, concurrency helpers, media stub signer, realtime/device interfaces, reference-ID generator, rate-limit config, health endpoint, dev-only baseline harness + seed.
- Tests: 4 architecture suites (boundary, no-cross-table, common-purity, no-cycles), 6 unit suites, 6 e2e suites — 15 suites / 35 tests, all green. Gate sequence all PASS.
- CI baseline workflow; infra bootstrap script (`scripts/bootstrap-infra.sh`); test credentials doc.

## Prioritized backlog (next builds)
- P0 (Build 1 candidates): OIDC provider selection + real auth (OD-02); payment provider selection (OD-01); S3 endpoint + real media signing (OD-03); supply-lot reservation/allocation service flows (ADR-001 runtime); webhook ingress with real provider signature configs (OD-05).
- P1: RFQ lifecycle services (multi-supplier award), order allocation flows, shipment + excursion detection workers, claims workflow, notification delivery (web push VAPID, OD-04).
- P2: auction engine (live), analytics snapshots pipeline, control-tower dashboards, Capacitor wrap, audit table partitioning, platform cron for sweepers.

## Next tasks
1. Owner review of Build 0 gate report → authorize Build 1 scope.
2. Resolve OD-01/OD-02/OD-03 (payment, OIDC, object storage providers).
3. Build 1: activate Identity & Party + Supply & Inventory service layers against the frozen schema.

## Status
BUILD 0 STATUS: PASS. Tests: 35 passed / 0 failed. Deviations: backend tooling (NestJS+Postgres+Redis vs env default) — owner-approved. Tech debt: audit/outbox partitioning, stub media signer, dev token verifier, BullMQ/Redis queue behind QueuePort. Open blockers: none. Ready for Build 1: YES (pending owner authorization + provider decisions).
