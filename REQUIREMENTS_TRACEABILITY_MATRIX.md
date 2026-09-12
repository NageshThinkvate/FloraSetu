# Requirements Traceability Matrix — Build 0

| Req ID | Requirement (Master Spec v2.0 / Build 0 statement) | Where implemented | Verification | Status |
|---|---|---|---|---|
| REQ-ARCH-01 | 12 strict bounded contexts; contracts-only cross-imports | apps/api/src/modules/* (12 modules, contracts/internal split) | test/architecture/boundary.spec.ts | PASS |
| REQ-ARCH-02 | No cross-boundary table reads | schema-per-context migrations 001–006; ownership map | test/architecture/no-cross-table.spec.ts | PASS |
| REQ-ARCH-03 | common/ domain-free | src/common/* | test/architecture/common-purity.spec.ts | PASS |
| REQ-ARCH-04 | No cyclic context dependencies | module graph | test/architecture/no-cycles.spec.ts | PASS |
| REQ-DB-01 | Full ERD + migrations, up/down reversible | apps/api/migrations/001–006 (68 tables, 13 schemas) | test/e2e/zz-migrations.e2e-spec.ts | PASS |
| REQ-DB-02 | Money as integer minor units; UTC TIMESTAMPTZ | all `*_minor BIGINT`; all timestamps TIMESTAMPTZ | migration review + lint (float-literal rule) | PASS |
| REQ-DB-03 | PostGIS for terminals/routes/addresses | supply.terminals, logistics.routes (GEOGRAPHY) | migration 003/005 applied on PostGIS 3.3 | PASS |
| REQ-DB-04 | Public human-readable refs vs internal UUIDs | core.reference_counters + `ref` UNIQUE columns | test/unit/reference-id.spec.ts | PASS |
| REQ-DB-05 | Immutable historical records (money/auction/KYC/custody/quality/excursions) | core.prevent_mutation() triggers on 11 tables | test/e2e/audit-event.e2e-spec.ts (immutability case) | PASS |
| REQ-DB-06 | Versioned effective-dated masters | grade_standards, handling_profiles, templates, kpi_definitions, feature_flags, config_entries | CHECK constraints in migrations; test/unit/feature-flags.spec.ts | PASS |
| REQ-ADR-001 | Quantity/partial-fill invariants in schema | supply_lots CHECKs, fill flags, reservations, forecasts, risk events, rfq_awards | migrations 003/004 applied; architecture green | PASS (schema) |
| REQ-ADR-002 | Excursion events + HOLD gating + versioned handling profiles | logistics migration 005 (immutable excursions, shipment_exceptions, handling_profiles) | migration applied; immutability trigger present | PASS (schema) |
| REQ-ADR-003 | Immutable settlements + adjustments/recoveries | payments migration 006 | immutability trigger present | PASS (schema) |
| REQ-ADR-004 | PENDING_REVERIFICATION, payout freeze, dual approval, SUBMITTED_IRREVERSIBLE | identity.bank_change_requests (+CHECK dual approver), payments.payouts state vocab | migration applied | PASS (schema) |
| REQ-ADR-005 | Webhook dedupe (provider, provider_event_id); signature pre-transaction; security audit | payments.webhook_events UNIQUE; core.security_audit_events; docs/07, docs/09 | migration applied; envelope/authz tests | PASS (schema+design) |
| REQ-ADR-006 | Mobile convertibility: bearer/OIDC, device abstraction, web push now/FCM later, signed media | identity.auth_identities; common/device + realtime + media interfaces; web/lib/platform; device_tokens table | web build PASS; typecheck PASS | PASS |
| REQ-XCUT-01 | Standard error envelope | common/errors/* | test/unit/error-envelope.spec.ts; e2e assertions | PASS |
| REQ-XCUT-02 | Correlation/trace-ID middleware | common/tracing + AsyncLocalStorage context | test/unit/trace.middleware.spec.ts; audit e2e trace match | PASS |
| REQ-XCUT-03 | Feature flags (effective-dated) | core.feature_flags + FeatureFlagsService | test/unit/feature-flags.spec.ts | PASS |
| REQ-XCUT-04 | Transactional outbox + relay | common/outbox, workers/outbox-relay (SKIP LOCKED) | test/e2e/outbox.e2e-spec.ts | PASS |
| REQ-XCUT-05 | Idempotency framework | common/idempotency + core.idempotency_keys | test/unit/idempotency.spec.ts; test/e2e/idempotency.e2e-spec.ts | PASS |
| REQ-XCUT-06 | Optimistic concurrency + row locking | common/concurrency | unit-covered via concurrency helpers (compile+lint); row-lock path documented | PASS (infra) |
| REQ-SEC-01 | RBAC + org context + ABAC hooks | common/authz (verifier, middleware, guard) | test/unit/rbac.guard.spec.ts | PASS |
| REQ-SEC-02 | Org/tenant isolation | org-scoped repositories + baseline harness | test/e2e/tenant-isolation.e2e-spec.ts | PASS |
| REQ-AUD-01 | Immutable audit events + security stream | common/audit + triggers | test/e2e/audit-event.e2e-spec.ts | PASS |
| REQ-ENV-01 | dev/test/staging/prod env strategy | apps/api/.env.*, apps/web/.env.*, joi validation, scripts/bootstrap-infra.sh | config load in all runs | PASS |
| REQ-CI-01 | CI baseline | .github/workflows/ci.yml | mirrors local gate (all steps green locally) | PASS |
| REQ-SEED-01 | Dev-only seed | apps/api/seed/seed.ts (NODE_ENV gate) | `yarn seed` ran green | PASS |
| REQ-PWA-01 | Mobile-first PWA shell scaffold, zero native code | apps/web (Vite + React + TS + manifest) | web build + typecheck + lint PASS | PASS |

## Build 1 — Identity, Party, Organizations & RBAC

| Req ID | Requirement | Where implemented | Verification | Status |
|---|---|---|---|---|
| REQ-B1-ORG-01 | All Master org categories (17 active); exporter/government feature-gated | migration 007 type vocabulary + flag `org.exporter_government`; OrgsService.createOrg gating | build1 e2e "category gating" | PASS |
| REQ-B1-ORG-02 | Organization, Branch/Location, Address, Contact entities | identity.organizations/organization_branches/addresses/contacts | build1 e2e onboarding + getOrg | PASS |
| REQ-B1-USR-01 | User, credentials (bcrypt), multi-org membership (no single global role string) | users, user_credentials, org_memberships, user_roles(org-scoped) | build1 e2e auth + membership flows | PASS |
| REQ-B1-RBAC-01 | Role/Permission/RolePermission model; least privilege; platform privileged roles | migration 007 permission catalog + 6 system roles; OrgContextService per-request resolution | build1 e2e role tests; rbac.guard.spec | PASS |
| REQ-B1-AUTH-01 | Secure password auth, bearer tokens w/ expiry, refresh rotation, lockout | AuthService + RateLimitService (Redis, 5 fails → 15 min) | build1 e2e auth + rate-limit tests | PASS |
| REQ-B1-AUTH-02 | MFA architecture for privileged users (TOTP) | mfa_enrollments + otplib enroll/verify + login enforcement | build1 e2e MFA test | PASS |
| REQ-B1-AUTHZ-01 | Tenant isolation + object-level authz (404 on cross-org) | assertOrgAccess policies + org-scoped queries | build1 e2e tenant isolation + IDOR | PASS |
| REQ-B1-AUTHZ-02 | Audited support access, no shared admin passwords | support_access_grants (immutable, 30-min) + security audit on grant+read | build1 e2e support access test | PASS |
| REQ-B1-KYB-01 | KYB submission/review + immutable verification history | documents + verification_history (IMM trigger) | build1 e2e KYB test | PASS |
| REQ-B1-BANK-01 | Bank/payout profile: masked reads, supplier-side only, immutable history | BankService + bank_accounts (IMM), masking | build1 e2e supplier-only + masked read | PASS |
| REQ-B1-BANK-02 | High-risk change: PENDING_REVERIFICATION, payout freeze, dual approval, dual audit streams | bank_change_requests + verification_history + security_audit_events | build1 e2e dual-approval test | PASS |
| REQ-B1-SUSP-01 | Suspension removes transactional privileges, keeps reads, audited | org_restrictions + TRANSACTIONAL_PERMISSIONS in RbacGuard | build1 e2e suspension test | PASS |
| REQ-B1-IMM-01 | Payout/settlement history not alterable by any role | payments.settlements IMM trigger; no mutation API | build1 e2e immutability test | PASS |
| REQ-B1-UI-01 | Onboarding/account/admin interfaces only | apps/web pages: Login/Register/Onboarding/Account/Admin | web build + typecheck + lint PASS; screenshot | PASS |
| REQ-B1-PRIV-01 | Privilege escalation blocked (system roles not org-assignable; tampered tokens rejected) | ORG_ASSIGNABLE_ROLES allowlist + HMAC verify | build1 e2e escalation test | PASS |

## Build 2 — Catalog & Standards

| Req ID | Requirement | Where implemented | Verification | Status |
|---|---|---|---|---|
| REQ-B2-MODEL-01 | Canonical product model (category/product/botanical/common/commercial names, variety, colour, form, seasonality, launch flags, media metadata) | migration 008 (commodities ext, product_aliases, colours, varieties ext, product_media) | build2 e2e reads/detail | PASS |
| REQ-B2-ALIAS-01 | Canonical aliases; no duplicate products from synonyms (Lisianthus/Eustoma) | product_aliases + case-insensitive active unique index | build2 e2e (1,2,18,19,20) | PASS |
| REQ-B2-TAX-01 | Configurable categories FLOWER/FILLER/FOLIAGE, optional hierarchy, not hardcoded | categories.code + parent_id; category list API | build2 e2e; admin UI | PASS |
| REQ-B2-GOV-01 | Versioned effective-dated masters; no destructive edits; created_by/change_reason/status | grade_profiles, pack_definitions, unit_conversions, handling_profiles; status transitions only | build2 e2e (6,7,8,9); overlap 409 | PASS |
| REQ-B2-UOM-01 | Canonical UoM + explicit versioned product-scoped conversions; reject invalid/circular/non-positive/ambiguous | units_of_measure + unit_conversions + cycle/overlap guards | build2 e2e (3,4,5,6) | PASS |
| REQ-B2-GRADE-01 | Declarative versioned grade profiles against attribute dictionary; no universal A/B/C hardcode | grade_profiles.rules JSONB + quality_attributes | build2 e2e (7,8 + unknown-attr 400) | PASS |
| REQ-B2-DEFECT-01 | Configurable defect taxonomy for later QC/claims | defect_types (classes; 11 seeded classes) | masters endpoint; build2 e2e audit test | PASS |
| REQ-B2-HANDLING-01 | Versioned handling profiles (temp/humidity/light/ethylene/hydration/holding/precool/packaging/transport) | handling_profiles w/ range CHECKs + DTO validation | build2 e2e (9,10) | PASS |
| REQ-B2-TRANSPORT-01 | Transport compatibility metadata foundation (no shipment blocking) | transport_compatibility_rules (normalized pair unique index) | build2 e2e (9) | PASS |
| REQ-B2-SUBST-01 | Substitution attributes foundation only (no auto-substitution) | commodities.substitution_defaults JSONB | schema + doc | PASS (foundation) |
| REQ-B2-SEARCH-01 | Postgres FTS search over product/commercial/alias → canonical entities | CatalogService.search (tsvector + alias ILIKE) | build2 e2e (19,20) | PASS |
| REQ-B2-AUTHZ-01 | Separate catalog.read vs catalog.write; suppliers own capabilities only; buyers/suppliers can't modify masters | permissions + CATALOG_MANAGER role + org-scoped capabilities | build2 e2e (11–15) | PASS |
| REQ-B2-VALID-01 | class-validator DTOs on all Build 2 writes; Build 1 shared infra addressed via global ValidationPipe | dto.ts + main.ts/helpers.ts ValidationPipe(whitelist, forbidNonWhitelisted) | build2 e2e (unknown-field 400, range 400s) | PASS |
| REQ-B2-AUDIT-01 | Audit all master changes with actor/org/trace/before-after | audit.record in every admin write + outbox publish | build2 e2e (21) | PASS |
| REQ-B2-SEED-01 | Phase-1 basket seeded DEMO; units VALIDATED; no demo value presented as validated | seed/catalog-seed.ts + UI DEMO chips | build2 e2e (23); UI badges | PASS |
| REQ-B2-LAUNCH-01 | Launch city/category flags, audited | launch_enabled + launch_cities + PATCH endpoint | build2 e2e (22) | PASS |
| REQ-B2-UI-01 | Catalog browse/search + admin + capabilities screens, mobile 360/390/412 | CatalogPage, CatalogAdminPage, CapabilitiesPage + responsive nav/table-wrap | testing agent viewport checks (iterations 4–6) | PASS |
| REQ-B2-INACTIVE-01 | Inactive definitions rejected for new use; historical resolution preserved | capabilities add guard + variety read | build2 e2e (16,17) | PASS |

**Build 0 gate: ALL PASS.** Business functionality intentionally absent.
