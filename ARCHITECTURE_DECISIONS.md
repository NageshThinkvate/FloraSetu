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
