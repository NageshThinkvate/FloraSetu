# UI/UX Forensic Audit — FloraSetu (Builds 0–4 frontend, audited 2026-09-15)

Method: full code-level audit of every screen in `apps/web/src/pages/` + shell + tokens
(`shell/AppShell.tsx`, `shell/ModuleNavigator.tsx`, `index.css`), all 28 routes in
`App.tsx`, and the KYB/bank flows. Master Spec v2.0 is the source of truth; backend
state machines and APIs are treated as fixed unless explicitly flagged.

Severity: **P0** blocks pilot / broken journey · **P1** major UX confusion ·
**P2** significant usability/consistency · **P3** cosmetic.

---

## A. Global / structural findings

| # | Severity | Finding | Evidence |
|---|---|---|---|
| G1 | **P0** | **No role shells.** One generic top-nav shows up to 18 links to every user (Procurement, Orders, Inbox, Fulfilment, Lots, Claims, Catalog, Capabilities, Catalog admin, Ops desk, QC, Tower, Finance, Account, New organization, Admin). Buyer, supplier, ops and admin share one undifferentiated app. | `App.tsx` `Nav()` — ops links gated only by role, everything else shown to all |
| G2 | **P0** | **Home is an internal architecture page.** `/` renders `AppShell` — 12 module-tiles describing bounded contexts ("Supply & Inventory — lots with DB-enforced available/reserved/allocated (ADR-001)"). Internal engineering vocabulary is the first thing a florist sees. | `shell/AppShell.tsx`, `shell/ModuleNavigator.tsx` |
| G3 | **P0** | **KYB is functionally broken as a flow.** External side: a single button "Submit KYB document" that POSTs a **hardcoded fake document** (`objectKey: kyb/<id>/gst.pdf, byteSize: 1024`) — no real upload, no GST/PAN/address/bank steps, no per-step status, no correction loop. Reviewer side: two buttons (Verify / Reject) with a **hardcoded** reason `'documents unclear'`, no document viewer, no evidence, no timeline. | `AccountPage.tsx` kyb-submit-btn; `AdminPage.tsx` kyb-verify/reject-btn |
| G4 | **P0** | **Organization identity is invisible at work time.** No active-org header, no org switcher in the shell; org switching lives only as text pills inside `/account`. Transactions are org-scoped (X-Org-Id) but the UI never shows which org you are acting for. | `Nav()`; `AccountPage.tsx` orgs-panel |
| G5 | **P1** | **Ops and Platform Admin are mixed and thin.** "Ops desk", "QC", "Tower", "Finance" are four separate nav links with no unified exception-first console; "Admin" is a single page (org table + suspend + KYB buttons + bank approvals) with no control-plane IA (users/roles/flags/security/audit missing from UI). | `AdminPage.tsx`, `OpsDeskPage.tsx`, `ControlTowerPage.tsx`, `FinancePage.tsx` |
| G6 | **P1** | **Raw backend status codes are the UI vocabulary.** Chips render `PENDING_CONFIRMATION`, `READY_FOR_DISPATCH`, `SUPPLY_CONFIRMED`, `STOCK_RECEIVED`, `PARTIALLY_AWARDED` verbatim, uppercase monospace. | every page (`state-chip`) |
| G7 | **P1** | **Raw UUIDs are requested from users.** "Variety UUID" (capabilities), "Grade profile ID (optional UUID)" + "Lot UUID" (lots/allocate), "Order UUID" + "Supplier org UUID" (finance), exception IDs (tower). Non-technical pilot users cannot operate these. | `CapabilitiesPage.tsx`, `LotsPage.tsx`, `OrderDetailPage.tsx`, `FinancePage.tsx` |
| G8 | **P1** | **Visual system is off-direction.** Dark mono theme (`#101812` bg, IBM Plex Mono body, Fraunces display) with bright leaf-green buttons — reads as a developer console, not premium botanical B2B (target: warm ivory light theme, deep botanical green, Inter). | `index.css` `:root` |
| G9 | **P1** | **No buyer decision surfaces.** No "Action needed" area, no notifications surface anywhere (no bell, no feed), no buyer-facing offer cards; comparison is a raw table of quote refs (`QO-…` v1, quoted vs normalized columns). | `RfqDetailPage.tsx` quote-comparison table |
| G10 | **P1** | **Ops mechanics are exposed to buyers.** Order detail shows manual lifecycle buttons (ALLOCATING / QC_PACK / READY_FOR_DISPATCH / CLOSED / CANCELLED) + free-text reason to any `order.manage` holder (every org admin). | `OrderDetailPage.tsx` order-transitions |
| G11 | **P2** | **Mobile navigation is a wrapping link bar** (up to 18 links, 2–3 rows). No bottom nav, no 5-destination cap, no sticky primary CTA. | `index.css` `.top-nav` |
| G12 | **P2** | **State coverage is minimal.** Loading = the word "Loading…" (no skeletons); empty = one hint line; no permission-denied screens (403s surface as raw error text); no offline/retry affordance. | all pages |
| G13 | **P2** | **Supply intake is a database form, not camera-first.** Lot creation asks for qty/UoM/origin/dates/UUIDs up front; photo upload is a secondary file input on the detail page. | `LotsPage.tsx`, `LotDetailPage.tsx` |
| G14 | **P2** | **QC workbench is not a field tool.** Two-panel inspect form with a **JSON textarea** for measurements and a grade-profile UUID field; small touch targets; no photo evidence in the flow. | `QcQueuePage.tsx` |
| G15 | **P2** | **Event UX is RFQ-mechanics-first.** Ceremonies/BOM added via raw inline forms; "Draft requirement from BOM" exposes requirement objects; no coverage %, offer counts, or event timeline summary. | `EventDetailPage.tsx` |
| G16 | **P2** | **Buyer and supplier surfaces are interleaved.** `/demand` shows "My RFQs" next to "Supplier inbox" and "My quotations" to both roles. | `DemandHomePage.tsx` |
| G17 | **P3** | No consistent component system — ad-hoc `panel`/`plain-list`/`inline-form` per page; duplicate list/detail patterns per page; no shared OfferCard/TaskCard/StatusPill. | all pages |
| G18 | **P3** | Accessibility gaps: no focus-visible ring beyond border-color, status chips are text-only uppercase (no icon), tables lack captions/scope, no aria-live for toasts, no reduced-motion handling. | `index.css` |
| G19 | **P3** | No imagery strategy — zero flower/lot thumbnails in lists where photos exist (lots have media; orders could show variety thumbs). | Lots/orders pages |

