# 11 — Test Strategy

## Pyramid (Build 0 scope: foundations only, no business features)
1. **Unit tests** (Jest) — per-context service logic once it exists; in Build 0: error envelope, trace-ID middleware, feature-flag resolver, reference-ID generator, RBAC guard, idempotency claim logic, outbox writer, concurrency helpers.
2. **Architecture / anti-coupling tests** (Jest, `test/architecture/`) — boundary, no-cross-table, common-purity, contracts-only, no-cycles (see 04). These run in every CI build and are the primary guardrail for the 12-context monolith.
3. **Baseline e2e** (Jest + supertest against a real Postgres test DB + Redis):
   - **tenant-isolation baseline** — org A cannot read org B's seeded row via any API path (404, and zero cross-org rows in list endpoints).
   - **audit-event test** — seeded privileged mutation writes one immutable `audit_events` row with trace_id; UPDATE on audit table is rejected by trigger.
   - **idempotency baseline** — replay same key+body → one effect + byte-identical response; same key different body → 409.
   - **outbox baseline** — mutation + outbox row share one transaction.
   - **migrations up/down** — full `up` then `down` then `up` on a scratch DB.
4. **Contract tests** (deferred to Build 1): typed API contracts per context get schema snapshots once endpoints exist.

## Infra
- Test env: `apps/api/.env.test` (dedicated DB `florasetu_test`, dedicated Redis db index).
- `NODE_ENV=test` disables seed, rate-limit bypass header for tests only, deterministic clock injection.
- Seed (`apps/api/seed/`) is **dev-only**, gated by `NODE_ENV=development`; creates 2 orgs, users/roles, one of each master-data row. Never runs in test/staging/prod.

## CI baseline (`.github/workflows/ci.yml`)
`install → lint → typecheck → architecture tests → unit tests → migrate up (scratch Postgres+PostGIS service) → baseline e2e → migrate down → build api+web`. Required checks on PR; no bypass.

## Coverage gate (Build 0)
Statements/lines ≥ 80% on `src/common/**` (infra code only; modules are scaffolds).

## Traceability
Every test file header lists the requirement IDs it covers; `TEST_TRACEABILITY.md` maps requirement → test file → status. Acceptance-gate tests are marked `GATE`.
