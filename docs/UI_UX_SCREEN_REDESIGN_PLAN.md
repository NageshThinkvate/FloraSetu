# UI/UX Screen Redesign Plan — FloraSetu

Screen inventory per shell. Wireframes (desktop+mobile) for the 13 key screens live in
`/app/design_guidelines.json → structured_text_wireframes_13_screens`; summaries inline below.
"API" lists existing accepted endpoints (no change) unless marked **[NEW]** (see FORENSIC_AUDIT §C).

## 1. BUYER shell (`/buyer/*`)

### B1. Buyer Home — `/buyer/home` (redesign of `/` + `/demand`)
Purpose: decision-first home. User: buyer org admin/staff. Primary: GET FLOWERS; secondary: PLAN AN EVENT.
Hierarchy: Org header → hero actions → ActionCenter (offers waiting, questions, delivery today, acceptance due) → Recent orders → Buy again → Recent events.
Mobile: hero 2-up, action cards stacked, bottom nav. Desktop: sidebar + 2-col content.
Empty: "No requests yet — get flowers in about a minute." Loading: skeleton cards. Error: retry banner.
Permissions: demand.read. API: `GET /demand/requirements`, `GET /demand/rfqs`, `GET /orders`, `GET /notifications` **[NEW B2]** (composed client-side into action items).
Wireframe: guidelines #1 (hero CTAs → ACTION NEEDED → recent orders/events; mobile bottom nav Home/Offers/Orders/Events/More).

### B2. Quick Request — `/buyer/requests/new` (redesign of `/demand/quick`)
Purpose: ~1-minute flower request. Primary action: Get offers.
Hierarchy: flower SearchableSelect (photos) → qty+unit → needed-by quick chips → delivery address → [More specifications: grade, stem length, bloom stage, pack, substitution, notes, attachments] → review → submit.
Mobile: single column + sticky "Get offers" bar; draft preserved. Desktop: 768px form, right summary rail.
Empty/error: inline validation; deadline-past style guidance. Permissions: demand.write.
API: `POST /demand/requirements` (+ submit), `GET /catalog/search`, `GET /catalog/units` — unchanged; success screen replaces raw status dump.
Wireframe: guidelines #2.

### B3. Offers inbox + comparison — `/buyer/offers`, `/buyer/requests/:id/offers` (redesign of `RfqsPage` + `RfqDetailPage` comparison)
Purpose: pick a supplier with confidence. Primary: Select offer.
Hierarchy: per request → OfferCards in a neutral, deterministic default order; sorting/filtering
is strictly user-controlled (price, delivery, quantity coverage, specification compliance,
validity). No automatic "Best value / Recommended / Best offer" labels and no invented ranking
formula (UX-ADR-004); desktop table with progressive SideSheet detail (UoM normalization, packing, handling, freight, terms, version history).
Mobile: stacked cards (no ranking badges). Desktop: comparison table + SideSheet.
Empty: "No offers yet — we're sourcing suppliers for your request." Permissions: quote.evaluate, award.create.
API: `GET /demand/rfqs/:id/comparison`, `POST /demand/rfqs/:id/awards` — unchanged; **[NEW B3]** supplier display name + verified flag in payload.
Wireframe: guidelines #4 (mobile offer cards; desktop feature-row table — neutral default order per UX-ADR-004).

### B4. Order tracking — `/buyer/orders`, `/buyer/orders/:id` (redesign of `OrdersPage` + `OrderDetailPage`)
Purpose: answer what happened / what's next / who owns it / when. Primary (state-dependent): Confirm delivery / Report an issue.
Hierarchy: OrderTimeline → Next-action card → delivery & QC evidence → order summary (PriceBreakdown) → payout/claim states collapsed → audit "Activity" at bottom. Ops lifecycle buttons/UUID forms NEVER render here.
Mobile: vertical timeline + sticky action. Desktop: timeline left, detail rail right.
Permissions: order.read, delivery.accept, claim.create. API: `GET /orders`, `GET /orders/:id`, `POST /orders/:id/accept`, `POST /claims`, pack/shipment/POD reads — all unchanged.
Wireframe: guidelines #5.

### B5. Events — `/buyer/events`, `/buyer/events/:id` (redesign of `EventsPage` + `EventDetailPage`)
Purpose: event-centric sourcing. Primary: Get offers for event.
Hierarchy: event header (name, dates, venue) → coverage banner ("87% covered · 4 offers · 2 flowers still sourcing") → ceremony timeline (Mehendi/Sangeet/…) → per-ceremony flower cards with sourcing status → [Get offers] per unmet line (drafts EVENT requirement via existing flow, mechanics hidden).
Mobile: ceremony chips + flower cards. Desktop: timeline + BOM table→cards.
Empty: "Add your first ceremony to start sourcing." Permissions: event.write, demand.write.
API: `events`, `bom-lines`, `requirements` (mode EVENT) — unchanged.
Wireframe: guidelines #3.

