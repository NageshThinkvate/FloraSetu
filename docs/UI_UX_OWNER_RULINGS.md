# UI/UX Owner Rulings — Pilot UX Remediation V1 (ACCEPTED 2026-09)

Register of OWNER-APPROVED rulings that amend the derived UX specification documents.
These rulings override conflicting statements in the `UI_UX_*.md` documents but do NOT
override Master Specification v2.0. Backend/domain behavior is unchanged.

| Ruling | Title | Amends |
|---|---|---|
| UX-ADR-001 | Workspace routing is capability + role based | UI_UX_INFORMATION_ARCHITECTURE.md §1 |
| UX-ADR-002 | Platform Admin is not Operations by default | UI_UX_INFORMATION_ARCHITECTURE.md §3 (Ops) |
| UX-ADR-003 | KYB is organization/capability aware | UI_UX_USER_JOURNEYS.md §1.1, UI_UX_SCREEN_REDESIGN_PLAN.md B7/S8, UI_UX_ACCEPTANCE_CRITERIA.md §3 |
| UX-ADR-004 | No unapproved "best value" recommendation | UI_UX_USER_JOURNEYS.md §1.3, UI_UX_RESPONSIVE_RULES.md §3, UI_UX_SCREEN_REDESIGN_PLAN.md B3, UI_UX_ACCEPTANCE_CRITERIA.md §3 |
| UX-ADR-005 | Explicit UoM remains mandatory (ADR-008/OD-07) | UI_UX_USER_JOURNEYS.md §1.2 |
| UX-ADR-006 | Offline scope narrowed | UI_UX_RESPONSIVE_RULES.md §2 |
| UX-ADR-007 | Backend delta control (B1–B3 only; audit-read = UX-B4-PENDING) | UI_UX_SCREEN_REDESIGN_PLAN.md A4–A8 |
| UX-ADR-008 | Shareable request links deferred post-pilot | UI_UX_SCREEN_REDESIGN_PLAN.md §3 (Phase-2 deferred), backlog |

## UX-ADR-001 — Workspace routing is capability + role based
Workspace availability derives from organization capabilities + user membership + assigned
roles + permissions + feature/jurisdiction gates — never from organization category alone.
A wholesaler may legitimately hold BOTH buyer and supplier workspaces. Multi-workspace users
switch explicitly via WorkspaceSwitcher; navigation of multiple workspaces is never silently mixed.

## UX-ADR-002 — Platform Admin is not Operations by default
PLATFORM_ADMIN alone must NOT expose Operations queues/actions as a daily working environment.
Platform Admin = configuration, security, organizations, access, standards, flags, audit/governance.
Operations = procurement, quality, fulfilment, support, claims, finance, exceptions.
A user holding both authorized roles sees both workspaces separately via WorkspaceSwitcher.
Least privilege and separation of duties are preserved.

## UX-ADR-003 — KYB is organization/capability aware
The Business Verification journey derives required items from organization type/capabilities
and applicable policy — not a fixed identical 5-step flow for everyone. Foundation items:
business identity, tax/legal identifiers where applicable, address, authorized-user/business
documents, required compliance documents. Supplier/payout-capable organizations additionally
require payout bank account + bank verification + bank-change controls. Buyer-only organizations
are never asked for supplier payout information without business/legal need. Progress displays
dynamic counts ("3 of 4 required items"). Data minimization applies.

## UX-ADR-004 — No unapproved "best value" recommendation
Offers are never auto-labelled Best Value / Recommended / Best Offer during pilot, and never
silently ranked by an invented formula. Comparison provides neutral user-controlled
sorting/filtering (price, delivery, quantity coverage, specification compliance, validity).
Default ordering is neutral and deterministic. Any future recommendation engine must be
versioned, auditable and clearly labelled, and requires separate owner approval.

## UX-ADR-005 — Explicit UoM remains mandatory
"Smart default" UoM is a visible UI preselection only. The buyer sees the selected UoM before
submission; the submitted request explicitly contains `uom_id`. Never silently infer or persist
a hidden UoM. ADR-008 / OD-07 remains authoritative.

## UX-ADR-006 — Offline scope
No generic offline mutation queue for commercial actions. Local draft persistence allowed:
quick request drafts, event drafts, quote drafts, forms. Offline queued mutation limited to
field workflows requiring resilience (QC draft/evidence, lot/media capture where safely
idempotent). NEVER queued offline: award selection, payment verification, settlement completion,
bank change approval, KYB reviewer approval, other high-risk financial/security actions — these
require authoritative online confirmation.

## UX-ADR-007 — Backend delta control
Only B1 (structured KYB submission/review + real media/documents), B2 (notification feed/read
API), B3 (offer-comparison supplier public display data) are authorized. No accepted API
behavior may be modified for convenience. The Admin audit-read endpoint: inspect current APIs
first; reuse if adequate; otherwise record as **UX-B4-PENDING** and request owner approval
during Admin Phase 7. Never silently add it.

## UX-ADR-008 — Shareable request links deferred
WhatsApp/shareable event/request approval links are NOT part of pilot UI/UX implementation.
No public/share tokens or external sign-off links in this redesign. Post-pilot backlog only.
