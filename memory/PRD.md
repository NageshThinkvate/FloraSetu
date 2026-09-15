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

## Implemented — 2026-06 (Build 3, after Pre-Build-3 gate)
- Canonical demand model: events/ceremonies/BOM (user-defined), versioned requirements (QUICK/EVENT/FORMAL modes converge — no parallel model), RFQs + invitations, clarifications (visibility rules), immutable versioned quotations with OD-07 explicit UOM + OD-08 normalization metadata, awards with quantity invariants + deviation consent, ops procurement desk (procurement.manage).
- Migrations 010–011 (reversible; down-migration purge of Build-3 RFQ rows). Permissions + PROCUREMENT_OPS role seeded. Suspended orgs lose Build 3 transactional permissions.
- Guardrail A verified fail-closed (DEMO masters rejected; CATALOG_ALLOW_DEMO_MASTERS hard startup error in production; dev-only escape enabled in .env.development). Guardrail B: server-side master eligibility on every requirement line.
- Concurrency: one open RFQ per requirement (unique partial index), one quote per supplier per RFQ (23505→409), FOR UPDATE lifecycle transitions, award race invariants, idempotency on submit/publish/quote/revise/award.
- Cross-context DI via @Global contract modules (catalog/identity/notifications) — architecture boundary suites pass.
- Frontend: Quick Request (mobile-first), demand home, requirement workspace, events + BOM→requirement, RFQ comparison + award, supplier inbox + quote builder + clarifications, my quotes, ops desk. Permission-gated nav; stale-org login fix.
- Docs: docs/STATE_MACHINES.md, docs/SECURITY_MODEL.md created; RTM/DOMAIN_MODEL/API_INVENTORY/IMPLEMENTATION_STATUS updated.
- Tests: 20 suites / 146 tests green (build3-demand gate: 48 tests, groups A–I). Testing agent iteration_8: 11/11 frontend E2E flows PASS (desktop + 360/390/412 mobile).
- Git baseline: commit 6e1a8eb, tag florasetu-build3-accepted.

## Implemented — 2026-09-12 (Build 4, Pilot Fulfilment Core)
- 7 bounded-context modules: orders/allocations, supply lots, QC/custody, logistics/cold-chain, payments/settlements, claims, control tower.
- 11 React PWA screens; 74-test Build 4 gate incl. mandatory K1 end-to-end pilot simulation; full regression 196/196 across 11 suites; migrations reversible with pilot data; frontend verified (iterations 9–11).
- Hardened during Build 4: cross-org read isolation (procurement.manage-only ops), custody authz, media id==object_key contract, QC replay ordering, claims terminal-decision ledger, RBAC suspension coverage, lifecycle-aware settlement immutability (ADR-003 + Build-1 invariant merged).
- Fixed tenant-isolation bug where suppliers could see the buyer's order slice.
- Docs: docs/PILOT_OPERATING_FLOW.md, docs/BUILD4_ACCEPTANCE.md, API_INVENTORY.md Build 4 section.
- Incident 2026-09-15 (RESOLVED): pod restart wiped PG/Redis (data outside /app) and legacy template programs grabbed :8001/:3000 breaking login — recovery runbook in test_credentials.md (bootstrap-infra.sh → yarn seed → yarn seed:catalog → seed-pilot-order.sh, now dynamic-ID); login re-verified by testing agent iteration_12 (owner+supplier, wrong-password UX, 100%).

