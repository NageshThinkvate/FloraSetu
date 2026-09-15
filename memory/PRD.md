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

## Implemented — 2026-06 (Build 2, after Builds 0+1)
- Catalog & Standards: canonical product model (categories with stable codes + optional hierarchy; commodities with botanical/common/commercial names; canonical aliases — Lisianthus/Eustoma; varieties with colour/form/stem-length; seasonality; launch city flags; product media metadata).
- Versioned effective-dated masters with overlap rejection: grade profiles (declarative JSONB rules vs attribute dictionary), pack definitions (nestable), product-scoped unit conversions (circular-chain/invalid rejection), handling profiles (range-validated).
- Defect taxonomy (11 classes), transport compatibility metadata (no blocking), supplier product capabilities (org-scoped), Postgres FTS + alias search returning canonical products only.
- Permissions: catalog.read / catalog.write / catalog.capability.write + CATALOG_MANAGER role. class-validator DTOs + global ValidationPipe (closes Build 1 DTO debt on shared infra).
- UI: /catalog, /catalog/admin, /catalog/capabilities (mobile 360/390/412). Seed: Phase-1 basket, DEMO-classified; units VALIDATED.
- ADR-007 (master-data versioning + canonical identity), OD-07/OD-08 (documented ambiguities).
- Tests: 18 suites / 76 tests green (build2 gate: 20 tests covering mandates 1–23; mandate 24 = agent viewport checks, PASS at 360/390/412 after nav/table-wrap fixes, iteration_6 final).

## Implemented — 2026-06 (Pre-Build-3 control gate)
- OD-07 RESOLVED — OWNER APPROVED: explicit `uom_id` at transaction boundaries; `preferred_order_uom_id` (commodity/pack) is UI preselection only; `POST /catalog/commercial-line/validate` (400 UOM_REQUIRED) + `POST /catalog/normalize-preview` (preserves original qty/uom, records conversionVersionId, normalized via ACTIVE versioned conversion only, mutates nothing).
- OD-08 RESOLVED — OWNER APPROVED: `validation_status` lifecycle (DEMO→PENDING_REVIEW→VALIDATED/REJECTED) separate from `status`, review metadata columns, separate-reviewer enforcement (403 SELF_APPROVAL) on grade/handling/conversion masters, `catalog.validate` + CATALOG_VALIDATOR role, production-use check ACTIVE+VALIDATED (+effective window), env escape `CATALOG_ALLOW_DEMO_MASTERS`. data_classification renamed → validation_status (migration 009).
- Migration 008 table count corrected: **11** new tables (Build 2 report typo).
- Lisianthus/Eustoma verified: single canonical commodity `PRD-SEED-LISIANTHUS`, alias `Eustoma` (BOTANICAL), zero duplicates, zero transactional references.
- Git baseline: commit `689543e`, tag `florasetu-build2-accepted`, `.env*` gitignored (no secrets committed; no remote push — awaiting owner authorization).
- Tests: 19 suites / 84 tests green (new prebuild3-gate suite: F1–F7 + rejection flow).

## Status
BUILD 0: PASS. BUILD 1: PASS. BUILD 2: PASS. PRE-BUILD-3 CONTROL GATE: PASS. Deviations: NestJS+Postgres+Redis vs env default — owner-approved (Build 0). Tech debt: stub media signer, dev HMAC token format (pending OD-02), KMS for TOTP secrets, audit partitioning, /auth/login returns 201 (semantic 200 — cosmetic). Open blockers: none. NEXT BUILD STARTED: NO — waiting for owner acceptance.

