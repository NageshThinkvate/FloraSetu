# Architecture Decisions — FloraSetu

Status legend: **RESOLVED — OWNER APPROVED** (all six). Master Spec v2.0 remains the single source of truth; no conflict.

## ADR-001 — Quantity / Partial Fill — RESOLVED — OWNER APPROVED
- Server-authoritative quantities; DB-enforced `available_qty / reserved_qty / allocated_qty` on `supply_lots` with CHECK constraints; never oversell.
- Default **all-or-nothing**; opt-in `allow_partial_fill` + `minimum_acceptable_quantity` per lot / RFQ line.
- Forecast reduction preserves committed reservations; shortfall raises `SupplyRiskEvent`.
- RFQ **multi-supplier award** is distinct from single-supplier partial fill.
- Implementation: SI context (lot CHECKs, reservation row locks `SELECT … FOR UPDATE`), DR context (rfq_awards, fill flags). See docs/06.

## ADR-002 — Cold-Chain Excursion Handling — RESOLVED — OWNER APPROVED
- Immutable `TemperatureExcursionEvent` + `ShipmentException` records.
- Optional HOLD / PENDING_REVIEW gating buyer acceptance and supplier settlement.
- No auto-claim creation.
- Severity computed via **versioned effective-dated handling-profile policy table** (`handling_profiles`), resolved at `occurred_at`.
- Implementation: LC context. See docs/05, docs/06.

## ADR-003 — Post-Settlement Claims — RESOLVED — OWNER APPROVED
- Settlements are immutable.
- Corrections via new `Claim` + `FinancialAdjustment`/`Recovery` (generic term; provider mechanism deferred).
- Implementation: PS (immutable settlements, adjustments/recoveries) + CX (claims). See docs/05.

## ADR-004 — Payout / Bank Change Safety — RESOLVED — OWNER APPROVED
- Bank change → `PENDING_REVERIFICATION` + payout freeze; protected historical bank records (new immutable row per change, never mutated).
- Dual approval (two distinct approvers, DB CHECK).
- Distinct `SUBMITTED_IRREVERSIBLE` payout state — no path back once submitted.
- Implementation: IP (bank_change_requests, bank_accounts history) + PS (payouts state machine). See docs/06.

## ADR-005 — Duplicate Webhook Handling — RESOLVED — OWNER APPROVED
- Dedupe on `UNIQUE(provider, provider_event_id)`, independent of client idempotency keys.
- Signature verification **outside/before** the DB transaction; failures logged to the security audit stream.
- Duplicate delivery = success ack, zero side effects.
- Implementation: common webhook ingress + PS `webhook_events`. See docs/07.

## ADR-006 — Mobile Convertibility — RESOLVED — OWNER APPROVED (added)
- Single React codebase, wrappable via Capacitor later; zero native code in Build 0.
- Bearer-token/OIDC auth valid in native webviews — no cookie-only sessions (`auth_identities` provider/subject model).
- Device features (camera/QC capture, push) behind abstraction interfaces (`common/device`, `web/lib/platform`).
- Notification gateway: web push now, FCM/APNs later via `device_tokens`.
- Media via signed URLs (cross-platform).
- Implementation: web PWA shell + interface layers. See docs/01, docs/09.

## Tooling deviation (owner-approved)
Backend tooling deviates from environment default (NestJS + PostgreSQL + Redis vs FastAPI + MongoDB template). Approved by owner as part of Build 0 authorization.

## ADR-007 — Master-data versioning & canonical identity (Build 2) — RESOLVED — OWNER APPROVED (per Build 2 authorization)
- Canonical product identity lives in `catalog.commodities`; market/botanical synonyms live in `catalog.product_aliases` with a case-insensitive active-alias unique index. Aliases never spawn duplicate products.
- Grade profiles, pack definitions, unit conversions, handling profiles are **versioned effective-dated** rows (`version_no` server-assigned, DRAFT→ACTIVE→RETIRED, `effective_from/to`); overlapping ACTIVE windows per natural key are rejected (409 VERSION_OVERLAP). Historical references resolve old versions forever; no destructive edits of referenced definitions (status transitions only).
- Unit conversions are product/pack-scoped configuration (never global assumptions); service rejects from==to, unknown/inactive UoMs, non-positive factors, and circular conversion chains (graph check at write time).
- Handling *requirement* profiles live in `catalog.handling_profiles`; excursion *severity* policy stays in `logistics.handling_profiles` (ADR-002). Two tables, two purposes — recorded to avoid confusion.
- Every master record carries `data_classification` DEMO|VALIDATED; seeds are DEMO except canonical UoM codes (VALIDATED structure). DEMO is never presented as a validated commercial standard.
- Grade rules are declarative JSONB referencing the `quality_attributes` dictionary (codes, not English labels); unknown codes rejected at write.
- Transport compatibility is metadata-only in Build 2 (`transport_compatibility_rules`); no shipment blocking.