---

## B. Critical journey audit (per step)

Format: **Current page → problem (severity) → target → backend change needed?**

### Buyer journey
1. **Register/Login** → OK base (MFA step exists, friendly 401). P3: no org context post-login; lands on `/account` or architecture page. → Role router to `/buyer/home`. Backend: no.
2. **Organization onboarding** (`/onboarding`) → single-category form, gated categories disabled with no explanation (P2). → Guided org setup with category explainer + KYB handoff. Backend: no.
3. **KYB** → **P0 broken** (see G3). → 5-step wizard (Business details → GST/PAN → Address → Documents → Bank) with progress, per-step status, correction loop, real document upload via `/media`. Backend: **yes** — KYB detail/document-list endpoints (see REDESIGN_PLAN §Backend).
4. **Get Flowers** (`/demand/quick`) → best current screen (4 fields + submit) but after submit dumps user onto requirement/RFQ status pages (P1). → 1-minute flow: Flower → Qty → Needed by → Delivery → Review → Get offers; confirmation = "We're sourcing offers" + notify. Backend: no (compose).
5. **Receive/Compare offers** (`RfqDetailPage`) → P1: raw quote table, refs, normalized jargon, radio+qty inline, deviation consent checkbox unlabeled in human terms. → OfferCards (mobile) / comparison table (desktop) with supplier name, verified badge, est. total, spec match, delivery, freight, deviation flag, [Select offer]. Backend: comparison endpoint exists; needs supplier display name/verified flag in payload (**small API addition** or client-side org-name resolution).
6. **Order tracking** (`OrderDetailPage`) → P1: 11 stacked panels, raw statuses, ops transition buttons, UUID forms, payment/settlement forms visible to buyer admin. → Timeline-first order page: what happened / what's next / who owns it / when expected; buyer actions only (accept delivery, report issue, view QC evidence). Backend: no (timeline derived from status history).
7. **Delivery acceptance** → exists (accept form + dispute) ✓ but buried mid-page. → Sticky "Review delivery" action when ACCEPTANCE_PENDING. Backend: no.
8. **Report issue** → exists (claim create + submit). P2: no evidence prompt at create. → Issue wizard with photo-first evidence. Backend: no (claim accepts mediaObjectIds already).

