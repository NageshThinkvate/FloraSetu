# Implementation Status — Build 0 + Build 1 + Build 2

Updated: 2026-06 (Build 2 — Catalog & Standards)

## Build 2 implemented
- Canonical product model: categories (stable codes, optional hierarchy), commodities (botanical/common/commercial names, seasonality, launch flags, substitution defaults, validation status), varieties (colour, form, stem-length range, commercial use), product_aliases (canonical, case-insensitive unique), product_media metadata.
- Pre-Build-3 gate: OD-07 (explicit commercial uom_id foundation + preferred_order_uom_id + normalize-preview preserving originals + conversion version) and OD-08 (validation_status lifecycle DEMO→PENDING_REVIEW→VALIDATED/REJECTED with review metadata, separate-reviewer enforcement, catalog.validate + CATALOG_VALIDATOR, production-use check ACTIVE+VALIDATED) implemented and tested; migration 008 table count corrected to **11** (reporting typo in Build 2 report).
- Versioned masters (auto version_no, DRAFT→ACTIVE→RETIRED, effective windows, overlap rejection): grade_profiles (declarative JSONB rules vs quality_attributes dictionary), pack_definitions (nestable), unit_conversions (product/pack-scoped; cycle + same-unit + unknown-UoM + non-positive rejection), handling_profiles (temp/humidity/light/ethylene/hydration/holding/precool/packaging/transport).
- Defect taxonomy master (11 classes seeded). Transport compatibility metadata (no blocking). Supplier product capabilities (org-scoped, supplier-side only).
- Postgres FTS + alias search returning canonical products only.
- Permissions: catalog.read / catalog.write / catalog.capability.write + CATALOG_MANAGER system role.
- DTO validation: class-validator DTOs on all Build 2 writes + global ValidationPipe (whitelist, forbidNonWhitelisted) — closes the Build 1 shared-infra debt for touched paths.
- UI: /catalog (search + canonical detail with DEMO badges), /catalog/admin (all masters + version history + launch flags), /catalog/capabilities (supplier).
- Seed: Phase-1 basket (Dendrobium, Anthurium, Gerbera, Premium/Dutch Rose, Lilium, Carnation, Chrysanthemum/Disbud, Gypsophila, Solidago, Limonium/Statice, Eucalyptus, Lisianthus/Eustoma alias pair) — all DEMO; units VALIDATED.
- Docs: API_INVENTORY.md, SCREEN_INVENTORY.md, MASTER_SPEC_REFERENCE.md created; RTM/TEST_TRACEABILITY/OPEN_DECISIONS (OD-07, OD-08) updated; ADR-007 recorded.
- Tests: build2-catalog.e2e-spec.ts (20 gate tests, mandates 1–23) + full regression — 18 suites / 76 tests green; migrations up/down (8) green.

## Build 1 implemented (recap)
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

## Build 3 — Demand / Events / RFQ / Quotations / Evaluation / Award (PASS)
- Canonical demand model live: events/ceremonies/BOM, versioned requirements, RFQs + invitations,
  clarifications, immutable versioned quotations with normalization metadata, awards with quantity
  invariants + deviation consent, ops procurement desk. Migrations 010–011 (reversible).
- Guardrails: server-side master eligibility (ACTIVE+VALIDATED+window, fail-closed DEMO with
  non-prod env escape), explicit UoM, quote immutability, idempotent writes, race-safe
  publish/quote/award, tenant-scoped visibility (cross-org 404).
- Cross-context DI via @Global contract modules (boundary rule enforced mechanically).
- Frontend: Quick Request (mobile-first), requirement workspace, events, RFQ comparison + award,
  supplier inbox + quote builder, ops desk.
- Tests: 20 suites / 146 tests green (build3-demand gate: 48 tests, groups A–I).
- Docs added: docs/STATE_MACHINES.md, docs/SECURITY_MODEL.md.

## Build 4 follow-up — architecture gate remediation (RESOLVED BY APPROVED ADR-010)
- `no-cross-table` regression: scan regex false-flagged contract property access
  (`this.supply.getLotSnapshot()`); regex tightened with a lookbehind so only raw
  `schema.table` SQL literals are caught. One genuine violation (custody.service.ts raw
  `supply.supply_lots` read) rerouted through the SupplyInventory contract. PASS.
- `no-cycles` regression: two contracts-level 2-cycles in Build 4 modules
  (order-allocation↔supply-inventory, order-allocation↔logistics-coldchain) confirmed as
  legitimate synchronous commercial guards → **RESOLVED BY APPROVED ADR-010** (explicit
  allowlist, contracts-only evidence check, all other cycles still FAIL). PASS.
- Full gate after remediation: architecture + unit + e2e suites, typecheck, lint, build — all green.

## UI/UX Redesign Phase 5 — Independent Logistics Partner Execution (ADR-012) — PASS 2026-09-16
- Migration 015 (additive, up/down verified): `logistics.execution_events` (append-only, seq-ordered, immutable trigger, one-time-milestone unique guard), `logistics.driver_assignments` history, shipments +vehicle_ref/+handling_note/+arrived_pickup_at/+arrived_delivery_at, pod_records +pod_ref/+signature_media_object_id, permissions `logistics.execute` + `logistics.assign_driver` (ORG_ADMIN only — platform roles deliberately excluded).
- ADR-012 enforced server-side: Ops/Admin cannot assign partner drivers (legacy `/shipments/:id/assign` rejects driverUserId → 403 DRIVER_ASSIGNMENT_PARTNER_ONLY) nor record execution milestones; partner managers (`logistics.execute`) or the assigned driver execute; drivers are job-scoped (list + detail 404-on-foreign).
- New partner endpoints: `jobs/dashboard`, `jobs/eligible-drivers`, `jobs/:id/assign-driver`, `/unassign-driver`, `/arrived-pickup`, `/arrived-delivery`; existing accept/pickup/transit/deliver/exception write execution events in-transaction with transition guards (accept → arrived pickup → pickup → transit → arrived delivery → deliver+POD).
- Identity contract additions (read-only; ADR-010 unchanged): `isActiveMember`, `listActiveMembers`, `getUserDisplayNames`.
- Web: PartnerHomePage (7 dashboard buckets; driver sees Today's jobs only), PartnerJobsPage (bucket + mode filters, human labels), PartnerJobDetailPage (pickup/delivery/transport cards, mode-conditional panels, assign panel, execution stepper, POD form with signature photo + reference, exceptions, event timeline), PartnerShell nav Home/Jobs/Delivered.
- Seed: `scripts/seed-phase5-logistics.sh` — 8 tagged scenarios (road-driver, road-no-driver, bus, rail, air, local pickup, exception, delivered-with-POD) on Nilgiri Fresh Logistics; personas seed gains demo.driver2.
- Gates: backend 24 suites / 256 tests green (new `phase5-logistics-partner` e2e = 17 tests L1–L17; zz-migrations count updated 14→15); typecheck, lint, web build green; testing agent iteration_18 frontend 100% PASS (1440 desktop + 390 mobile, all acceptance flows, zero terminology violations).
