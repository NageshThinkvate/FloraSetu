import { useState } from 'react';
import { CalendarDays, Flower2, PackagePlus } from 'lucide-react';
import {
  ConfirmationDialog,
  DataTable,
  Drawer,
  EmptyState,
  ExceptionBanner,
  InlineAlert,
  Logo,
  MetricCard,
  OrganizationHeader,
  PageHeader,
  PrimaryActionCard,
  ResponsiveFormSection,
  SearchableSelect,
  SideSheet,
  SkeletonLoader,
  StatusPill,
  StickyMobileActionBar,
  TaskCard,
  type DataColumn
} from '../components';
import { ShellFrame } from '../shell/ShellFrame';

const SWATCHES: [string, string][] = [
  ['Primary', '--fs-primary'],
  ['Primary hover', '--fs-primary-hover'],
  ['Primary tint', '--fs-primary-tint'],
  ['Accent plum', '--fs-accent'],
  ['Accent tint', '--fs-accent-tint'],
  ['Page background', '--fs-bg'],
  ['Surface', '--fs-surface'],
  ['Muted surface', '--fs-surface-muted'],
  ['Text', '--fs-text'],
  ['Text secondary', '--fs-text-secondary'],
  ['Text tertiary', '--fs-text-tertiary'],
  ['Border soft', '--fs-border'],
  ['Border strong', '--fs-border-strong'],
  ['Success', '--fs-success'],
  ['Warning', '--fs-warning'],
  ['Error', '--fs-error'],
  ['Info', '--fs-info']
];

const FLOWERS = [
  { value: 'rose-red-naomi', label: 'Rose — Red Naomi', hint: 'Red · 60 cm' },
  { value: 'carnation-white', label: 'Carnation — White', hint: 'White · 55 cm' },
  { value: 'lisianthus-pink', label: 'Lisianthus — Pink', hint: 'Pink · 70 cm' },
  { value: 'marigold-orange', label: 'Marigold — Orange', hint: 'Orange · loose' },
  { value: 'jasmine-string', label: 'Jasmine — String', hint: 'White · string' }
];

interface OfferRow {
  ref: string;
  supplier: string;
  qty: number;
  price: number;
  delivery: string;
  status: string;
}

const OFFER_ROWS: OfferRow[] = [
  { ref: 'Ooty Farms', supplier: 'Verified', qty: 500, price: 21000, delivery: 'Tomorrow 6 AM', status: 'SUBMITTED' },
  { ref: 'Hosur Greens', supplier: 'Verified', qty: 500, price: 22400, delivery: 'Tomorrow 8 AM', status: 'SUBMITTED' },
  { ref: 'Valley Fresh', supplier: 'Unverified', qty: 300, price: 12900, delivery: 'Day after', status: 'PARTIALLY_AWARDED' }
];