### Supplier journey
1. **Register/Org/KYB** → same as buyer (KYB P0).
2. **Capabilities** (`CapabilitiesPage`) → **P1**: requires "Variety UUID" typed by hand — unusable. → SearchableSelect over catalog varieties. Backend: no (catalog search exists).
3. **Receive request** (`SupplierInboxPage`) → P2: cards show title + raw invitation status + ref; no flower/qty/deadline hierarchy. → Request cards: flower, spec chips, qty, needed-by, destination, quote deadline, [Quote] [Decline] [Ask]. Backend: inbox endpoint exists; card needs line summary (already in payload via detail fetch — client compose OK).
4. **Submit offer** (`SupplierRfqPage`) → P2: functional but raw (line refs, UoM dropdown of codes, deviation free text; "Intend to quote" mechanic exposed). → Progressive quote builder: per-line qty+price prefilled from request, validity, delivery commitment, freight inclusion, deviation with human label; live total. Backend: no.
5. **Award → confirm** → exists (allocations/mine + confirm). P2: shows raw refs/statuses. → "New order — confirm you can fulfil" card. Backend: no.
6. **Create supply/lot** → P1 (G13). → Camera-first intake. Backend: no.
7. **QC wait / hold resolution** → exists (submit QC, resolve hold) ✓ but hold resolution is two bare number inputs. → Guided split UI ("5 stems on hold: how many sellable?"). Backend: no.
8. **Pack/dispatch** → exists via order detail pack form + shipment create. P2: UUID lot selection dropdown shows truncated IDs. → Lot picker cards with photo + available qty. Backend: no.
9. **Settlement status** → list exists on fulfilment page ✓. P2: no "expected payout" narrative. → Payments tab with status pills + payout ref. Backend: no.

### Partner / QC journey
- **QC queue** (`QcQueuePage`) → P1 (G14). → Field tool: lot task cards (photo, flower, supplier, qty, age) → INSPECT → big-number accepted/rejected/held + defect picker + mandatory evidence photo on rejection. Backend: no (defects + mediaObjectIds already supported).
- **Driver view** → **does not exist** (P2 for pilot; dispatch is ops-driven today). → Phase-2 `/partner/logistics` trips view. Backend: **would need** a trip-list endpoint (shipments by driver/vehicle assignment) — defer, ops dispatches manually in pilot.

### Operations journey
- Base exists and is genuinely strong: `ControlTowerPage` aggregates 15 exception queues with actions. P1: split across 4 top-level links (desk/QC/tower/finance), no role-filtered home, raw IDs, tables everywhere. → Unified `/ops` exception-first console, queues filtered by ops role (procurement/QC/finance/support), every row = TaskCard with owner + age + primary action. Backend: no (tower endpoint sufficient).

### Platform Admin journey
- P1 (G5): single org table page. → Control plane: Organizations, KYB governance, Users & access, Roles, Catalog standards, Grade/handling profiles, Configuration, Feature flags, Security, Audit. Catalog admin + capabilities + KYB reviewer already exist as functionality but scattered. Backend: mostly no; audit-log viewer endpoint exists (`/admin` audit surfaced in Build 1 tests via DB — **needs a read API** for audit logs UI, P2).

---

## C. Backend changes genuinely required (full list — nothing else)

| # | Change | Why | Size |
|---|---|---|---|
| B1 | KYB: structured submission (gst/pan/address fields), document upload via real media objects, per-document status, correction-reason storage, reviewer document list/detail endpoint | KYB wizard + reviewer console cannot be built on today's single `documents[]` POST + verify/reject buttons | M |
| B2 | Notifications feed endpoint (`GET /notifications` from existing notifications tables/outbox) for bell + action-needed items | Bell + action center; tables exist from Build 0 | S |
| B3 | Offer comparison payload: supplier org display name + KYB verified flag (or a `/orgs/:id/public-card` lookup) | OfferCards must show "Supplier A · Verified" not UUIDs | S |
| B4 | (Deferred, post-pilot) Driver trip-list endpoint for `/partner/logistics` | No driver assignment model today | M (later) |

Everything else composes client-side from existing accepted APIs. No state-machine, authorization, or business-logic changes.

---

## D. What is already good (keep)

- Quick Request 4-field core; order accept/dispute + claim create; supplier confirm allocation; lot media + custody timeline (data model); control tower queue aggregation; pack/dispatch/POD flows; finance dual-control UX (record ≠ verify error states); idempotency + trace-id plumbing; data-testid coverage ~90%.