## Implemented — 2026-06 (Build 3, after Pre-Build-3 gate)
- Canonical demand model: events/ceremonies/BOM (user-defined), versioned requirements (QUICK/EVENT/FORMAL modes converge — no parallel model), RFQs + invitations, clarifications (visibility rules), immutable versioned quotations with OD-07 explicit UOM + OD-08 normalization metadata, awards with quantity invariants + deviation consent, ops procurement desk (procurement.manage).
- Migrations 010–011 (reversible; down-migration purge of Build-3 RFQ rows). Permissions + PROCUREMENT_OPS role seeded. Suspended orgs lose Build 3 transactional permissions.
- Guardrail A verified fail-closed (DEMO masters rejected; CATALOG_ALLOW_DEMO_MASTERS hard startup error in production; dev-only escape enabled in .env.development). Guardrail B: server-side master eligibility on every requirement line.
- Concurrency: one open RFQ per requirement (unique partial index), one quote per supplier per RFQ (23505→409), FOR UPDATE lifecycle transitions, award race invariants, idempotency on submit/publish/quote/revise/award.
- Cross-context DI via @Global contract modules (catalog/identity/notifications) — architecture boundary suites pass.
- Award→order conversion is an inert interface (PENDING_BUILD_5) — Build 4/5 not authorized.
- Frontend: Quick Request (mobile-first), demand home, requirement workspace (submit/publish/evaluate/revise/consent/cancel), events + BOM→requirement, RFQ comparison + award (consent checkbox), supplier inbox + quote builder + clarifications, my quotes, ops desk. Permission-gated nav; stale-org login fix.
- Docs: docs/STATE_MACHINES.md, docs/SECURITY_MODEL.md created; RTM/DOMAIN_MODEL/API_INVENTORY/IMPLEMENTATION_STATUS updated.
- Tests: 20 suites / 146 tests green (new build3-demand gate: 48 tests, groups A–I). Testing agent iteration_8: 11/11 frontend E2E flows PASS (desktop + 360/390/412 mobile), no functional bugs.
- Git baseline: commit 6e1a8eb, tag florasetu-build3-accepted.

## Status
BUILD 0: PASS. BUILD 1: PASS. BUILD 2: PASS. PRE-BUILD-3 GATE: PASS. BUILD 3: PASS (backend 146/146 green, frontend 11/11 testing-agent verified). Home shell updated: Build 3 badge + live-screen links (/demand, /demand/quick, /demand/events, /demand/rfqs, /supply/inbox, /supply/quotes, /ops/desk, /catalog, /account) + sign-in CTA for logged-out users. NEXT: awaiting owner acceptance + Build 4 authorization (orders/lots/logistics remain NOT authorized).

## Prioritized backlog (next builds)
- P0 (Build 2 candidates): Catalog & Standards activation; Supply & Inventory service flows (ADR-001 runtime); OIDC provider selection (OD-02) to replace dev HMAC tokens; S3 endpoint + real media signing (OD-03); class-validator DTOs + ValidationPipe hardening; secondary per-IP rate-limit counter.
- P1: RFQ lifecycle (multi-supplier award), order allocation, payments provider (OD-01), shipments + excursion workers, claims, notification delivery (OD-04/05).
- P2: live auctions, analytics pipeline, Capacitor wrap, audit partitioning.

## Next tasks
1. Owner review of Build 1 acceptance report → authorize Build 2 scope.
2. Resolve OD-01/OD-02/OD-03 provider decisions.
3. Build 2: Catalog & Standards + Supply & Inventory against frozen schema.

## Status
BUILD 0: PASS. BUILD 1: PASS. BUILD 2: PASS. BUILD 3: PASS. BUILD 4 (Pilot Fulfilment Core): PASS — 2026-09-12. 7 bounded-context modules (orders/allocations, supply lots, QC/custody, logistics/cold-chain, payments/settlements, claims, control tower) + 11 React PWA screens; 74-test Build 4 gate incl. mandatory K1 end-to-end pilot simulation; full regression 196/196 across 11 suites; migrations reversible with pilot data; frontend verified (iterations 9–11). Hardened during Build 4: cross-org read isolation (procurement.manage-only ops), custody authz, media id==object_key contract, QC replay ordering, claims terminal-decision ledger, RBAC suspension coverage for Build 4 permissions, lifecycle-aware settlement immutability (ADR-003 + Build-1 invariant merged). Tech debt: stub media signer, dev HMAC token format (pending OIDC), TOTP secrets stored unencrypted (KMS pending), audit partitioning, /auth/login 201-vs-200 semantic nit. PILOT PRODUCTION BLOCKERS: OD-02 (production auth/TOTP) and OD-03 (durable media storage) — external pilot blocked on both; internal/dev pilot accepted. Docs: docs/PILOT_OPERATING_FLOW.md, docs/BUILD4_ACCEPTANCE.md, API_INVENTORY.md Build 4 section. Incident 2026-09-15 (RESOLVED): pod restart wiped PG/Redis (data outside /app) and legacy template programs grabbed :8001/:3000 breaking login — recovery runbook in test_credentials.md (bootstrap-infra.sh → yarn seed → yarn seed:catalog → seed-pilot-order.sh, now dynamic-ID); login re-verified by testing agent iteration_12 (owner+supplier, wrong-password UX, 100%).