### B6. Issues — `/buyer/claims*` (redesign of ClaimsPage/ClaimDetailPage)
Purpose: report + track problems. Photo-first create from order; detail = status timeline, evidence gallery, counterparty response, resolution + adjustment.
API: claims endpoints unchanged. Permissions: claim.create.

### B7. Organization & KYB — `/buyer/org/*` (redesign of AccountPage)
Purpose: company profile, **Business Verification wizard** (capability-aware required items per
UX-ADR-003 — dynamic step count with progress, per-step status, correction loop, real uploads;
payout bank steps only for supplier/payout-capable orgs), members/invites, security (MFA), documents.
API: existing org/member/MFA endpoints + **[NEW B1]** KYB structured endpoints.
Wireframe: guidelines KYB external wizard (ProgressStepper "Step 3 of 5").

## 2. SUPPLIER shell (`/supplier/*`)

### S1. Supplier Home — `/supplier/home` (new)
Purpose: "what needs my attention today?" Cards: New requests · Quotes due · Orders to fulfil ·
Lots awaiting QC · Payout status. Quick action [+ Add supply].
Empty: "No new requests — add the flowers you supply to improve matching."
API: compose from `rfqInbox`, `listMyQuotes`, `orders/allocations/mine`, `supply/lots`, `finance/settlements/mine` — unchanged.
Wireframe: guidelines #6 (task cards + quick actions; bottom nav Home/Requests/Supply/Orders/More).

### S2. Requests — `/supplier/requests` + detail (redesign of `SupplierInboxPage` + `SupplierRfqPage` read side)
Request cards: flower, spec chips, qty, needed-by, destination, quote deadline countdown;
detail adds buyer terms + clarification thread. Actions: [Quote] [Decline w/ reason chips] [Ask buyer].
API: inbox/rfq/clarification endpoints unchanged.
Wireframe: guidelines #7.

### S3. Quote builder — `/supplier/requests/:id/quote` (redesign of SupplierRfqPage form side)
Progressive: per-line qty (prefilled=requested) + unit price → validity → delivery commitment →
freight → deviation (human placeholder) → live total → submit. Revision = same builder + reason.
API: `POST /demand/rfqs/:id/quotes`, `POST /demand/quotes/:id/revise` — unchanged.
Wireframe: guidelines #8.

### S4. My offers — `/supplier/offers` (redesign of MyQuotesPage)
Cards per offer: request, qty, price, status ("Under review / Selected / Not selected"), validity.
API: `listMyQuotes` unchanged.

### S5. Supply — `/supplier/supply`, camera-first `/supplier/supply/new`, lot detail (redesign of LotsPage/LotDetailPage)
Flow: photos first (camera/sheet) → flower (SearchableSelect) → qty → variety/grade expectation →
harvest/received time → submit → "Submit for quality check" when ready.
Lot detail: balances in words ("480 sellable · 40 packed for order ORD-…"), media gallery,
custody timeline, guided hold resolution ("5 stems on hold — how many are sellable after all?").
API: supply/lots + media + custody endpoints unchanged.
Wireframe: guidelines #9.

### S6. Orders to fulfil — `/supplier/orders` (+ order fulfilment detail) (redesign of SupplierOrdersPage + supplier slice of OrderDetailPage)
Confirm order → allocate-by-ops visibility → pack (lot picker with photos/available) → dispatch
details (mode, vehicle/AWB ref, ETA, temp-controlled toggle in plain words) → track.
API: allocations confirm, pack, shipments create/dispatch — unchanged.

### S7. Payments — `/supplier/payments` (redesign of settlements section)
Per settlement: gross → deductions → claim adjustment → net → payout status pill → UTR ref.
Issue tickets (claims against supplier) with respond + evidence.
API: settlements/mine, claims respond — unchanged.

### S8. Company — `/supplier/org/*` — as B7 plus capabilities management (SearchableSelect variety
picker replacing the UUID form) and bank/payout profile (with freeze-status explanation).

## 3. PARTNER shell (`/partner/*`) — pilot: QC

### P1. QC queue — `/partner/qc` (redesign of QcQueuePage)
Field tool. Lot task cards: photo, flower, supplier, declared qty, age, hub. [INSPECT NOW].
Empty: "No lots waiting for inspection." API: `GET /quality/queue` unchanged.

### P2. QC inspection — `/partner/qc/:lotId` (redesign of inspect/complete panels)
Full-screen: evidence photos zoom → declared vs actual → big steppers Accepted/Rejected/Held →
defect chips (multi) → mandatory defect photo when rejected>0 → notes → Complete quality check.
Own-org conflict → interstitial explaining ops override requirement (preserved control).
48px targets, no tables, offline-tolerant draft.
API: `POST /quality/inspections`, `POST /quality/inspections/:id/complete` (+ media) — unchanged.
Wireframe: guidelines #10.

