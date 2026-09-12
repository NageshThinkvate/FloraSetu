# PILOT OPERATING FLOW — FloraSetu Phase-1 Pilot (Build 4)

Scope: the minimum production-quality fulfilment path for a real-money pilot transaction —
from an accepted supplier offer (award) through physical flower delivery, QC, logistics and
manual commercial closure. No payment gateway, no automated payouts, no AI: money movement is
recorded manually as EXTERNAL records (§22/§23).

All endpoints are under `/api`, Bearer auth + `X-Org-Id`. Mutating writes take an
`Idempotency-Key` header (UI generates one automatically).

## Roles in the pilot

| Persona | Org / role | Key permissions |
|---|---|---|
| Buyer ops | buyer org ORG_ADMIN | order.read/manage, delivery.accept, claim.create |
| Supplier | grower org ORG_ADMIN | lot.write/read, inventory.*, pack.manage, dispatch.manage, claim.create (respond) |
| QC agent | platform org QC_AGENT | qc.inspect, qc.read |
| Finance ops | platform org FINANCE_OPS | payment.record/verify, settlement.record/verify |
| Platform ops | platform org PROCUREMENT_OPS | procurement.manage (+ claim.create/manage), tower, exception resolve |

Conflict controls: a QC inspector may not inspect their own org's lot (409 QC_CONFLICT);
a `procurement.manage` holder may override only with a recorded reason. Payment/settlement
recorder can never verify their own record (403 SELF_VERIFY, §29). A supplier can never record
its own settlement (403 SELF_DEALING).

## Happy path (single transaction)

1. **Award → Order.** After a final award (Build 3), buyer/ops: `POST /orders/convert-award`
   (or the “Convert to order” action on the Control Tower). Order starts `PENDING_CONFIRMATION`;
   supplier allocations are created with an immutable spec snapshot.
2. **Supplier confirms.** Supplier: `POST /orders/allocations/:id/confirm` (UI: Supplier
   fulfilment → Confirm). When all suppliers confirm, the order becomes `CONFIRMED`.
3. **Physical intake.** Supplier records the real stock: `POST /supply/lots/harvest` (or
   `/stock`) — declared qty, UoM, origin, photos via `POST /media` + `POST /supply/lots/:id/media`.
   Lot starts `HARVESTED`/`STOCK_RECEIVED` with **0 available** — nothing sells before QC.
4. **QC.** Supplier submits (`POST /supply/lots/:id/submit-qc` → `QC_PENDING`). QC agent opens
   an inspection from the QC queue and completes it with accepted/rejected/held quantities
   against a **pinned grade-profile version**. Accepted → `AVAILABLE`; held → `HOLD` until the
   supplier resolves it with an exact split (`/resolve-hold`); fully rejected → `REJECTED`,
   never sellable.
5. **Allocation.** Buyer/ops allocates the QC-passed lot to order lines
   (`POST /orders/allocate`). DB-enforced invariant (ADR-001): `reserved + allocated ≤ available`
   under row locks — oversell is impossible. Lot UoM must match the line UoM. Fully covered
   lines → `ALLOCATED`; order → `SUPPLY_CONFIRMED`. Shortfalls: `/allocations/:id/shortfall`.
6. **Packing.** Supplier records packing per line (`POST /logistics/pack`; packed ≤ allocated,
   custody event `PACKED`, line → `PACKED`). Buyer/ops moves the order `QC_PACK` →
   `READY_FOR_DISPATCH` (blocked until every line is packed).
7. **Transport.** Create a manual shipment (`POST /logistics/shipments`: mode, explicit
   temp-controlled flag, carrier, bus/train/flight/vehicle + AWB refs, ETA). Dispatch is atomic
   (`/dispatch`): lot buckets move, line → `DISPATCHED`, custody `CARRIER_HANDOFF`, order →
   `DISPATCHED`.
8. **Delivery / POD.** `POST /logistics/shipments/:id/pod` (delivered qty, receiver,
   shortage/damage flags). One POD per shipment; shipment → `DELIVERED`; order → `DELIVERED` →
   `ACCEPTANCE_PENDING` (awaiting the buyer).
