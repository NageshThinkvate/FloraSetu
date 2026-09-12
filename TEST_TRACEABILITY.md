# Test Traceability — Build 0

| Test | Requirement(s) | Type | Gate? | Status |
|---|---|---|---|---|
| test/architecture/boundary.spec.ts | REQ-ARCH-01 (12 contexts, contracts-only) | architecture | yes | PASS (2 tests) |
| test/architecture/no-cross-table.spec.ts | REQ-ARCH-02 | architecture | yes | PASS |
| test/architecture/common-purity.spec.ts | REQ-ARCH-03 | architecture | yes | PASS (2 tests) |
| test/architecture/no-cycles.spec.ts | REQ-ARCH-04 | architecture | yes | PASS |
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

Build 1 totals: 17 suites, 56 tests, 0 failures.
Acceptance gate sequence: build ✅ · typecheck ✅ · lint ✅ · migrations up/down (7 migrations) ✅ · unit ✅ · all e2e baselines incl. Build 1 gates ✅.
