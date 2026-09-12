# 02 — Master Domain ERD (Build 0, full schema incl. later-phase tables)

Authoritative store: PostgreSQL 15 + PostGIS. Money = integer minor units (BIGINT). All timestamps TIMESTAMPTZ, UTC. Every major object has internal `id UUID` (PK) + public human-readable `ref` (e.g. `LOT-2026-000123`) via per-entity counters. `org_id` on every tenant-owned table (org isolation). Soft-delete only on ordinary mutables; historical/financial/auction/KYC/custody/quality records are immutable (no updated_at/deleted_at; enforced by trigger + revoke UPDATE/DELETE).

Contexts: **IP**=Identity&Party · **CS**=Catalog&Standards · **SI**=Supply&Inventory · **DR**=Demand/Events/RFQ · **AM**=Auction&Market · **OA**=Order&Allocation · **QT**=Quality&Traceability · **LC**=Logistics&ColdChain · **PS**=Payments&Settlement · **CX**=Claims&Support · **NT**=Notifications · **AN**=Analytics&ControlTower · **XC**=cross-cutting infra.

```
IP.organizations ──< IP.org_memberships >── IP.users ──< IP.auth_identities
IP.users ──< IP.mfa_enrollments
IP.organizations ──< IP.user_roles >── IP.roles ──< IP.role_permissions >── IP.permissions
IP.organizations ──< IP.bank_accounts            (immutable history, protected)
IP.bank_accounts ──< IP.bank_change_requests     (PENDING_REVERIFICATION, dual approval)
IP.organizations ──< IP.kyc_records              (immutable)

CS.categories ──< CS.commodities ──< CS.varieties
CS.units_of_measure (canonical units)
CS.grade_standards (versioned, effective-dated) >── CS.commodities
CS.pack_types

SI.terminals (PostGIS geography)  SI.warehouses >── IP.organizations
SI.supply_lots >── CS.varieties, SI.warehouses          (available_qty, reserved_qty, allocated_qty CHECKs; ADR-001)
SI.supply_lots ──< SI.inventory_reservations            (status machine; never oversell via row lock)
SI.supply_lots ──< SI.availability_forecasts            (reduction preserves committed reservations)
SI.availability_forecasts ──< SI.supply_risk_events     (raised when forecast < committed)

DR.demand_intents >── IP.organizations
DR.procurement_events ──< DR.rfqs ──< DR.rfq_lines
DR.rfqs ──< DR.rfq_invitations >── IP.organizations
DR.rfq_lines ──< DR.rfq_bids >── IP.organizations(supplier)
DR.rfq_lines ──< DR.rfq_awards                          (MULTI-SUPPLIER award; sum(awarded)<=line qty)
  rfq_lines.allow_partial_fill, minimum_acceptable_quantity (default all-or-nothing; ADR-001)

AM.auctions ──< AM.auction_lots >── SI.supply_lots
AM.auction_lots ──< AM.bids                             (immutable)
AM.auction_lots ── AM.auction_results                   (immutable)
AM.market_price_snapshots                               (immutable, append-only)

OA.orders >── IP.organizations(buyer)
OA.orders ──< OA.order_lines >── CS.varieties
OA.order_lines ──< OA.allocations >── SI.supply_lots    (transactional row locking)
OA.orders ──< OA.order_status_history                   (immutable)

QT.qc_inspections ──< QT.qc_results >── CS.grade_standards
QT.supply_lots(SI) ⇢ QT.traceability_links              (lot genealogy, immutable)
QT.custody_events                                       (immutable chain-of-custody)
QT.certificates ── XC.media_objects

LC.shipments >── OA.orders
LC.shipments ──< LC.shipment_legs >── LC.routes (PostGIS)
LC.shipment_legs ──< LC.temperature_readings            (append-only)
LC.temperature_readings ⇢ LC.temperature_excursion_events (immutable; ADR-002)
LC.shipments ──< LC.shipment_exceptions                 (HOLD / PENDING_REVIEW)
LC.handling_profiles (versioned, effective-dated severity policy; ADR-002)
  shipment acceptance: acceptance_hold flags buyer acceptance / supplier settlement gating

PS.invoices >── OA.orders            (amount_minor BIGINT)
PS.invoices ──< PS.payments
PS.payouts >── IP.organizations      (states incl. SUBMITTED_IRREVERSIBLE; ADR-004)
PS.settlements                       (immutable; ADR-003)
PS.settlements ⇢ PS.financial_adjustments ──< PS.recoveries  (post-settlement claims; ADR-003)
PS.webhook_events UNIQUE(provider, provider_event_id)          (ADR-005 dedupe)
PS.payment_provider_refs

CX.claims >── OA.orders / PS.settlements
CX.claims ──< CX.claim_evidences ── XC.media_objects
CX.claims ──< CX.claim_decisions     (immutable)
CX.support_tickets ──< CX.ticket_messages

NT.notification_templates (versioned, effective-dated)
NT.notifications ──< NT.notification_deliveries
IP.users ──< NT.push_subscriptions   (web push now)
IP.users ──< NT.device_tokens        (FCM/APNs later; ADR-006 abstraction)

AN.kpi_definitions (versioned, effective-dated)
AN.analytics_snapshots (append-only)
AN.control_tower_alerts
AN.dashboard_configs >── IP.organizations

XC.outbox_events        (transactional outbox; id, type, payload, occurred_at, published_at)
XC.idempotency_keys     (UNIQUE(org_id, key, endpoint), request_hash, response, expires_at)
XC.audit_events         (immutable audit log; actor, action, object, before/after)
XC.security_audit_events(failed webhook signatures, authz denials, privileged actions)
XC.feature_flags        (effective-dated: key, enabled, valid_from/valid_to)
XC.config_entries       (effective-dated versioned config masters)
XC.media_objects        (S3 keys, signed private access only)
XC.reference_counters   (per-entity public ref sequences)
```

Cross-context edges are **logical references by ID only** (no cross-schema FKs to tables owned by another context where it would couple deployments; enforced FKs only within a context). Details: 03-module-boundaries.md, 05-table-inventory.md.
