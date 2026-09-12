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

## Implemented — 2026-06 (Build 1, after Build 0)
- Identity & Party foundation: 17 org categories (exporter/government feature-gated), branches/addresses/contacts, multi-org memberships, permission catalog + 6 system roles seeded in migration 007.
- Auth: email/password (bcrypt), HMAC bearer access tokens (15 min) + rotating refresh tokens (7 d), TOTP MFA (enroll/verify, enforced at login), email-scoped Redis login lockout (5 fails → 15 min), `trust proxy` enabled.
- AuthZ: per-request DB-resolved org context (`X-Org-Id`), least privilege, 404-on-foreign object-level authz, suspension revokes transactional privileges (reads retained), platform privileged roles, audited time-boxed support access, role-assignment escalation allowlist.
- KYB: document submission + review workflow + immutable verification history.
- Bank/payout (ADR-004): immutable account history, masked reads, supplier-side only, PENDING_REVERIFICATION + payout freeze + dual approval (distinct approvers), dual audit streams. Settlement immutability verified against platform admin.
- UI: /login, /register, /onboarding, /account (profile, MFA, orgs, members, KYB, bank), /admin (masked org list, KYB review, suspend/lift, bank approvals).
- Owner account: nagesh.kgpl@gmail.com (PLATFORM_ADMIN, dev-seeded from env).
- Tests: build1-identity.e2e (12 gate tests) + all Build 0 suites — 17 suites / 56 tests green; migrations up/down (7) green; testing-agent verified incl. 4 bug fixes (ref-counter seed collision, ingress lockout bypass, admin X-Org-Id persistence, silent 500 logging).

## Prioritized backlog (next builds)
- P0 (Build 2 candidates): Catalog & Standards activation; Supply & Inventory service flows (ADR-001 runtime); OIDC provider selection (OD-02) to replace dev HMAC tokens; S3 endpoint + real media signing (OD-03); class-validator DTOs + ValidationPipe hardening; secondary per-IP rate-limit counter.
- P1: RFQ lifecycle (multi-supplier award), order allocation, payments provider (OD-01), shipments + excursion workers, claims, notification delivery (OD-04/05).
- P2: live auctions, analytics pipeline, Capacitor wrap, audit partitioning.

## Next tasks
1. Owner review of Build 1 acceptance report → authorize Build 2 scope.
2. Resolve OD-01/OD-02/OD-03 provider decisions.
3. Build 2: Catalog & Standards + Supply & Inventory against frozen schema.

## Status
BUILD 0: PASS. BUILD 1: PASS (acceptance gates green, testing-agent verified). Deviations: NestJS+Postgres+Redis vs env default — owner-approved. Tech debt: stub media signer, dev HMAC token format (pending OIDC), TOTP secrets stored unencrypted (KMS pending), audit partitioning, DTO validation hardening. Open blockers: none.