const OFFER_COLUMNS: DataColumn<OfferRow>[] = [
  { key: 'ref', header: 'Supplier' },
  { key: 'supplier', header: 'Verification' },
  { key: 'qty', header: 'Quantity', numeric: true, render: (r) => `${r.qty} stems` },
  {
    key: 'price',
    header: 'Est. total',
    numeric: true,
    render: (r) => <span className="fs-num">₹{r.price.toLocaleString('en-IN')}</span>
  },
  { key: 'delivery', header: 'Delivery' },
  { key: 'status', header: 'Status', render: (r) => <StatusPill status={r.status} testId={`preview-offer-status-${r.ref}`} /> }
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="fs-preview__section" data-testid={id} aria-labelledby={`${id}-h`}>
      <h2 className="fs-h3" id={`${id}-h`}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function DesignSystemPreviewPage(): JSX.Element {
  const [flower, setFlower] = useState<string | null>(null);
  const [unit, setUnit] = useState('stems');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <ShellFrame
      testId="design-preview-shell"
      header={
        <OrganizationHeader
          orgName="Vedant Events"
          orgCategory="Event organiser"
          workspaceLabel="Buyer workspace"
          userName="Nagesh Kumar"
          userRole="Organization Admin"
          onSwitch={() => undefined}
        />
      }
      sidebar={
        <div className="fs-md-stack">
          {['Home', 'Get flowers', 'Offers', 'Orders', 'Events', 'More'].map((item) => (
            <span key={item} className="fs-body fs-text-secondary" style={{ padding: '8px 12px' }}>
              {item}
            </span>
          ))}
        </div>
      }
      bottomNav={
        <>
          {['Home', 'Offers', 'Orders', 'Events', 'More'].map((item) => (
            <button key={item} className="fs-btn fs-btn--ghost" style={{ border: 'none', borderRadius: 0 }}>
              {item}
            </button>
          ))}
        </>
      }
    >
      <div className="fs-preview">
        <div className="fs-preview__wrap" data-testid="design-preview-page">
          <PageHeader
            overline="Development preview — not a production feature"
            title="Design system preview"
            actions={<button className="fs-btn">Primary action</button>}
            testId="preview-page-header"
          />
          <InlineAlert variant="info" title="Dev-only route" testId="preview-dev-note">
            This page renders only in development builds and exists for owner visual review of the
            Phase 1 design tokens and component foundation.
          </InlineAlert>

          <Section id="preview-brand" title="Brand — logo system (vector SVG, token palette)">
            <div className="fs-preview__row">
              <Logo variant="horizontal" testId="preview-logo-horizontal" />
              <Logo variant="wordmark" testId="preview-logo-wordmark" />
              <Logo variant="mark" size={40} testId="preview-logo-mark" />
            </div>
            <div
              className="fs-preview__row"
              style={{ background: 'var(--fs-primary)', padding: '16px', borderRadius: 'var(--fs-radius-lg)' }}
            >
              <Logo variant="horizontal" light testId="preview-logo-light" />
              <Logo variant="mark" light size={40} testId="preview-logo-mark-light" />
            </div>
            <p className="fs-caption fs-text-secondary" style={{ margin: 0 }}>
              Static assets: /brand/logo-horizontal.svg · logo-horizontal-light.svg · logo-mark.svg ·
              logo-mark-light.svg · logo-monochrome.svg · logo-wordmark.svg · favicon.svg. Wordmark uses the
              bundled Cormorant Garamond (shipped with the app — no external font dependency).
            </p>
          </Section>

          <Section id="preview-colors" title="Color tokens">
            <div className="fs-preview__grid">
              {SWATCHES.map(([name, token]) => (
                <div className="fs-swatch" key={token} data-testid={`swatch-${token.slice(5)}`}>
                  <div className="fs-swatch__chip" style={{ background: `var(${token})` }} />
                  <span className="fs-swatch__name">
                    {name}
                    <code>var({token})</code>
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section id="preview-typography" title="Typography">
            <p className="fs-display" style={{ margin: 0 }}>Display 36 — Fresh flowers</p>
            <p className="fs-h1" style={{ margin: 0 }}>Heading 1 — Your orders</p>
            <p className="fs-h2" style={{ margin: 0 }}>Heading 2 — Offers for your request</p>
            <p className="fs-h3" style={{ margin: 0 }}>Heading 3 — Rose — Red Naomi</p>
            <p className="fs-h4" style={{ margin: 0 }}>Heading 4 — Delivery details</p>
            <p className="fs-body" style={{ margin: 0 }}>
              Body 14/20 — Sentence-case microcopy tells you what happened and what to do next.
            </p>
            <p className="fs-caption fs-text-secondary" style={{ margin: 0 }}>
              Caption 12 — Received 3h ago
            </p>
            <p className="fs-overline" style={{ margin: 0 }}>Overline — Section label</p>
            <p className="fs-body fs-num" style={{ margin: 0 }}>
              Tabular numerals — ₹1,42,000 · 480 stems · 87%
            </p>
          </Section>

          <Section id="preview-buttons" title="Buttons">
            <div className="fs-preview__row">
              <button className="fs-btn" data-testid="preview-btn-primary">Get offers</button>
              <button className="fs-btn fs-btn--secondary" data-testid="preview-btn-secondary">Save draft</button>
              <button className="fs-btn fs-btn--ghost" data-testid="preview-btn-ghost">Cancel</button>
              <button className="fs-btn fs-btn--danger" data-testid="preview-btn-danger">Reject</button>
              <button className="fs-btn" disabled data-testid="preview-btn-disabled">Disabled</button>
              <button className="fs-btn fs-btn--sm" data-testid="preview-btn-sm">Small</button>
            </div>
          </Section>

          <Section id="preview-inputs" title="Inputs & selects">
            <div className="fs-preview__grid">
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="preview-qty">Quantity</label>
                <input id="preview-qty" className="fs-input fs-num" data-testid="preview-input-qty" placeholder="500" inputMode="numeric" />
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="preview-unit">Unit (visible preselection)</label>
                <select
                  id="preview-unit"
                  className="fs-select"
                  data-testid="preview-select-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                >
                  <option value="stems">Stems</option>
                  <option value="bunches">Bunches</option>
                  <option value="kg">Kilograms</option>
                </select>
              </div>
              <SearchableSelect
                label="Flower"
                options={FLOWERS}
                value={flower}
                onChange={setFlower}
                placeholder="Search flowers…"
                testId="preview-search-flower"
              />
            </div>
          </Section>

          <Section id="preview-pills" title="Status pills — human vocabulary, never colour-only">
            <div className="fs-preview__row">
              {[
                'QC_PENDING',
                'READY_FOR_DISPATCH',
                'IN_TRANSIT',
                'ACCEPTANCE_PENDING',
                'PARTIALLY_AWARDED',
                'CLAIM_OPEN',
                'KYB_VERIFIED',
                'QC_REJECTED',
                'COLD_CHAIN_ALERT',
                'FROZEN'
              ].map((s) => (
                <StatusPill key={s} status={s} testId={`preview-pill-${s.toLowerCase().replace(/_/g, '-')}`} />
              ))}
            </div>
          </Section>

          <Section id="preview-cards" title="Cards">
            <div className="fs-preview__grid">
              <PrimaryActionCard
                title="Get flowers"
                description="About a minute — we source offers for you"
                icon={Flower2}
                testId="preview-pac-flowers"
              />
              <PrimaryActionCard
                title="Add supply"
                description="Camera-first lot intake"
                icon={PackagePlus}
                testId="preview-pac-supply"
              />
              <PrimaryActionCard
                title="Plan an event"
                description="Ceremonies and flower lists"
                icon={CalendarDays}
                testId="preview-pac-event"
              />
            </div>
            <div className="fs-preview__grid">
              <TaskCard
                title="3 offers received — Rose, Red Naomi"
                meta={['500 stems', 'Needed tomorrow 6 AM']}
                status="QUOTING"
                age="10 min ago"
                actionLabel="Compare offers"
                testId="preview-task-offers"
              />
              <TaskCard
                title="Delivery arriving today"
                meta={['Order ORD-2026-0142', 'Ooty Farms']}
                status="IN_TRANSIT"
                age="ETA 6:00 AM"
                actionLabel="Track order"
                testId="preview-task-delivery"
              />
              <TaskCard
                title="Quality check pending"
                meta={['Lot of 600 Carnation — White', 'Hosur hub']}
                status="QC_PENDING"
                age="Received 3h ago"
                actionLabel="Inspect now"
                testId="preview-task-qc"
              />
            </div>
            <div className="fs-preview__grid">
              <MetricCard label="Payout pending" value="₹1,42,000" testId="preview-metric-payout" />
              <MetricCard label="Offers this week" value="12" delta="+4 vs last week" deltaDirection="up" testId="preview-metric-offers" />
              <MetricCard label="Rejection rate" value="3.2%" delta="+0.8 pts" deltaDirection="down" testId="preview-metric-reject" />
            </div>
          </Section>

          <Section id="preview-offer-sample" title="Offer card sample (composed from Phase 1 primitives — dedicated OfferCard in Phase 3)">
            <article className="fs-card fs-task-card" data-testid="preview-offer-card">
              <div className="fs-task-card__top">
                <h3 className="fs-task-card__title">Ooty Farms · Verified ✓</h3>
                <StatusPill status="KYB_VERIFIED" label="Verified supplier" testId="preview-offer-verified" />
              </div>
              <div className="fs-task-card__meta">
                <span className="fs-num">₹21,000 est. total</span>
                <span>500 / 500 stems</span>
                <span>Spec match ✓</span>
                <span>Delivery tomorrow by 6 AM</span>
                <span>Freight included</span>
              </div>
              <div className="fs-task-card__foot">
                <span className="fs-task-card__age">Valid for 6 hours</span>
                <div className="fs-preview__row">
                  <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="preview-offer-details">View details</button>
                  <button className="fs-btn fs-btn--sm" data-testid="preview-offer-select">Select offer</button>
                </div>
              </div>
            </article>
          </Section>

          <Section id="preview-timeline" title="Order timeline sample (primitive — dedicated OrderTimeline in Phase 3)">
            <ol className="fs-timeline" data-testid="preview-timeline">
              {[
                ['done', 'Offer selected', 'Today 9:12 AM'],
                ['done', 'Supplier confirmed', 'Today 10:40 AM'],
                ['current', 'Quality check', 'FloraSetu QA — expected today 2 PM'],
                ['todo', 'Packed', ''],
                ['todo', 'On the way', ''],
                ['todo', 'Delivered — confirm within 24 hours', '']
              ].map(([state, label, meta]) => (
                <li key={label} className={`fs-timeline__step fs-timeline__step--${state}`}>
                  <span className="fs-timeline__dot" aria-hidden="true" />
                  <span>
                    <span className="fs-timeline__label">{label}</span>
                    {meta && (
                      <>
                        <br />
                        <span className="fs-timeline__meta">{meta}</span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="preview-table" title="Data table — switches to cards below 768px (neutral order, no ranking labels)">
            <DataTable
              caption="Offers for your Rose — Red Naomi request"
              columns={OFFER_COLUMNS}
              rows={OFFER_ROWS}
              keyOf={(r) => r.ref.replace(/\s/g, '-')}
              testId="preview-offer-table"
            />
          </Section>

          <Section id="preview-states" title="Empty & loading states">
            <EmptyState
              title="No offers yet"
              hint="We're sourcing suppliers for your request. Offers usually arrive within a few hours."
              actionLabel="View request"
              testId="preview-empty"
            />
            <SkeletonLoader variant="card" count={2} testId="preview-skeleton-cards" />
            <SkeletonLoader variant="text" count={3} testId="preview-skeleton-text" />
          </Section>

          <Section id="preview-alerts" title="Alerts">
            <InlineAlert variant="success" title="Offer sent" testId="preview-alert-success">
              The buyer can now see your offer. We'll notify you if you're selected.
            </InlineAlert>
            <InlineAlert variant="info" title="New request matched" testId="preview-alert-info">
              A buyer in Bengaluru needs flowers you supply.
            </InlineAlert>
            <InlineAlert variant="warning" title="Quote deadline approaching" testId="preview-alert-warning">
              This request closes in 2 hours. Submit your offer before the deadline.
            </InlineAlert>
            <InlineAlert variant="error" title="We couldn't submit your offer" testId="preview-alert-error">
              The quote deadline passed. Ask FloraSetu to extend it or decline the request.
            </InlineAlert>
            <ExceptionBanner
              title="Payout paused — bank verification pending"
              actionLabel="View details"
              testId="preview-exception"
            >
              Your bank account change is being verified. Payouts resume automatically once both
              approvers confirm the change.
            </ExceptionBanner>
          </Section>

          <Section id="preview-form" title="Form sections">
            <ResponsiveFormSection
              title="Delivery details"
              helper="Where should the flowers arrive?"
              testId="preview-form-section"
            >
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="preview-address">Address</label>
                <input id="preview-address" className="fs-input" data-testid="preview-input-address" placeholder="Venue or saved address" />
              </div>
            </ResponsiveFormSection>
            <ResponsiveFormSection
              title="More specifications"
              helper="Grade, stem length, bloom stage, packing — optional"
              collapsible
              defaultOpen={false}
              testId="preview-form-advanced"
            >
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="preview-grade">Grade expectation</label>
                <input id="preview-grade" className="fs-input" data-testid="preview-input-grade" placeholder="e.g. A1" />
              </div>
            </ResponsiveFormSection>
          </Section>

          <Section id="preview-overlays" title="Sheets & dialogs (focus-trapped, Escape closes)">
            <div className="fs-preview__row">
              <button className="fs-btn" data-testid="preview-open-dialog" onClick={() => setDialogOpen(true)}>
                Open confirmation dialog
              </button>
              <button className="fs-btn fs-btn--secondary" data-testid="preview-open-sheet" onClick={() => setSheetOpen(true)}>
                Open side sheet
              </button>
              <button className="fs-btn fs-btn--ghost" data-testid="preview-open-drawer" onClick={() => setDrawerOpen(true)}>
                Open bottom drawer
              </button>
            </div>
            <p className="fs-caption fs-text-secondary" style={{ margin: 0 }}>
              StickyMobileActionBar renders below on viewports under 768px (keyboard-safe,
              safe-area aware).
            </p>
          </Section>
        </div>
      </div>

      <ConfirmationDialog
        open={dialogOpen}
        title="Select this offer?"
        consequence="Ooty Farms will supply 500 Red Naomi stems for ₹21,000, delivery tomorrow by 6 AM. This confirms the order and can't be undone from here."
        confirmLabel="Select offer"
        onConfirm={() => setDialogOpen(false)}
        onCancel={() => setDialogOpen(false)}
        testId="preview-confirm-dialog"
      />
      <SideSheet open={sheetOpen} title="Offer details" onClose={() => setSheetOpen(false)} testId="preview-side-sheet">
        <p className="fs-body">
          Contextual detail without leaving the page — UoM normalization, packing, handling,
          freight components and version history appear here in the real comparison screen.
        </p>
      </SideSheet>
      <Drawer open={drawerOpen} title="Sort offers" onClose={() => setDrawerOpen(false)} testId="preview-drawer">
        <p className="fs-body">
          Neutral, user-controlled sorting only: price, delivery, quantity coverage, specification
          compliance, validity.
        </p>
      </Drawer>
      <StickyMobileActionBar testId="preview-sticky-bar">
        <button className="fs-btn" data-testid="preview-sticky-cta">Get offers</button>
      </StickyMobileActionBar>
    </ShellFrame>
  );
}
