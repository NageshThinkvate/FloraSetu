# UI/UX Component Inventory — FloraSetu Redesign

Build once in `apps/web/src/components/` (shadcn primitives from `components/ui/` where they
exist). Every interactive element gets a kebab-case `data-testid`. Existing ad-hoc
`panel / plain-list / inline-form / state-chip / module-tile` classes are retired by these.

## Shell & frame
- **AppShell** — per-shell frame: header + nav outlet + toast host. Variants: buyer / supplier / partner / ops / admin.
- **MobileShell** — bottom nav + safe-area handling + offline banner slot.
- **DesktopSidebar** — collapsible, section groups, active state, badge counts (queues).
- **MobileBottomNav** — max 5 destinations, active pill, badge counts.
- **WorkspaceSwitcher** — org + role + shell switch; lists orgs with status (KYB, suspended).
- **OrganizationHeader** — org name, category, user, role; opens WorkspaceSwitcher.
- **PageHeader** — overline (section), H1/H2 title, primary action slot, breadcrumb/back.

## Action & decision
- **ActionCenter** — prioritized "needs you" list; item = icon + sentence + CTA + age.
- **PrimaryActionCard** — the one big thing (Get flowers / Add supply / Inspect now).
- **TaskCard** — queue item: title, 2–3 meta fields, StatusPill, age, primary action.
- **MetricCard** — single number + label + delta; max 3 per row; never decorative charts.
- **StickyMobileActionBar** — primary (+optional secondary) action above keyboard/safe area.
- **ConfirmationDialog** — consequence-first copy for irreversible actions (award, dispatch, POD, settlement complete, KYB decision).

## Domain display
- **StatusPill** — icon + human label + semantic tint (mapping table in DESIGN_SYSTEM §5).
- **FlowerSpecChip** — grade / stem length / bloom stage / colour chips from spec snapshot.
- **FlowerThumbnail** — lot photo → catalogue image → botanical initial fallback.
- **OfferCard** — supplier name, Verified badge, est. total (tabular-nums), coverage, spec match, delivery, freight, deviation flag, [View details] [Select offer].
- **OfferComparison** — responsive comparison (cards↔table per RESPONSIVE_RULES §3).
- **PriceBreakdown** — qty × unit, freight, deductions, adjustments, net; tabular numerals.
- **OrderTimeline** — plain-language steps with timestamps; current step carries owner + expected time ("FloraSetu QA — expected today 2 PM").
- **ProgressStepper** — KYB / quick-request steps with completed checks.
- **EvidenceGallery** — photo grid, zoom, timestamp, purpose tag (lot / QC / POD / claim).
- **DocumentViewer** — PDF/image viewer used by KYB reviewer + document screens.
- **AuditTimeline** — immutable event list (who/when/what) for KYB + order history.

## Data & input
- **DataTable** — desktop table (sticky header/actions, sort, caption+scope) with automatic **MobileDataCard** fallback <768px.
- **SearchableSelect** — async search (catalog products/varieties, orgs, lots); bottom-sheet on mobile; kills every "paste a UUID" input.
- **FilterBar** — chips + date/city pickers for ops/admin queues.
- **SideSheet** (desktop 480px) / **Drawer** (mobile bottom) — contextual detail without navigation.
- **ResponsiveFormSection** — titled group, helper text, progressive disclosure ("More specifications").
- **Toast** (sonner) + **InlineAlert** + **ExceptionBanner** (blocking holds: "Delivery confirmation paused — temperature check under review").
- **EmptyState** — illustration-free: icon + one-line why + primary next action.
- **SkeletonLoader** — layout-matched placeholders for every async region.

## Mapping from current UI (delete → replace)
`module-tile` grid (architecture page) → deleted · `state-chip` → StatusPill ·
`plain-list` → TaskCard/MobileDataCard · `inline-form` → ResponsiveFormSection + StickyMobileActionBar ·
`data-table`/`table-wrap` → DataTable · `org-pill` (account page) → WorkspaceSwitcher ·
`auth-card` → kept, restyled to tokens.
