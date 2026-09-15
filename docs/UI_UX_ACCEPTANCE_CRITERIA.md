# UI/UX Acceptance Criteria — FloraSetu Redesign

Verification happens per phase (REDESIGN_PLAN §7) and at final sign-off. All criteria are
testable; the testing agent runs them with the standard accounts in `/app/memory/test_credentials.md`.

## 1. Architecture & shells
- [ ] A buyer-account session sees ONLY `/buyer/*` navigation; hitting `/ops`, `/admin`,
  `/supplier` routes redirects or shows a styled permission-denied screen (not raw JSON/403 text).
- [ ] Same for supplier / partner / ops / admin accounts (5 shells verified independently).
- [ ] Every screen shows active organization name + category + user name + role; switching org
  re-scopes data and confirms via toast.
- [ ] `/` renders the role router, never the module-architecture page.

## 2. Design system conformance
- [ ] Computed styles match tokens in `/app/design_guidelines.json` (colors, Inter type scale,
  spacing scale, 14/10/6px radii); zero hardcoded hex outside tokens; dark theme removed.
- [ ] No raw backend status strings render anywhere in buyer/supplier shells (grep + visual pass);
  every status uses StatusPill (icon + label).
- [ ] No user-facing input asks for a UUID anywhere (grep placeholder/labels).
- [ ] Prices/quantities use tabular-nums; sentence-case microcopy; Lucide icons only.

## 3. Journeys (must-demo)
- [ ] Buyer completes Get Flowers in ≤ 60 seconds with only flower/qty/date/delivery visible
  (advanced specs behind disclosure); confirmation sets expectation, no RFQ jargon.
- [ ] Buyer compares ≥2 offers as cards at 390px and as a table at 1440px; selects an offer;
  sees plain-language confirmation.
- [ ] Buyer order page shows timeline + next-action owner + ETA; confirm-delivery and
  report-issue (photo-first) complete successfully against the real API.
- [ ] Supplier: home shows the 5 attention cards with live counts; quote builder submits and
  revises; camera-first supply intake (photo → flower → qty → submit) works from a phone frame;
  pack/dispatch complete from the fulfilment screen.
- [ ] QC: queue card → inspect → accepted/rejected/held + defect + evidence photo → complete;
  rejected-without-photo is blocked with a human message.
- [ ] Ops: exception board shows live queues; resolving a shipment exception / verifying a
  payment works from a SideSheet without page navigation.
- [ ] Admin: KYB reviewer approves / requests-correction (reason required) / rejects with the
  split document view; the org's wizard reflects the correction with the reason shown.
- [ ] KYB wizard: 5 steps with progress, per-step status, real document upload, and the
  correction round-trip (reviewer correction → org sees reason → re-submit → approve).

## 4. Responsive matrix
- [ ] Every shell screen renders without horizontal scroll at 360/390/412/768/1024/1440/1920.
- [ ] No DataTable renders as a table below 768px (MobileDataCard stack instead).
- [ ] Touch targets ≥44px (48px in partner shell); sticky CTAs clear the keyboard + safe area.
- [ ] Forms preserve drafts across navigation; mutation errors show recovery text and keep input.

## 5. States & accessibility
- [ ] Every screen demonstrates skeleton loading, guided empty state, success, recoverable error,
  permission-denied (and offline-retry on mobile shells).
- [ ] Keyboard-only walkthrough completes: buyer request, offer select, order accept; QC inspect;
  KYB decision. Visible 2px focus ring throughout.
- [ ] `prefers-reduced-motion` disables transitions; aria-live announces toasts/status changes;
  axe-core pass: 0 critical violations on the 13 wireframed screens.

## 6. Performance
- [ ] Initial shell bundle ≤ 250KB gzip (buyer); route-level code splitting per shell.
- [ ] Lists paginate at 25; images lazy + compressed; no layout shift on load (CLS < 0.1).

## 7. Regression & guardrails
- [ ] Full backend gate stays green: `npx jest test/e2e --runInBand` (Builds 0–4) — the redesign
  must not touch business logic, domain states, authorization, or audit controls.
- [ ] All existing `data-testid` flows that remain relevant keep working (or are deliberately
  renamed in the new screens with tests updated in the same change).
- [ ] API diff review: only B1 (KYB), B2 (notifications feed), B3 (comparison supplier card)
  added; zero modifications to existing accepted endpoint behavior.

## 8. Sign-off artifacts
- [ ] Screenshot matrix (7 breakpoints × 13 key screens) attached to the acceptance report.
- [ ] Journey videos/GIFs for the 6 must-demo flows.
- [ ] Updated SCREEN_INVENTORY.md reflecting the five shells.
