# 03 — Module Boundaries (12 strict bounded contexts)

Each context = one NestJS module under `apps/api/src/modules/<context>/` with this internal layout:

```
<context>/
├── contracts/          # PUBLIC surface: DTOs, typed service interfaces, event payloads
│   ├── index.ts        # the ONLY importable path for other contexts
│   ├── dto.ts
│   ├── service.interface.ts
│   └── events.ts       # outbox event payload types this context publishes
├── internal/           # PRIVATE: controllers, services, repositories, entities, mappers
└── <context>.module.ts # exports providers implementing contracts interfaces only
```

## The 12 contexts and their responsibilities

| # | Context | Dir | Owns (tables) | Publishes (events) | Consumes |
|---|---------|-----|---------------|--------------------|----------|
| 1 | Identity & Party | `identity-party` | organizations, users, memberships, RBAC, KYC, bank accounts/change requests | `party.org.created`, `party.bank.change.requested`, `party.kyc.updated` | — |
| 2 | Catalog & Standards | `catalog-standards` | categories/commodities/varieties, UoM, grade standards (versioned), pack types | `catalog.standard.published` | — |
| 3 | Supply & Inventory | `supply-inventory` | terminals, warehouses, supply lots, reservations, forecasts, risk events | `supply.lot.created`, `supply.reservation.committed`, `supply.risk.raised` (ADR-001) | Catalog (contracts) |
| 4 | Demand/Events/RFQ | `demand-rfq` | demand intents, procurement events, RFQs/lines/invitations/bids/awards | `rfq.published`, `rfq.awarded` (multi-supplier award) | Identity, Catalog |
| 5 | Auction & Market | `auction-market` | auctions, lots, immutable bids/results, price snapshots | `auction.bid.placed`, `auction.closed` | Supply (contracts) |
| 6 | Order & Allocation | `order-allocation` | orders, lines, allocations, status history | `order.created`, `order.allocated`, `order.status.changed` | Supply, Catalog |
| 7 | Quality & Traceability | `quality-traceability` | QC inspections/results, certificates, genealogy, custody events | `qc.completed`, `traceability.custody.recorded` | Supply, Catalog |
| 8 | Logistics & Cold Chain | `logistics-coldchain` | shipments/legs/routes (PostGIS), temp readings, excursion events, exceptions, handling profiles | `coldchain.excursion.detected`, `shipment.exception.raised`, `shipment.delivered` | Order (contracts) |
| 9 | Payments & Settlement | `payments-settlement` | invoices, payments, payouts, immutable settlements, adjustments/recoveries, webhook dedupe | `payment.captured`, `settlement.finalized`, `payout.submitted` | Order, Identity |
| 10 | Claims & Support | `claims-support` | claims, evidence, decisions, tickets | `claim.opened`, `claim.decided` | Order, Payments |
| 11 | Notifications | `notifications` | templates (versioned), notifications, deliveries, push subs, device tokens | `notification.delivered` | all (contracts only) |
| 12 | Analytics & Control Tower | `analytics-controltower` | KPI defs, snapshots, alerts, dashboards | `analytics.alert.raised` | all (events only) |

## Boundary rules (enforced by architecture tests)
1. Other contexts may import ONLY `<context>/contracts` (via path alias `@module/<context>` mapped to contracts `index.ts`). Importing `<context>/internal/**` = build failure.
2. **No cross-boundary table reads**: a repository may only touch tables owned by its context (checked by architecture test scanning SQL/table-name literals). Cross-context data flows through typed contract interfaces or outbox events.
3. Inter-context calls are in-process interface calls (modular monolith) — designed to be extractable later.
4. Domain events cross boundaries ONLY via transactional outbox (10-async-outbox-design.md), never via shared tables.
5. `common/` may be imported by any context but must stay domain-free.

## ADR mapping
- ADR-001 → SI (lot qty CHECKs, reservation row locks, supply_risk_events) + DR (rfq_awards multi-supplier, allow_partial_fill/minimum_acceptable_quantity).
- ADR-002 → LC (immutable excursion events, shipment exceptions, versioned handling profiles, acceptance/settlement HOLD gates).
- ADR-003 → PS (immutable settlements + financial_adjustments/recoveries) + CX (claims).
- ADR-004 → IP (bank_change_requests, protected bank history) + PS (payout freeze, SUBMITTED_IRREVERSIBLE, dual approval fields).
- ADR-005 → PS (webhook_events dedupe) + common (signature verification pre-transaction, security audit stream).
- ADR-006 → web shell + `common/device`, `common/media`, NT push/device abstraction, bearer-token auth.