### Phase 2 (deferred): `/partner/hub` receiving/batching, `/partner/logistics` driver trips
(Today's trips → pickup → load confirm → transport → delivery → POD). Requires **[NEW B4]**
trip-assignment endpoint — explicitly post-pilot. Shareable/WhatsApp request-approval links are
also post-pilot only (UX-ADR-008): no public/share tokens or external sign-off links in this redesign.

## 4. OPERATIONS shell (`/ops/*`)

### O1. Ops home — `/ops/exceptions` (redesign+merge of ControlTowerPage, OpsDeskPage, QcQueuePage list role, FinancePage queues)
Exception-first board filtered by staff discipline (procurement/QC/finance/support). Every row:
TaskCard — what, who, age, risk, [primary action]; click → SideSheet context + action
(convert award, verify payment, verify/complete settlement, resolve exception, open order/claim/lot).
API: `GET /tower/exceptions` + existing action endpoints — unchanged.
Wireframe: guidelines #11 (queue cards + live monitor; mobile = stacked exception cards).

### O2–O6. Queue workspaces — `/ops/sourcing`, `/ops/quality`, `/ops/logistics`, `/ops/claims`, `/ops/finance`
Re-home existing screens as filtered workspaces: sourcing desk (requirements, RFQ monitoring,
managed publish), quality (inspections list, conflict overrides), logistics (shipments,
excursions), claims (evidence, decisions with reason capture), finance (record/verify/complete
with dual control, adjustments). Finance forms get SearchableSelect for order/supplier instead of UUID inputs.
API: all existing — unchanged.

## 5. ADMIN shell (`/admin/*`)

### A1. Admin home — `/admin` (redesign of AdminPage)
Control-plane summary + module grid: Organizations · KYB governance · Users & access ·
Roles & permissions · Catalog standards · Grade profiles · Handling profiles · Configuration ·
Feature flags · Security · Audit logs.
Wireframe: guidelines #13.

### A2. Organizations — `/admin/organizations` (redesign of org table)
DataTable (desktop) / cards (mobile): name, category, status, KYB, city; row → org detail
SideSheet (profile, members, KYB status, suspend/lift with reason, bank change approvals).
API: existing admin orgs + bank change endpoints — unchanged.

### A3. KYB reviewer — `/admin/kyb/:orgId` (redesign of AdminPage KYB buttons)
Split view: org claims/metadata (left) vs DocumentViewer + immutable review timeline (right) →
sticky decision bar: [Approve] [Request correction — reason picker + note] [Reject — reason
mandatory]. Mobile: stacked with bottom decision bar.
API: **[NEW B1]** KYB review endpoints (documents, detail, correction reasons).
Wireframe: guidelines #12.

### A4–A8. Catalog standards (re-home CatalogAdminPage), Grade/Handling profiles, Users & access
(member/role matrices, invites), Configuration + Feature flags, Security (MFA/session policy),
Audit logs (search by trace_id/org/actor/object). Per UX-ADR-007: inspect existing audit-read
APIs first and reuse if adequate; if none suffices, record **UX-B4-PENDING** and request owner
approval during Phase 7 — never silently add the endpoint (audit events table exists from Build 0).

## 6. Screens to remove / merge

- `/` AppShell module navigator (internal architecture page) → **deleted**, replaced by role router.
- `DemandHomePage` role-mixed link farm → split into B1/S1.
- `OpsDeskPage` + `ControlTowerPage` + `QcQueuePage` + `FinancePage` as separate top-level
  destinations → merged under O1–O6.
- `AccountPage` → split into per-shell `/org/*` (B7/S8) + security section.
- `CapabilitiesPage` UUID form → replaced by S8 capabilities with SearchableSelect.
- Raw transition buttons panel on order detail → removed from buyer view (ops keep it inside O2/O4 context sheets).

## 7. Build sequence (estimation)

| Phase | Scope | Depends on |
|---|---|---|
| 1 | Design tokens + component library (AppShell variants, nav, StatusPill, cards, DataTable, forms, sheets, dialogs, empty/skeleton/error) | — |
| 2 | Role router + five shells + org header/switcher + notifications bell | 1, **[B2]** |
| 3 | Buyer shell (home, quick request, offers, order timeline, events, issues, org+KYB wizard) | 1, 2, **[B1, B3]** |
| 4 | Supplier shell (home, requests, quote builder, supply camera-first, fulfilment, payments, company) | 1, 2 |
| 5 | Partner QC field shell | 1, 2 |
| 6 | Ops console merge (exception board + workspaces) | 1, 2 |
| 7 | Admin control plane + KYB reviewer | 1, 2, **[B1]** |
| 8 | Responsive/AA hardening pass at all breakpoints + acceptance checklist sign-off | 3–7 |

Backend work (B1 KYB structured flow, B2 notifications feed, B3 supplier card in comparison)
lands in parallel with phases 2–3. No business-logic, state-machine, or authorization changes.
