# UI/UX User Journeys — FloraSetu Redesign

Each journey lists the target flow (backend chain is the accepted Builds 0–4 chain; the UI
translates it). Wireframes for the 13 key screens: `/app/design_guidelines.json`
`structured_text_wireframes_13_screens` (embedded summaries in UI_UX_SCREEN_REDESIGN_PLAN.md).

## 1. Buyer

1. **Join** — Register → create org (category explained in one line each) → land in a
   capability-aware Business Verification wizard (UX-ADR-003): required items derive from org
   type/capabilities + policy, progress shows dynamic counts ("3 of 4 required items"), and
   buyer-only orgs are never asked for supplier payout bank details. Browsing works, ordering
   unlocks as policy allows.
2. **Get flowers** — Home [GET FLOWERS] → pick flower (search + photo grid, recents first) →
   quantity + unit (visible smart preselection — buyer always sees and confirms the unit;
   the request submits an explicit `uom_id`; UX-ADR-005) → needed by (quick chips: Tomorrow morning / Date+time) →
   delivery place (saved org addresses + one-off) → Review → **Get offers**.
   Confirmation: "Request sent — we're sourcing offers. We'll notify you." (~60 seconds.)
   Advanced specs (grade, stem length, bloom stage, pack, substitution, notes, photos) live
   under **More specifications** — same Requirement payload as today.
3. **Compare & select** — Notification + ActionCenter card "3 offers received" → offer cards
   (supplier, Verified ✓, est. total, full/partial quantity, spec match ✓/!, delivery promise,
   freight included?, deviation flag) → compare (cards on mobile, table on desktop) with neutral,
   deterministic default ordering and user-controlled sorting (price, delivery, quantity coverage,
   specification compliance, validity) — no automatic "best value"/"recommended" labels (UX-ADR-004) →
   **Select offer** → plain-language confirmation ("Ooty Farms will supply 500 Red Naomi,
   ₹21,000, delivery tomorrow by 6 AM") → deviation consent step only when flagged.
4. **Track** — Order page = timeline (Offer selected → Supplier confirmed → Quality check →
   Packed → On the way → Delivered → Confirmed) + "what's next" card (owner + expected time) +
   QC photos when available. No raw statuses.
5. **Receive** — delivery arriving today card → driver/POD info → **Confirm delivery** (accept /
   partial accept with disputed qty) → done, or **Report an issue** (photo-first) — order shows
   "Issue being reviewed" until resolved; adjustment appears on the invoice summary.
6. **Repeat** — Home "Buy again" re-creates last request prefilled (new request via existing
   requirement create — no backend change).

## 2. Supplier

1. **Join & qualify** — register/org/KYB wizard → capabilities ("Flowers you supply") via
   searchable variety picker (kills the UUID form) → matching improves; empty state says so.
2. **Daily** — Home: *New requests (3) · Quotes due today (2) · Orders to fulfil (1) ·
   Lots awaiting QC (1) · Payout pending ₹1,42,000* — each card deep-links to the work queue.
3. **Quote** — Request card → detail (spec chips, qty, needed-by, destination, deadline) →
   [Quote] builder: per-line qty (prefilled = requested) + unit price, validity, delivery
   commitment, freight included/extra, deviation note with example placeholder; live total;
   submit → "Offer sent". Revise = same builder prefilled + reason. [Decline] needs a reason
   (chips: price, quantity, date, other). [Ask buyer] = clarification thread.
4. **Fulfil** — "New order — confirm you can fulfil 500 Red Naomi by tomorrow 6 AM"
   [Confirm order] → add/choose supply lot (camera-first: photos → flower → qty → harvest time →
   submit for QC) → QC outcome notification ("480 accepted, 20 rejected — bruising") →
   pack against order (lot picker with photos + available qty) → mark packed →
   dispatch details (vehicle/courier ref, ETA) → in-transit.
5. **Get paid** — Payments tab: order → gross → deductions/adjustments → net → payout status
   (Recorded → Verified → Paid + UTR ref). Claims against the supplier appear as "Issue tickets"
   with respond action + evidence.

## 3. Partner — QC / Grader (pilot)

1. Open field shell → "Lots awaiting inspection" cards: photo, flower, supplier, declared qty,
   age badge ("received 3h ago").
2. **INSPECT NOW** → full-screen inspection: lot photos zoomable, declared vs measured,
   big-stepper quantities (Accepted / Rejected / On hold), defect picker (chips, multi),
   mandatory evidence photo when rejected>0, notes → **Complete quality check** →
   conflict-of-interest interstitial if inspecting own org (requires ops override reason — preserved).
3. Done → next lot card (queue stays the home).

(Hub receiving + Driver trips are phase 2 shells — see REDESIGN_PLAN §Deferred.)

## 4. Operations

1. `/ops` home = exception board, filtered to the staffer's discipline; every card: what,
   who (buyer/supplier), age, risk, [primary action].
2. Clear work via SideSheet (order mini-timeline, lot balances, payment record) — approve/verify/
   resolve/convert without page jumps; hard stops read as plain rules ("Settlement is frozen —
   supplier changed bank details; verification pending").
3. Escalations cross-link to Admin (KYB governance) — never the reverse.

## 5. Platform Admin

1. `/admin` home = control plane summary (orgs awaiting KYB, suspended orgs, flags on, system
   health) → modules in sidebar.
2. **KYB governance**: queue → reviewer split view (org claims vs document viewer vs immutable
   timeline) → Approve / Request correction (reason picker + note) / Reject (reason mandatory).
3. Users & access, roles (read-mostly matrices), catalog standards (existing catalog admin
   re-homed), grade/handling profiles, configuration, feature flags, security (MFA policy,
   sessions), audit log search (trace_id-first).

## 6. Cross-cutting journeys

- **Org switch** — header switcher; switching re-scopes all data and shows a brief
  "Now acting as Ooty Floral Farms" toast.
- **Notifications** — bell → action-oriented feed ("3 suppliers responded to your Rose request"
  [Compare offers]); read/unread; deep links into the right shell screen.
- **Error recovery** — every mutation error shows what happened + next step + preserves the
  draft (forms keep state; sticky bar stays).
