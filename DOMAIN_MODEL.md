# Domain Model — FloraSetu (Build 0 freeze)

Single source of truth: Master Spec v2.0. This file narrates the ERD (docs/02) and the invariants (docs/04, docs/06).

## Bounded contexts & core aggregates
1. **Identity & Party** — `Organization` (buyer/supplier/both), `User`, `Membership`, `Role/Permission`, `KycRecord` (immutable), `BankAccount` (immutable history) + `BankChangeRequest` (PENDING_REVERIFICATION, dual approval — ADR-004), `AuthIdentity` (OIDC subject — ADR-006), `MfaEnrollment`.
2. **Catalog & Standards** — `Category → Commodity → Variety`, canonical `UnitOfMeasure`, versioned effective-dated `GradeStandard`, `PackType`.
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
