# Domain Model — FloraSetu (Build 0 freeze)

Single source of truth: Master Spec v2.0. This file narrates the ERD (docs/02) and the invariants (docs/04, docs/06).

## Bounded contexts & core aggregates
1. **Identity & Party** — `Organization` (buyer/supplier/both), `User`, `Membership`, `Role/Permission`, `KycRecord` (immutable), `BankAccount` (immutable history) + `BankChangeRequest` (PENDING_REVERIFICATION, dual approval — ADR-004), `AuthIdentity` (OIDC subject — ADR-006), `MfaEnrollment`.
2. **Catalog & Standards** — `Category`(coded, hierarchical) → `Commodity` (canonical product: botanical/common/commercial names, aliases via `ProductAlias`, seasonality, launch flags, validation status, `preferred_order_uom_id` as UI preselection only — ADR-008) → `Variety` (colour, form, stem-length range). Versioned effective-dated masters with validation workflow (ADR-009: DEMO→PENDING_REVIEW→VALIDATED/REJECTED, separate reviewer): `GradeProfile` (declarative rules vs `QualityAttribute` dictionary), `PackDefinition` (nestable), `UnitConversion` (product-scoped, cycle-safe), `HandlingProfile` (requirement ranges; severity policy stays in Logistics). `DefectType` taxonomy, `TransportCompatibilityRule` metadata, `SupplierProductCapability` (org-owned). Canonical `UnitOfMeasure`. (Build 2 + Pre-Build-3 gate — live; ADR-007/008/009.)
3. **Supply & Inventory** — `Terminal`/`Warehouse` (PostGIS), `SupplyLot` (available/reserved/allocated, CHECK-enforced — ADR-001), `InventoryReservation` (row-locked), `AvailabilityForecast`, `SupplyRiskEvent`.
4. **Demand/Events/RFQ** — `DemandIntent`, `ProcurementEvent`, `Rfq/RfqLine` (fill policy per line), `RfqInvitation`, `RfqBid`, `RfqAward` (multi-supplier).
5. **Auction & Market** — `Auction/AuctionLot`, immutable `Bid`, immutable `AuctionResult`, `MarketPriceSnapshot`.
6. **Order & Allocation** — `Order/OrderLine`, `Allocation` (line→lot under row lock), immutable `OrderStatusHistory`.
7. **Quality & Traceability** — `QcInspection/QcResult` (graded against standard version), `Certificate`, immutable `TraceabilityLink`, immutable `CustodyEvent`.
8. **Logistics & Cold Chain** — `Shipment/ShipmentLeg/Route` (PostGIS), append-only `TemperatureReading`, immutable `TemperatureExcursionEvent`, `ShipmentException` (HOLD/PENDING_REVIEW gating acceptance & settlement — ADR-002), versioned `HandlingProfile`.
9. **Payments & Settlement** — `Invoice/Payment`, `Payout` (SUBMITTED_IRREVERSIBLE — ADR-004), immutable `Settlement` + `FinancialAdjustment/Recovery` (ADR-003), `WebhookEvent` dedupe (ADR-005), `PaymentProviderRef`.
10. **Claims & Support** — `Claim` (post-settlement capable), `ClaimEvidence`, immutable `ClaimDecision`, `SupportTicket`.
11. **Notifications** — versioned `NotificationTemplate`, `Notification/Delivery`, `PushSubscription` (web), `DeviceToken` (FCM/APNs later — ADR-006).
12. **Analytics & Control Tower** — versioned `KpiDefinition`, append-only `AnalyticsSnapshot`, `ControlTowerAlert`, `DashboardConfig`.

## Cross-cutting invariants
- Money: integer minor units, never float. Time: UTC `TIMESTAMPTZ`.
- Identity: internal UUID PK + public human-readable `ref` per major object.
- Tenancy: `org_id` on every tenant table; context-injected scoping.
- Mutability: ordinary mutables = optimistic `version`; inventory/allocation = row locks; historical/financial/auction/KYC/custody/quality/excursion = immutable (trigger + grants).
- Integration: transactional outbox only; idempotent consumers; webhook signature before transaction.
- Config: effective-dated versioned masters for standards, handling profiles, templates, KPIs, flags.

## Inactive in Build 0
Live auctions, AI, native mobile, government/e-NAM integrations, buyer credit, export, national launch, owned infrastructure, all buyer/supplier feature screens. Their tables exist; no endpoints/UI activate them.

## Build 3 — canonical demand model (implemented)

The Demand/RFQ context (#4) is now live with the canonical model: `Event` (+`Ceremony`, `BomLine`),
`Requirement` (+`RequirementVersion`, `RequirementLine` with commercial `master_snapshot`),
`Rfq` (extended: requirement link, mode, deadlines, published audit) + `RfqLine` + `RfqInvitation`
(INVITED→VIEWED→INTENDS_TO_QUOTE→QUOTED | DECLINED), `Clarification` (OPEN→ANSWERED; BUYER_PRIVATE|PUBLIC),
`Quotation` + immutable `QuotationVersion` + `QuotationLine` (original quoted qty/UoM immutable;
normalized metadata + conversion version alongside — OD-07/08), `Award` + `AwardLine`
(Σ awarded ≤ requirement qty; buyer_consent for deviations), `SourcingNote` (ops desk).
QUICK/EVENT/FORMAL are modes of one Requirement — no parallel lightweight model.
See docs/STATE_MACHINES.md and docs/SECURITY_MODEL.md.

## Authoritative synchronous contract interactions (ADR-010)
Two cross-context interactions are authoritative and synchronous by design (owner-approved ADR-010):
- **Order/Allocation ↔ Supply/Inventory**: reservation/allocation ownership is confirmed
  synchronously through each context's exported contract (`buyerHasLotAllocation`,
  `reserveAndAllocate`, `releaseForOrder`). Physical stock ownership is never derived from a
  stale projection.
- **Order/Allocation ↔ Logistics/Cold-chain**: `hasBlockingException` is read synchronously by
  the buyer-acceptance transition guard (ADR-002/§21) so an open severe temperature excursion
  holds acceptance/settlement based on current state.
Both interactions cross contexts only via exported contracts/ports. All other cross-context
reads compose through one-directional contracts or the transactional outbox.
