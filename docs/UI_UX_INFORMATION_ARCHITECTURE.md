# UI/UX Information Architecture — FloraSetu Redesign

Canonical token/component values live in `/app/design_guidelines.json` (design-system source
of truth). This document defines WHERE things live and WHO sees them.

## 1. Five shells, one codebase

Role router at `/` after login: resolves the active org's category + membership role →
redirects to the user's shell home. Shells share components/backend; they never share screens.

| Shell | Route root | Who | Primary device |
|---|---|---|---|
| Buyer | `/buyer/*` | buyer org members (HOTEL, EVENT_ORGANISER, FLORIST, CORPORATE, RETAILER, PROCESSOR…) | mobile-first |
| Supplier | `/supplier/*` | GROWER, GROWER_GROUP, WHOLESALER, IMPORTER, AGGREGATION_HUB | mobile-first |
| Partner | `/partner/*` | QC_PARTNER (`/partner/qc`), COLD_CHAIN_PARTNER / hub (`/partner/hub`), LOGISTICS_PROVIDER (`/partner/logistics`) | field/mobile |
| Operations | `/ops/*` | FloraSetu staff org: PROCUREMENT_OPS, QC_AGENT, FINANCE_OPS, SUPPORT roles | desktop-first |
| Admin | `/admin/*` | FloraSetu staff org: PLATFORM_ADMIN | desktop-first |

Users holding roles in several shells (e.g. platform owner testing) get a **WorkspaceSwitcher**
in the header. A user with a role in shell X never sees shell Y's navigation.

Existing routes map into shells 1:1 (no page is deleted, only re-homed):
`/demand/quick` → `/buyer/requests/new`; `/demand/rfqs*` → `/buyer/offers*`; `/orders*` →
`/buyer/orders*`; `/supply/inbox` → `/supplier/requests`; `/supply/quotes` → `/supplier/offers`;
`/supply/orders` → `/supplier/orders`; `/supply/lots*` → `/supplier/supply*`; `/ops/qc|tower|desk|finance`
→ unified `/ops/*`; `/admin` → `/admin/organizations`; `/catalog*` → admin + read-only catalog
inside buyer/supplier "More". Legacy paths 301-redirect client-side for the pilot window.

## 2. Organization-first frame (all shells)

Every shell header shows, always:
```
[FloraSetu]   [Vedant Events ▾  · Buyer organization]        [🔔 3]  [Nagesh K. ▾]
                Nagesh Kumar · Organization Admin
```
- `OrganizationHeader` = org name + org category + user name + org role. Tap → `WorkspaceSwitcher`
  (switch org, and shell if multi-role).
- Transactions, lists and confirmations always read "as Vedant Events". Switching org re-fetches
  shell data and lands on shell home.
- `/buyer/org` (resp. `/supplier/org`, under "More") hosts: business profile, KYB wizard,
  members & invites, bank/payout (supplier-side), security (MFA), documents.

## 3. Navigation structures

### Buyer
- Mobile bottom nav (5, cap enforced): **Home · Offers · Orders · Events · More**
- Home: [GET FLOWERS] [PLAN AN EVENT] hero actions → ActionCenter ("3 new offers",
  "delivery arriving today", "order needs acceptance") → Recent orders → Buy again → Recent events.
- Desktop sidebar: Home, Get Flowers, Events, Offers, Orders, Deliveries, Issues; org/settings under header.
- Deliveries = orders filtered to in-transit/arriving (same data, decision-oriented view).

### Supplier
- Mobile bottom nav: **Home · Requests · Supply · Orders · More** (More: Offers, Payments, Company, Documents).
- Home answers "what needs my attention today?": New requests / Quotes due / Orders to fulfil /
  Lots awaiting QC / Payment status — each a TaskCard with one action.
- Persistent quick action: **[+ Add supply]** (camera-first).

### Partner — QC (pilot scope; hub/driver phase 2)
- Field shell, no sidebar. Header: task switcher (To inspect / Inspected today). One column of
  large lot cards → INSPECT NOW. Camera + 48px+ targets.

### Operations (exception-first)
- Desktop: left nav = queues, grouped by discipline; top filter bar (city, date, risk); home = `/ops/exceptions`.
- Queues (from existing tower endpoint): Needs sourcing · RFQs closing without offers · Supply shortage ·
  QC hold · Packing delay · Delivery at risk · Open claims · Payment exceptions · Settlement exceptions ·
  KYB reviews pending.
- Role filtering: PROCUREMENT_OPS sees sourcing/RFQ/supply/delivery; QC_AGENT sees QC queues;
  FINANCE_OPS sees payment/settlement; PLATFORM_ADMIN sees all. Same `/ops` URL space — the queue
  list is filtered, not hidden behind different routes.
- Row click → SideSheet with entity context + primary action (convert award, resolve hold, verify
  payment, …) — no full-page navigation for routine clears.

### Platform Admin (control plane)
- Desktop sidebar: Organizations · KYB governance · Users & access · Roles & permissions ·
  Catalog standards · Grade profiles · Handling profiles · Configuration · Feature flags · Security · Audit logs.
- Never used for procurement execution; cross-link "Open in Operations" for escalation only.

## 4. Cross-shell rules

1. The same entity renders differently per shell: an order is a **timeline** for the buyer,
   a **fulfilment task** for the supplier, an **exception candidate** for ops.
2. Deep links carry shell context: a notification "3 offers received" opens `/buyer/offers?req=…`.
3. Terminology per audience (see DESIGN_SYSTEM §Status & microcopy); backend codes never change.
4. Every list has: skeleton loading, guided empty state, permission-denied screen, retryable error.
5. Every destructive/irreversible action (award, dispatch, POD, settlement complete, KYB decision)
   uses ConfirmationDialog with plain-language consequence text.
