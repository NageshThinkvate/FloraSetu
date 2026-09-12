# State Machines — FloraSetu (Build 3)

Canonical lifecycle definitions for the Demand/RFQ context. All transitions are
enforced server-side inside DB transactions with row locks (`SELECT ... FOR UPDATE`);
illegal transitions return `409 CONFLICT` with `code_detail: ILLEGAL_TRANSITION`.
Every transition writes an immutable `core.audit_events` entry.

## 1. Requirement (canonical buyer demand — QUICK / EVENT / FORMAL converge here)

States: `DRAFT, SUBMITTED, SOURCING, QUOTING, CLARIFICATION, EVALUATION, AWARDED, PARTIALLY_AWARDED, CONVERTED, CLOSED, CANCELLED`

| From | To | Trigger |
|---|---|---|
| DRAFT | SUBMITTED | buyer submit (idempotent) |
| DRAFT | CANCELLED | buyer/ops cancel |
| SUBMITTED | SOURCING | RFQ published (auto for QUICK mode) |
| SUBMITTED | CANCELLED | cancel |
| SOURCING | QUOTING | first quotation submitted |
| SOURCING | CANCELLED | cancel |
| QUOTING | CLARIFICATION | first clarification posted |
| QUOTING | EVALUATION | buyer begins evaluation |
| QUOTING | CANCELLED | cancel |
| CLARIFICATION | QUOTING | (implicit — further quote activity) |
| CLARIFICATION | EVALUATION | buyer begins evaluation |
| CLARIFICATION | CANCELLED | cancel |
| EVALUATION | AWARDED / PARTIALLY_AWARDED | award created (coverage decides) |
| EVALUATION | CANCELLED | cancel |
| PARTIALLY_AWARDED | AWARDED | award covers all remaining quantity |
| PARTIALLY_AWARDED | CLOSED / CANCELLED | buyer closes residual demand / cancel |
| AWARDED | CONVERTED | order conversion (Build 4/5 — inert interface only) |
| AWARDED | CLOSED / CANCELLED | close / cancel (cascades: RFQs CANCELLED, awards CANCELLED) |
| CONVERTED | CLOSED | terminal close |

Revision rule: a requirement is revisable in `SUBMITTED, SOURCING, QUOTING,
CLARIFICATION, EVALUATION`. A revision increments `current_version_no`, re-points
open RFQs, and forces all `SUBMITTED` quotation versions to
`RECONFIRMATION_REQUIRED` (never silently valid). Ops revisions against another
org's requirement set `consent_required = true`; buyer consent is a separate
recorded action.

## 2. Requirement version

`version_no` is monotonic per requirement; rows immutable once written.
`consent_required → consented_by/at` (buyer consent for ops overrides).

## 3. RFQ

States: `DRAFT, PUBLISHED, CLOSED, AWARDED, PARTIALLY_AWARDED, CANCELLED`

- One open RFQ per requirement (partial unique index, duplicate-publish safe).
- Publish: requirement must be `SUBMITTED` or `SOURCING`; supplier pool is the
  explicit list (FORMAL) or capability-matched + ACTIVE-org filtered (managed).
- Cancel allowed from `DRAFT`/`PUBLISHED`; cascades quotations to `CLOSED`.
- `AWARDED` / `PARTIALLY_AWARDED` mirror requirement coverage after awards.

## 4. RFQ invitation (supplier side)

States: `INVITED → VIEWED → INTENDS_TO_QUOTE → QUOTED`, or `DECLINED` (with mandatory reason; terminal for that RFQ).

## 5. Clarification

States: `OPEN → ANSWERED` (or `CLOSED`). Visibility `BUYER_PRIVATE | PUBLIC`.
Suppliers see their own questions plus PUBLIC answered ones; buyers see all.
Clarifications never mutate requirement commercial terms.

## 6. Quotation / quotation version

Quotation: `ACTIVE, WITHDRAWN, CLOSED` (one per supplier per RFQ — unique index).
Version: `SUBMITTED, RECONFIRMATION_REQUIRED, SUPERSEDED, ACCEPTED, PARTIALLY_ACCEPTED, REJECTED`.

- Submit requires: RFQ `PUBLISHED`, invitation not `DECLINED`, quote deadline not
  passed, `valid_to` in the future, RFQ still on the current requirement version.
- Revision supersedes the current version; originals are never edited (OD-08).
- Original `quoted_qty` / `quoted_uom_id` are immutable. Normalization metadata
  (`normalized_qty`, `conversion_version_id/no`, `normalization_status`) is
  recorded alongside via an ACTIVE, VALIDATED conversion only — never invented.

## 7. Award

States: `FINAL, CANCELLED`. Award is the Build-3 terminal commercial decision.

Invariants (enforced under row locks in one transaction):
- RFQ awardable from `PUBLISHED, CLOSED, PARTIALLY_AWARDED` (never CANCELLED).
- Requirement awardable from `EVALUATION, PARTIALLY_AWARDED, QUOTING, CLARIFICATION`.
- Only current, `SUBMITTED`, unexpired quotation versions are awardable
  (`QUOTE_SUPERSEDED` / `RECONFIRMATION_REQUIRED` / `QUOTE_EXPIRED`).
- `SUM(awarded_qty per requirement line over FINAL awards) <= requirement quantity`
  (`EXCEEDS_REQUIREMENT`); partial awards are explicit, never silent.
- Deviations/substitution proposals require recorded buyer consent
  (`CONSENT_REQUIRED` → `buyer_consent` JSONB on the award).
- Supplier can never award itself (`SELF_AWARD`).
- `prepare-order` returns an inert `CreateOrderFromAward` command
  (`PENDING_BUILD_5`) — no order is created in Build 3.

## 8. Event / ceremony / BOM

Event: `DRAFT, PLANNING, CONFIRMED, COMPLETED, CANCELLED` (soft delete via `deleted_at`).
BOM line sourcing: `PLANNED → SOURCING → PARTIALLY_COVERED → COVERED` (set when a
BOM line is linked into a requirement line).