## Implemented — 2026-09-15 (UI/UX Forensic Audit & Redesign Specification — DOCS ONLY, NO UI CODE)
- Complete code-level audit of the Builds 0–4 React frontend (all 28 routes, shells, tokens, KYB/bank flows) against Master Spec v2.0.
- Deliverables (all in `/app/docs/`): UI_UX_FORENSIC_AUDIT.md, UI_UX_INFORMATION_ARCHITECTURE.md, UI_UX_DESIGN_SYSTEM.md, UI_UX_USER_JOURNEYS.md, UI_UX_RESPONSIVE_RULES.md, UI_UX_COMPONENT_INVENTORY.md, UI_UX_SCREEN_REDESIGN_PLAN.md, UI_UX_ACCEPTANCE_CRITERIA.md + machine-readable `/app/design_guidelines.json` (tokens, status vocabulary, 13 screen wireframes).
- Key findings: no role shells (one 18-link nav for all), home = internal architecture page, KYB flow functionally broken (hardcoded fake doc + hardcoded reject reason), org identity invisible at work time, raw backend status codes + UUID inputs as UI vocabulary, off-direction dark dev-console theme, no buyer decision surfaces/notifications, ops mechanics exposed to buyers, non-camera-first supply intake, non-field QC workbench (JSON textarea), role-mixed demand surfaces, minimal state coverage (loading/empty/403), mobile nav overflow.
- Redesign spec: 5 role shells (/buyer, /supplier, /partner, /ops, /admin) with role router at `/`; organization-first header + WorkspaceSwitcher; warm ivory light theme (#F8F8F5) + deep botanical green (#183D33) + Inter; StatusPill human labels; SearchableSelect kills UUID inputs; camera-first lot intake; full-screen QC field tool; exception-first ops board with SideSheet actions; KYB 5-step wizard + reviewer split view; responsive matrix 360→1920 with DataTable→MobileDataCard below 768px; WCAG 2.2 AA floor.
- Backend deltas identified (additive only, no behavior change): B1 structured KYB endpoints, B2 notifications feed, B3 supplier display name + verified flag in comparison payload. Zero modifications to accepted endpoint behavior; business logic/state machines/authorization/audit untouched.
- 8-phase build sequence defined (tokens/components → shells → buyer → supplier → partner QC → ops → admin → responsive/AA hardening). Acceptance criteria testable per phase with standard test accounts.
- OWNER DECISION (2026-09): audit summary delivered; WAITING for explicit owner approval before ANY React redesign coding. Build order on approval: follow REDESIGN_PLAN §7 doc order (phases 1–8).

## Status
BUILD 0: PASS. BUILD 1: PASS. BUILD 2: PASS. PRE-BUILD-3 GATE: PASS. BUILD 3: PASS. BUILD 4 (Pilot Fulfilment Core): PASS — 2026-09-12 (196/196 e2e green). UI/UX FORENSIC AUDIT: COMPLETE — 2026-09-15 (docs only, no code). UI/UX REDESIGN PHASE 2: IMPLEMENTED — 2026-09-15 on branch `uiux/pilot-redesign` (commit 04f0c9e): root workspace router (cases A/B/C, never stale context) replacing the architecture page at `/`; five lazy shells (/buyer, /supplier, /partner, /ops, /admin) with WorkspaceGuard (styled permission-denied, deep-link adopt), WorkspaceSwitcher (org→workspace hierarchy, dirty-form confirmation, toast), NotificationBell (B2 feed, drawer/sheet), role-filtered ops nav (UX-ADR-002 upheld — admin-only sees no ops), legacy redirect map, draft isolation (org+workspace keys) + unsaved-changes guard on Quick Request, placeholder homes, legacy pages remapped to light theme as adapters. Backend (additive): migration 013 (org capabilities with category-derived overridable defaults + notifications.read_at), /auth/me capabilities, org-creation capability defaults, B2 GET /notifications + POST /:id/read, 3 new best-effort producers (order.allocated→supplier, shipment.delivered→buyer, inspection.completed→supplier), dev-only persona seed A–I (yarn seed:phase2). Gates: backend 22 suites/224 tests green (incl. 4 new Phase 2 tests), web build/lint green, main bundle ~95KB gzip + per-shell lazy chunks. Testing agent iteration_13: 28/28 scenarios PASS (100%). AWAITING OWNER VISUAL ACCEPTANCE before Phase 3. UI/UX REDESIGN PHASE 1: IMPLEMENTED — 2026-09-15 on branch `uiux/pilot-redesign` (committed, not pushed): owner rulings UX-ADR-001…008 incorporated into derived docs + new docs/UI_UX_OWNER_RULINGS.md; design tokens (`src/design/tokens.css`, `components.css`, Inter via @fontsource-variable/inter, lucide-react); 19 foundational components in `apps/web/src/components/` (StatusPill, TaskCard, PrimaryActionCard, MetricCard, PageHeader, OrganizationHeader, EmptyState, SkeletonLoader, InlineAlert, ExceptionBanner, ConfirmationDialog, ResponsiveFormSection, SearchableSelect, DataTable+MobileDataCard auto-switch <768px, SideSheet, Drawer, StickyMobileActionBar) + `src/shell/ShellFrame.tsx` primitives (not wired to routes); status vocabulary map `src/design/status.ts`; dev-only `/dev/design-system` preview route (import.meta.env.DEV-gated, absent from production builds); zero business-page/backend changes; web build+typecheck+lint green; backend regression 196/196 e2e green; screenshots verified at 390/768/1440. AWAITING OWNER VISUAL ACCEPTANCE before Phase 2. Tech debt: stub media signer, dev HMAC token format (pending OD-02 OIDC), KMS for TOTP secrets, audit partitioning, /auth/login 201-vs-200 semantic nit. PILOT PRODUCTION BLOCKERS: OD-02 (production auth/TOTP) and OD-03 (durable media storage) — external pilot blocked on both; internal/dev pilot accepted. NEXT: owner approval of UI/UX redesign spec → authorize redesign coding phases 1–8.

## Prioritized backlog
- P0: UI/UX redesign Phases 2–8 (Phase 1 committed on `uiux/pilot-redesign`, awaiting owner visual acceptance). Phase 2 = role/workspace router + 5 shells + WorkspaceSwitcher + notification placeholder; then buyer, supplier, partner QC, ops, admin, responsive/AA hardening; backend deltas B1/B2/B3 only in their phases (UX-ADR-007).
- P0 (Build 4 architecture regression — RESOLVED 2026-09): `no-cross-table` fixed correctly (regex lookbehind distinguishes raw `schema.table` SQL from allowed contract property access; custody.service.ts rerouted via SupplyInventory contract). `no-cycles` RESOLVED BY OWNER-APPROVED **ADR-010**: two authorized synchronous contract pairs (order-allocation↔supply-inventory for reservation/ownership invariants; order-allocation↔logistics-coldchain for the ADR-002 `hasBlockingException` acceptance guard) — explicit test allowlist with contracts-only evidence check; all other cycles still FAIL. Also fixed pre-existing float-literal lint violation (celsius 6.5→7) in build4 e2e spec. FULL GATE GREEN: 21 suites / 220 tests (architecture+unit+e2e), typecheck, lint, build. Phase 2 unblocked pending owner go.
- P1: OIDC provider selection (OD-02) to replace dev HMAC tokens; S3 endpoint + real media signing (OD-03); payments provider (OD-01); notification delivery (OD-04/05); partner hub/logistics shells (phase 2, needs B4 trip-assignment endpoint).
- P2: live auctions, analytics pipeline, Capacitor wrap, audit partitioning, dark mode for night-hub logistics.

## Next tasks
1. OWNER VISUAL REVIEW of Phase 1 at `/dev/design-system` (dev-only; screenshots at 390/768/1440 captured 2026-09-15) → accept or request changes.
2. On acceptance + authorization: Phase 2 — role/workspace router (UX-ADR-001/002) + five shell architecture + org context + WorkspaceSwitcher + notification bell placeholder; backend deltas B1–B3 only when their phase lands (UX-ADR-007).
3. Keep full backend gate green; validate per phase against UI_UX_ACCEPTANCE_CRITERIA.md.
