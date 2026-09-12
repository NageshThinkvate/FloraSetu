# 04 — Dependency Rules (enforced by architecture tests)

## Allowed dependency directions

```
apps/web ──(HTTP, typed client)──> apps/api            # bearer token only, no cookies required
modules/* ──> common/*                                  # any context may use domain-free infra
modules/X ──> modules/Y/contracts                       # typed interface only
modules/X ──X─> modules/Y/internal                      # FORBIDDEN
modules/X ──X─> modules/Y tables (SQL)                  # FORBIDDEN (no cross-boundary reads)
common ──X─> modules/*                                  # FORBIDDEN (infra must stay domain-free)
```

## Layering inside a context
`controller → service (contracts impl) → repository → db`. Controllers never touch repositories; repositories never contain business rules.

## Static rules (machine-checked, `apps/api/test/architecture/`)
1. **boundary.spec** — walks `src/modules`, parses imports; any import crossing into another context's `internal/` fails.
2. **no-cross-table.spec** — scans repository files for table-name literals; fails if a repository references a table owned by another context (ownership map from `docs/05-table-inventory.md` embedded as `test/architecture/table-ownership.json`).
3. **common-purity.spec** — fails if any file under `src/common` imports from `src/modules`.
4. **contracts-only.spec** — every cross-context import resolves to a `contracts/index.ts` barrel.
5. **no-cycles.spec** — module dependency graph (contracts-level) must be acyclic, except pairs explicitly documented in `ARCHITECTURE_DECISIONS.md` (none currently).

## Runtime rules
- Tenant isolation: every repository query is scoped by `org_id` via a mandatory `OrgContext` (AsyncLocalStorage, populated by auth middleware). Baseline test: tenant-isolation spec.
- Optimistic concurrency on ordinary mutables via `version INT` + `WHERE version = ?`; transactional `SELECT … FOR UPDATE` row locking only for inventory/allocation and payout state transitions.
- Immutability: audit/financial/auction/KYC/custody/quality/temperature-excursion tables have `BEFORE UPDATE OR DELETE` triggers that raise exceptions, and app role lacks UPDATE/DELETE grants.
- All writes that emit domain events use the transactional outbox in the SAME DB transaction.
- Time is UTC everywhere (`TIMESTAMPTZ`, app never sets a non-UTC session timezone).
- Money is BIGINT minor units; API contracts carry `{ amount_minor, currency }` — floats forbidden (lint rule + code review checklist).

## Async rules
- Queue worker consumes outbox via `FOR UPDATE SKIP LOCKED`; consumers must be idempotent (dedupe by event id).
- Webhook ingress: signature verification BEFORE any DB transaction; failures go to `security_audit_events`; dedupe on `(provider, provider_event_id)`; duplicates return success ack with zero side effects (ADR-005).

## Build-time gates (CI, in order)
`yarn install --immutable → lint → typecheck → architecture tests → unit tests → migrations up → baseline e2e (tenant isolation, audit event, idempotency) → migrations down → build`.
