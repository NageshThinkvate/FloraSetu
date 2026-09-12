# Security Model — FloraSetu (Build 3 scope)

Extends `docs/09-authorization-design.md`. This document captures the Build 3
(Demand/Events/RFQ/Quotation/Award) security surface.

## 1. Authentication & context

- Email/password (bcrypt) login; HMAC bearer access token (15 min) + rotating
  refresh token (7 d); optional TOTP MFA. (Build 1)
- Every request runs through trace middleware → auth middleware → `RbacGuard`.
- Org context is resolved per request from the `X-Org-Id` header against live DB
  membership — never from client-supplied permission claims. Dev/test tokens may
  carry claims directly (test harness only).
- Suspended orgs lose transactional privileges (reads retained). Build 3 adds
  `event.write, demand.write, demand.submit, rfq.publish, quote.submit,
  award.create` to the transactional set.

## 2. Permissions (Build 3 additions, seeded in migration 010)

| Permission | Purpose | Roles |
|---|---|---|
| event.read / event.write | Events, ceremonies, BOM | MEMBER+ / ORG_ADMIN+ |
| demand.read / demand.write / demand.submit | Requirements lifecycle | MEMBER+ / ORG_ADMIN+ / ORG_ADMIN+ |
| rfq.read / rfq.publish / rfq.manage | RFQ read, publish/cancel, ops management | MEMBER+ / ORG_ADMIN+ / PROCUREMENT_OPS |
| quote.read / quote.submit / quote.evaluate | Read, submit/revise, compare quotes | MEMBER+ / supplier ORG_ADMIN+ / buyer ORG_ADMIN+ |
| award.read / award.create | Read, create awards | MEMBER+ / ORG_ADMIN+ |
| procurement.manage | Managed Procurement Desk | PROCUREMENT_OPS, PLATFORM_ADMIN |

`PROCUREMENT_OPS` is a system role (org_id NULL) seeded in migration 010.

## 3. Object-level authorization (tenant isolation)

- Cross-org existence is never revealed: foreign objects return **404**, not 403.
- Buyer reads/writes are scoped to `org_id = context org`.
- Suppliers interact with an RFQ only with a non-declined invitation row.
- Supplier RFQ view excludes all competitor data (own invitation + lines only).
- Quote reads: owning supplier, buyer, or ops only.
- Award reads: buyer/ops see all lines; suppliers see only their own award lines.
- Clarifications: supplier sees own questions + PUBLIC answered; buyer sees all.
- Ops (`procurement.manage`) may read across tenants for desk work; every ops
  action (sourcing note, requirement revision on behalf) is audit-recorded, and
  cross-org requirement revision requires recorded buyer consent.

## 4. Write-path protections

- Idempotency-Key header mandatory on: requirement submit, RFQ publish, quote
  submit, quote revise, award create. Claim → execute → complete inside one
  transaction; replays return the stored response.
- Concurrency: state transitions lock the aggregate row (`FOR UPDATE`); award
  quantity invariants lock requirement lines; one-open-RFQ per requirement via
  partial unique index; one quotation per supplier per RFQ via unique index.
- Immutability (OD-08): supplier original `quoted_qty`/`quoted_uom_id` and prior
  versions are never updated; revisions insert new version rows.
- Commercial-master eligibility (Guardrail B): server-side re-validation on every
  requirement line write — master must exist, be ACTIVE + VALIDATED (or DEMO only
  when `CATALOG_ALLOW_DEMO_MASTERS=true` outside production), inside its effective
  window, with valid UOM. The env flag is a hard startup error in production
  (Guardrail A — fail closed).
- UOM (OD-07): explicit `uomId` mandatory on every requirement/quote line
  (`UOM_REQUIRED`); normalization only via ACTIVE versioned conversion, originals
  preserved.
- Award consent: deviations or substitution proposals in a quoted line require
  explicit `consentAcceptedDeviations` recorded in `award.buyer_consent`.
- Self-dealing: supplier cannot award itself; catalog validators cannot
  self-approve (Build 2), distinct approvers on bank changes (Build 1).

## 5. Audit & events

- All mutations write `core.audit_events` (action, object, before/after, actor)
  inside the same transaction as the mutation.
- Domain events go through the transactional outbox (`rfq.published`,
  `quote.submitted`, `award.created`, `demand.cancelled`, …) — payloads versioned,
  additive-only.
- Notifications are queued per org after commit (dev WEB_PUSH channel in Build 3;
  provider delivery deferred via OD-04/05).

## 6. Data classification

- Money in minor units (BIGINT) + CHAR(3) currency.
- Supplier pricing is visible only to its owner, the buyer, and ops.
- Requirement/quote/award history is retained (version tables); cancellations
  record actor + reason and never delete rows.
