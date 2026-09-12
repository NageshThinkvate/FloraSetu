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

**Build 0 gate: ALL PASS.** Business functionality intentionally absent.
