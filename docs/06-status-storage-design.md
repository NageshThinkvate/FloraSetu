# 06 — Status Storage Design

## Principles
1. Statuses are stored as **TEXT with CHECK constraints** (not Postgres enums) — adding a state is a migration of a CHECK, not a type rebuild; keeps status vocabularies reviewable in one place.
2. Every stateful entity has exactly one `status` column + an immutable `*_status_history`-style record where transitions matter (orders, RFQs, payouts, claims).
3. Transition validation lives in the service layer per context (state machine map); the DB CHECK only enforces membership of the vocabulary — transition legality is app-enforced and unit-tested.
4. Later-phase statuses are created NOW (schema-complete, UI-inactive) so migrations stay additive.

## Key state machines (Build 0 vocabularies, LOCKED)

### SI.inventory_reservations.status
`HELD → COMMITTED → CONSUMED` · `HELD → RELEASED` · `COMMITTED → RELEASED` (release on cancellation only; ADR-001: forecast reduction never force-releases COMMITTED)

### SI.supply_lots.status
`DRAFT → ACTIVE → DEPLETED | WITHDRAWN | EXPIRED`

### DR.rfqs.status
`DRAFT → PUBLISHED → CLOSED → AWARDED | CANCELLED`

### DR.rfq_awards — none (fact table); award legality via service-level checks (multi-supplier award allowed; single-supplier partial fill gated by `allow_partial_fill` + `minimum_acceptable_quantity`, default all-or-nothing)

### AM.auctions.status
`SCHEDULED → OPEN → CLOSED → SETTLED | CANCELLED`

### OA.orders.status
`CREATED → CONFIRMED → ALLOCATED → FULFILLED → INVOICED → CLOSED` · `→ CANCELLED` (guarded branches) — history in `order_status_history` (IMM)

### LC.shipments.status
`PLANNED → IN_TRANSIT → DELIVERED → ACCEPTED | ACCEPTED_WITH_EXCEPTION` — `acceptance_hold BOOLEAN` gates buyer acceptance & supplier settlement while excursions are PENDING_REVIEW (ADR-002)

### LC.shipment_exceptions.status
`OPEN → PENDING_REVIEW → RESOLVED_HOLD_RELEASED | RESOLVED_ESCALATED`

### PS.payouts.status (ADR-004)
`DRAFT → APPROVED → SUBMITTED_IRREVERSIBLE → SETTLED | FAILED` — once `SUBMITTED_IRREVERSIBLE`, no path back; bank change sets `payout_freeze=true` and `PENDING_REVERIFICATION` on the bank change request; dual approval required to unfreeze.

### IP.bank_change_requests.status (ADR-004)
`SUBMITTED → PENDING_REVERIFICATION → APPROVED_FIRST → APPROVED_FINAL | REJECTED` (two distinct approvers enforced by CHECK `approver_1_id <> approver_2_id`)

### PS.settlements — no status mutation; IMM (ADR-003). Post-settlement corrections only via `financial_adjustments`/`recoveries` linked to a `CX.claims` row.

### CX.claims.status
`OPENED → UNDER_REVIEW → DECIDED → CLOSED` (decision IMM in `claim_decisions`)

### PS.webhook_events — dedupe record, not a state machine; insert-or-conflict on `(provider, provider_event_id)` returns prior processing outcome (ADR-005).

## Config-driven masters
Grade standards, handling profiles, notification templates, KPI definitions, feature flags, config entries are **versioned effective-dated** (`version_no INT`, `valid_from`, `valid_to`, CHECK non-overlap enforced via exclusion constraint on daterange where applicable). Runtime resolution: row in force at the business timestamp (e.g. excursion severity uses profile version valid at `occurred_at`).
