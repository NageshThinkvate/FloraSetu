# Test Traceability — Build 0

| Test | Requirement(s) | Type | Gate? | Status |
|---|---|---|---|---|
| test/architecture/boundary.spec.ts | REQ-ARCH-01 (12 contexts, contracts-only) | architecture | yes | PASS (2 tests) |
| test/architecture/no-cross-table.spec.ts | REQ-ARCH-02 (corrected scan: distinguishes contract property access from raw cross-schema SQL; custody.service fixed via SupplyInventory contract) | architecture | yes | PASS |
| test/architecture/common-purity.spec.ts | REQ-ARCH-03 | architecture | yes | PASS (2 tests) |
| test/architecture/no-cycles.spec.ts | REQ-ARCH-04 + ADR-010 allowlist (order-allocation↔supply-inventory, order-allocation↔logistics-coldchain; contracts-only evidence enforced; all other cycles FAIL) | architecture | yes | PASS |
| test/unit/error-envelope.spec.ts | REQ-XCUT-01 | unit | — | PASS (3 tests) |
| test/unit/trace.middleware.spec.ts | REQ-XCUT-02 | unit | — | PASS (2 tests) |
| test/unit/feature-flags.spec.ts | REQ-XCUT-03 / REQ-DB-06 | unit | — | PASS (2 tests) |
| test/unit/reference-id.spec.ts | REQ-DB-04 | unit | — | PASS |
| test/unit/rbac.guard.spec.ts | REQ-SEC-01 | unit | — | PASS (3 tests) |
| test/unit/idempotency.spec.ts | REQ-XCUT-05 | unit | — | PASS (5 tests) |
| test/e2e/tenant-isolation.e2e-spec.ts | REQ-SEC-02, REQ-XCUT-01 | e2e (GATE) | yes | PASS (4 tests) |
| test/e2e/audit-event.e2e-spec.ts | REQ-AUD-01, REQ-DB-05, REQ-XCUT-02 | e2e (GATE) | yes | PASS (2 tests) |
| test/e2e/idempotency.e2e-spec.ts | REQ-XCUT-05 | e2e (GATE) | yes | PASS (2 tests) |
| test/e2e/outbox.e2e-spec.ts | REQ-XCUT-04 | e2e (GATE) | yes | PASS (2 tests) |
| test/e2e/zz-migrations.e2e-spec.ts | REQ-DB-01 | e2e (GATE) | yes | PASS |
| test/e2e/build1-identity.e2e-spec.ts | REQ-B1-* (auth, MFA, rate-limit, tenancy, IDOR, roles, KYB, bank dual-approval, suspension, immutability, support access, privilege escalation) | e2e (GATE) | yes | PASS (12 tests) |
| test/e2e/build2-catalog.e2e-spec.ts | REQ-B2-* — mandates (1)(2)(3)(4)(5)(6)(7)(8)(9)(10)(11)(12)(13)(14)(15)(16)(17)(18)(19)(20)(21)(22)(23) | e2e (GATE) | yes | PASS (20 tests) |
| test/e2e/prebuild3-gate.e2e-spec.ts | REQ-G3-* — control-gate tests F1–F7 (explicit UoM, preferred-vs-submitted, original preservation, DEMO rejected, ACTIVE+VALIDATED accepted, no self-approval, retired-validated resolves; rejection-reason flow) | e2e (GATE) | yes | PASS (8 tests) |
| mobile layout smoke (24) | REQ-B2-UI-01 | viewport checks (360/390/412) via testing agent | yes | PASS (iterations 4–6: nav overflow + tap targets + table wrap fixed & verified) |
| test/e2e/phase5-logistics-partner.e2e-spec.ts | REQ-P5-* — ADR-012 acceptance scenarios L1–L17 (partner-controlled driver assignment + history, staff/buyer/supplier/self lockout, driver job isolation, road-no-driver + bus/rail/air driverless modes, backend arrival events, structured POD signature+reference, orthogonal exceptions, POD≠quality, idempotent retry collapse, tenant isolation, dashboard + driver picker scoping, unassign) | e2e (GATE) | yes | PASS (17 tests) |
| Phase 5 frontend acceptance | REQ-P5-UI-* — partner dashboard, job list filters, multimodal job detail, assign/reassign/unassign UI, execution stepper, POD form+evidence links, exceptions, driver mobile 390, terminology scan | testing agent (1440 desktop + 390 mobile) | yes | PASS (iteration_18, 100%, zero bugs) |

Pre-Build-3 gate totals: 19 suites, 84 tests, 0 failures.
Acceptance gate sequence: build ✅ · typecheck ✅ · lint ✅ · migrations up/down (9 migrations) ✅ · unit ✅ · architecture ✅ · tenant isolation ✅ · catalog gates ✅ · validation workflow ✅ · commercial-UoM ✅ · all Build 0–2 e2e ✅.
