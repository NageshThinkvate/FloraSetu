# UI/UX Design System — FloraSetu "Premium Botanical B2B"

Machine-readable tokens + component specs: `/app/design_guidelines.json` (source of truth).
This document is the human-readable contract.

## 1. Design intent

Calm, premium, trustworthy B2B commerce with botanical warmth. Field-readable in Indian sun
(light theme, high contrast). "Show the decision and the next action — not the internal
complexity that produced it." No ERP-chrome, no wedding-pink, no agri-green overload, no
gradients-as-decoration, no dashboard confetti.

## 2. Color (light theme default)

| Token | Value | Use |
|---|---|---|
| `green` primary | `#183D33` (hover `#123028`, active `#0D221C`, tint `#E8EFEB`) | primary actions, key nav, brand |
| `plum` accent | `#76518F` (hover `#624177`, tint `#F3EEF6`) | SPARINGLY: premium markers, verified badges, event accents |
| background | `#F8F8F5` warm ivory | page |
| surface | `#FFFFFF` / muted `#F0F0EA` | cards, sheets |
| border | `#E2E2D8` soft / `#C5C5B8` strong | hairlines |
| text | `#18201D` / secondary `#4F5854` / tertiary `#808A85` | |
| success | `#135436` on `#E6F4ED` | |
| warning | `#7A4D05` on `#FEF7E6` | |
| error | `#821B1B` on `#FDF2F2` | |
| info | `#1A4971` on `#EFF6FC` | |

Contrast policy: ≥ 4.5:1 body text, ≥ 3:1 large text; primary pairs (#183D33/white) exceed 11:1.
Real colour comes from **flower/lot photography**, not UI chrome. Dark mode: out of scope for
pilot (field glare); revisit for night-hub logistics later.

## 3. Typography

Inter (fallback Noto Sans family incl. Devanagari/Tamil/Telugu for Indian scripts).
Scale: Display 36/44 · H1 30/38 · H2 24/32 · H3 20/28 · H4 16/24 · Body-L 16/20 ·
Body 14/20 · Caption 12/16 · Overline 11/14 caps +0.08em.
All prices, quantities, lot numbers, percentages use `font-variant-numeric: tabular-nums`.
Operational screens cap at H2; Display/H1 reserved for shell homes and empty states.

## 4. Space, shape, elevation

- Spacing scale: 4 8 12 16 20 24 32 40 48 64 — nothing off-scale.
- Radius: 14px cards · 10px nested · 6px buttons/inputs.
- Borders over shadows: 1px `#E2E2D8`; single soft card shadow only for floating layers
  (drawers, popovers, sticky bars).
- Not everything is a card: whitespace + overline section labels separate groups on one surface.
- Grids: mobile 1-col (360/390/412) · tablet 6-col (768) · desktop 12-col with 260–300px
  sidebar (1024/1280/1440/1920); forms max-width 768px even on 1920px.

## 5. Status design (never colour alone)

`StatusPill` = icon + human label + subtle semantic tint. Backend codes stay unchanged in API/audit.

Buyer-facing mapping (full table in design_guidelines.json `status_vocabulary_and_microcopy_mappings`):
- `QC_PENDING` → "Quality check pending" · `READY_FOR_DISPATCH` → "Ready to ship" ·
  `IN_TRANSIT` → "On the way" · `ACCEPTANCE_PENDING` → "Delivery awaiting your confirmation" ·
  `PARTIALLY_AWARDED` → "Some flowers confirmed" · `CLAIM_OPEN` → "Issue being reviewed" ·
  `KYB_*` → "Verification not started / under review / action needed / verified".
- Supplier-facing: `PENDING_CONFIRMATION` → "New order — confirm you can fulfil", etc.

Microcopy map: Requirement→**Request** · RFQ→(hidden; "offers for your request") ·
Quotation→**Offer** · Award→**Select offer / confirmed** · Claim→**Report an issue** ·
Inventory lot→**Supply lot / batch** · Inspection→**Quality check** · Settlement→**Payout**.
Formal terms survive only in ops/admin/audit surfaces.

## 6. Motion (sparing)

150ms ease-out micro (hover/press) · 250ms cubic-bezier(0.16,1,0.3,1) drawers/sheets ·
350ms progress/step transitions · success confirmation tick 400ms once.
`prefers-reduced-motion: reduce` → all motion becomes instant opacity.
No parallax, no animated gradients, no decorative motion in operational screens.

## 7. Iconography & imagery

- Lucide only (`lucide-react`), 16/20px, always with a visible or sr-only label.
- Transaction screens show **real content imagery**: lot photos, variety thumbnails, QC evidence.
  Zero stock heroes inside flows. Marketing imagery is confined to logged-out pages.
- `FlowerThumbnail` renders lot media → variety catalogue image → botanical initial tile, in that order.

## 8. Voice

Sentence case. Verbs on buttons ("Get offers", "Confirm delivery"). Errors answer
*what happened + what to do now*: "We couldn't submit your offer because the quote deadline
passed. Ask FloraSetu to extend it or decline the request." Never "Error 400 / EXCEEDS_ALLOCATED".

## 9. Accessibility floor (WCAG 2.2 AA)

Keyboard-complete flows; 2px `#183D33` focus ring with 2px offset; semantic headings;
label per input; `aria-live="polite"` for toasts/status changes; icon buttons have aria-labels;
44px touch targets; tables get `<caption>`/scope; status never colour-only; dialogs trap focus
and restore it on close.
