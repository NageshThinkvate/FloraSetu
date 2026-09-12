# Implementation Status — Build 0 + Build 1

Updated: 2026-06 (Build 1 — Identity & Party)

## Build 1 implemented
- Full org category vocabulary (17 active categories; EXPORTER/GOVERNMENT feature-gated via `org.exporter_government`).
- Entities: Organization (KYB status), Branch, Address (PostGIS-ready), Contact, User + credentials (bcrypt), Membership (multi-org), Role/Permission/RolePermission (system roles seeded in migration 007), Documents, verification history (immutable), org restrictions/suspension, bank accounts (immutable history) + dual-approval change requests, support access grants (immutable, time-boxed).
- Auth: email/password register+login, HMAC bearer access tokens (15 min, exp-checked) + rotating refresh tokens (7d), TOTP MFA enroll/verify (otplib) enforced at login, Redis login lockout (5 failures → 15 min, 429 RATE_LIMITED).
- AuthZ: per-request org context resolution from DB (X-Org-Id), least-privilege permissions, object-level 404-on-foreign policies, transactional-permission revocation on suspension, platform privileged roles (PLATFORM_ADMIN/FINANCE_OPS MFA-required flags), audited support access, privilege-escalation allowlist for role assignment.
- UI (apps/web): Login, Register, Onboarding (org creation, gated categories disabled), Account (profile, MFA, orgs, members/invite, KYB submit, bank profile), Admin (org list masked, KYB review, suspend/lift, bank change approvals).
- Owner account seeded (dev): nagesh.kgpl@gmail.com (PLATFORM_ADMIN on FloraSetu Platform org), credentials from env.
- Tests: build1-identity.e2e-spec.ts — 12 gate tests covering every required scenario incl. tenant isolation, IDOR, supplier-only action, cross-supplier data, payout immutability, suspension, bank dual approval+audit, privilege escalation, rate limiting. 17 suites / 56 tests all green; migrations up/down (7) green.

## Build 0 implemented (recap)
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