9. **Buyer acceptance.** Buyer: `POST /orders/:id/accept` (accepted / optional disputed qty).
   No dispute → `ACCEPTED`; disputed → `ACCEPTANCE_PENDING` (re-accept when resolved).
10. **Payment (manual external).** Finance records the buyer's actual external payment
    (`POST /finance/payments`: amount, method, UTR/bank ref, paid-at) — status `RECORDED`, kind
    `EXTERNAL_RECORDED`. A **second** finance user verifies (`/verify`).
11. **Supplier settlement (manual).** Finance records the settlement (`POST
    /finance/settlements`: gross, deductions, claim adjustment, payout ref). Net =
    gross − deductions − claim adjustment. Second user verifies, then completes — payout done
    externally, order → `SETTLED`. COMPLETED settlements are immutable (ADR-003): corrections
    are adjustment rows (`/adjustments`), never edits.
12. **Claims (optional, any time after delivery).** Buyer reports an issue from the order page
    (or `POST /claims`), attaches photo evidence, submits (order → `CLAIM_OPEN`). Supplier
    responds; ops drives the lifecycle to APPROVED/REJECTED. Approved financial outcomes land
    as immutable adjustment records; claims auto-close when a COMPLETED settlement covers the
    adjustment.

## Exceptions and the Control Tower

`GET /tower/exceptions` (ops) aggregates 15 queues: unconverted awards, unconfirmed suppliers
(>24h), lines short after QC, buyer acceptance pending, lots awaiting QC / on HOLD / packed-not-
dispatched, open inspections, dispatch overdue (12h), ETA overdue, POD missing (24h), open
shipment exceptions, unverified payments, pending settlements, open claims.

- **Temperature excursion** (ADR-002): `POST /logistics/shipments/:id/temperature-exception`
  (WARNING records; CRITICAL opens a blocking exception → shipment `acceptance_hold`, buyer
  acceptance 409 DELIVERY_HOLD, settlement completion 409 SETTLEMENT_HOLD). Ops resolves with a
  note (`/logistics/exceptions/:id/resolve`) → holds release.
- **Payout freeze** (ADR-004): a supplier bank change under re-verification blocks settlement
  completion (409 PAYOUT_FROZEN) until cleared.
- **Order cancel**: ops/buyer `POST /orders/:id/transition {to:'CANCELLED'}` — allowed up to
  DISPATCHED; reserved/allocated lots are released back to available.

## Single-dispatch lot model (pilot simplification)

A lot allocates from `available − reserved − allocated` while `AVAILABLE`/`RESERVED`. Dispatch
consumes the allocation and locks the lot (`DISPATCHED`/`DELIVERED`) — shipped stock can never
be re-allocated, and the unsold remainder of a partially shipped lot is not re-sellable in the
pilot (split the lot before QC if partial sale is expected).

## Pilot data tooling

- `bash /app/scripts/seed-pilot-order.sh` — seeds a full chain end-to-end into
  `READY_FOR_DISPATCH` (re-runnable, fresh order each run). Accounts in
  `/app/memory/test_credentials.md`.
- Frontend surfaces: `/orders` (+ detail), `/supply/orders`, `/supply/lots` (+ detail),
  `/ops/qc`, `/ops/tower`, `/ops/finance`, `/claims` (+ detail).

## Known dev stubs — PILOT PRODUCTION BLOCKERS

- **OD-02 (auth):** dev HMAC tokens; no production IdP/TOTP MFA yet. **Blocker for production
  pilot with external parties.**
- **OD-03 (media):** local-disk object store with 5-min signed URLs
  (`/media/raw/:key`). Acceptable for dev; **blocker for production evidence durability** — move
  to durable object storage before external pilot.

## Regression gate

`npx jest test/e2e --runInBand` (apps/api): 196 tests / 11 suites across Builds 0–4, including
`build4-pilot.e2e-spec.ts` (74 tests: conversion, balances/ADR-001, QC math + conflict control,
packing/dispatch/POD atomicity, cold-chain holds/ADR-002, payments+settlements/§29/ADR-003/004,
claims, custody immutability, tower, tenant isolation/IDOR, and the mandatory K1 end-to-end
pilot simulation). Migrations are fully reversible (`zz-migrations`).
