# UI/UX Responsive Rules — FloraSetu Redesign

Desktop and mobile are deliberate designs, not scaled copies. Tokens: design_guidelines.json.

## 1. Breakpoints (test targets)

| Name | Width | Layout |
|---|---|---|
| mobile-sm | 360px | 1 col, 16px page padding, bottom nav |
| mobile-md | 390px | same (primary design target) |
| mobile-lg | 412px | same |
| tablet | 768px | 6-col grid, 24px padding, bottom nav → slim top nav |
| desktop-sm | 1024px | 8-col + 260px sidebar |
| desktop-md | 1280px | 12-col + 280px sidebar |
| desktop-lg | 1440px | 12-col + 280px sidebar, content max-w 1280 centered |
| desktop-xl | 1920px | 12-col + 300px sidebar, content max-w 1536 centered; forms still ≤768px |

## 2. Mandatory mobile rules

- No uncontrolled horizontal scrolling anywhere (only intentional card carousels scroll-x).
- Touch targets ≥ 44px (48px in Partner field shell).
- Primary action uses StickyMobileActionBar, positioned above keyboard + safe-area inset
  (`env(safe-area-inset-bottom)`); keyboard must never hide the active CTA.
- All selects with >7 options are SearchableSelect (bottom sheet on mobile with search input).
- Tables never render on <768px — DataTable auto-switches to MobileDataCard stack.
- No hover-only affordances (hover = progressive enhancement only).
- Camera-first capture uses `<input type="file" accept="image/*" capture>` + thumbnail queue.
- Clear back navigation on every pushed screen (top-left chevron + screen title).
- Form drafts survive navigation (sessionStorage keyed by form id) and offline submit queues
  with visible "will retry" state.
- Fixed headers only on list/queue screens; content screens scroll naturally.

## 3. Component behavior by breakpoint

| Component | Mobile (<768) | Desktop (≥1024) |
|---|---|---|
| OfferComparison | stacked OfferCards, "best value" first, expand for freight/specs | 4–6 column table: supplier · spec match · qty · price · landed status · delivery · deviation · validity · action; row → SideSheet for UoM normalization, packing, handling, freight components, version history |
| OrderTimeline | vertical stepper, current step card w/ owner + ETA | horizontal stepper + right detail panel |
| DataTable | MobileDataCard (primary metric + 2 fields + action) | full table, sticky header + sticky right action column |
| Forms | single column, sticky submit bar | 2-col grid inside 768px max-width; advanced sections collapsed |
| Drawers | bottom sheet (drag handle, safe-area) | right SideSheet 480px |
| KYB reviewer | stacked: status → docs → decision bar | split 50/50: metadata+timeline | document viewer |
| Ops board | exception cards only, filters in a sheet | queue columns + filter bar + SideSheet detail |
| Shell nav | bottom nav (≤5) + More sheet | sidebar + top org bar |

Tablet (768–1023): single-column content with 6-col grid cards; bottom nav persists;
tables may render 3-column max with card fallback below 3 columns.

## 4. Performance experience

- Route-level code splitting per shell (buyer bundle never ships admin charts).
- SkeletonLoader matching final layout (no spinners, no layout shift).
- Lot/QC photos: thumbnail (≤480w) in lists, full on demand; `loading="lazy"`, progressive.
- Lists paginate/infinite-scroll at 25 items; counts come from server.
- Optimistic UI only for safe toggles (notification read, org switch); never for money/QC/POD.
- Bundle budget: initial shell ≤ 250KB gzip JS; images served compressed via media pipeline.

## 5. Acceptance checks (per screen)

Screenshots at 360/390/412/768/1024/1440/1920; keyboard walkthrough; reduced-motion pass;
voiceover rotor smoke on buyer home, quick request, QC inspection, KYB wizard.
