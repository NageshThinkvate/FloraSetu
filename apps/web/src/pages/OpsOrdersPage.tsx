import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { OpsOrder, towerOrders } from '../lib/api/tower';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';
import { SideSheet } from '../components/SideSheet';

const SLA_LABEL: Record<string, string> = {
  CONFIRMATION_OVERDUE: 'Confirmation overdue',
  DISPATCH_OVERDUE: 'Dispatch overdue',
  DELIVERY_OVERDUE: 'Delivery overdue',
  ACCEPTANCE_OVERDUE: 'Acceptance overdue'
};

const STAGE_FILTERS: [string, string][] = [
  ['all', 'All'],
  ['attention', 'Needs attention'],
  ['PENDING_CONFIRMATION', 'Waiting for confirmation'],
  ['SUPPLY_CONFIRMED', 'Supply confirmed'],
  ['READY_FOR_DISPATCH', 'Ready to dispatch'],
  ['DISPATCHED', 'Dispatched / in transit'],
  ['ACCEPTANCE_PENDING', 'Waiting for buyer acceptance'],
  ['DELIVERED', 'Delivered'],
  ['claim', 'Claim open']
];

const fmtDateTime = (v: string | null): string =>
  v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

export function OpsOrdersPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const stage = params.get('stage') ?? 'all';
  const focus = params.get('focus') ?? '';
  const [orders, setOrders] = useState<OpsOrder[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<OpsOrder | null>(null);

  useEffect(() => {
    setOrders(null);
    towerOrders()
      .then((r) => setOrders(r.items))
      .catch(() => setError("We couldn't load the order monitor. Try again."));
  }, []);

  useEffect(() => {
    if (focus && orders) {
      setSelected(orders.find((o) => o.id === focus) ?? null);
    }
  }, [focus, orders]);

  const shown = (orders ?? []).filter((o) => {
    if (stage === 'all') {
      return true;
    }
    if (stage === 'attention') {
      return !!o.slaBreach || o.hasOpenClaim;
    }
    if (stage === 'claim') {
      return o.hasOpenClaim;
    }
    if (stage === 'DISPATCHED') {
      return o.status === 'DISPATCHED' || o.status === 'IN_TRANSIT';
    }
    return o.status === stage;
  });

  return (
    <div data-testid="ops-orders-page">
      <PageHeader overline="Operations" title="Orders needing attention" testId="ops-orders-header" />
      {error && (
        <InlineAlert variant="error" testId="ops-orders-error">
          {error}
          <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="ops-orders-retry" onClick={() => { setError(''); setOrders(null); towerOrders().then((r) => setOrders(r.items)).catch(() => setError("We couldn't load the order monitor. Try again.")); }}>
            Retry
          </button>
        </InlineAlert>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--fs-space-2)', marginBottom: 'var(--fs-space-4)' }} data-testid="ops-orders-filters">
        {STAGE_FILTERS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={`fs-btn fs-btn--sm ${stage === v ? '' : 'fs-btn--ghost'}`}
            aria-pressed={stage === v}
            data-testid={`ops-orders-stage-${v}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (v === 'all') {
                next.delete('stage');
              } else {
                next.set('stage', v);
              }
              setParams(next, { replace: true });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {orders === null && !error && <SkeletonLoader variant="card" count={4} testId="ops-orders-loading" />}
      {orders !== null && shown.length === 0 && (
        <EmptyState
          title="No orders in this view"
          hint="Orders needing platform attention will appear here."
          testId="ops-orders-empty"
        />
      )}
      <div className="fs-md-stack">
        {shown.map((o) => (
          <button
            key={o.id}
            type="button"
            className="fs-card fs-md-card"
            style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
            data-testid={`ops-order-${o.ref}`}
            onClick={() => setSelected(o)}
          >
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{o.ref}</span>
              <StatusPill status={o.status} />
            </div>
            <div className="fs-md-card__fields">
              <div>
                <div className="fs-md-card__field-label">Buyer</div>
                <div className="fs-md-card__field-value">{o.buyerName ?? '—'}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Supplier</div>
                <div className="fs-md-card__field-value">{o.supplierNames.join(', ') || '—'}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Next action owner</div>
                <div className="fs-md-card__field-value" data-testid={`ops-order-owner-${o.ref}`}>{o.nextOwner}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Updated</div>
                <div className="fs-md-card__field-value">{fmtDateTime(o.updatedAt)}</div>
              </div>
            </div>
            {(o.slaBreach || o.hasOpenClaim) && (
              <p className="fs-body" style={{ margin: 0 }} data-testid={`ops-order-flags-${o.ref}`}>
                {o.slaBreach ? `${SLA_LABEL[o.slaBreach] ?? o.slaBreach}` : ''}
                {o.slaBreach && o.hasOpenClaim ? ' · ' : ''}
                {o.hasOpenClaim ? 'Claim open' : ''}
              </p>
            )}
          </button>
        ))}
      </div>
      <SideSheet
        open={selected !== null}
        onClose={() => {
          setSelected(null);
          const next = new URLSearchParams(params);
          next.delete('focus');
          setParams(next, { replace: true });
        }}
        title={selected ? `Order ${selected.ref}` : ''}
        testId="ops-order-sheet"
      >
        {selected && (
          <div className="fs-md-stack" data-testid="ops-order-sheet-body">
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{selected.ref}</span>
              <StatusPill status={selected.status} />
            </div>
            <div className="fs-md-card__fields">
              <div><div className="fs-md-card__field-label">Buyer</div><div className="fs-md-card__field-value">{selected.buyerName ?? '—'}</div></div>
              <div><div className="fs-md-card__field-label">Suppliers</div><div className="fs-md-card__field-value">{selected.supplierNames.join(', ') || '—'}</div></div>
              <div><div className="fs-md-card__field-label">Destination</div><div className="fs-md-card__field-value">{selected.deliveryDestination ?? '—'}</div></div>
              <div><div className="fs-md-card__field-label">Next action owner</div><div className="fs-md-card__field-value">{selected.nextOwner}</div></div>
              <div><div className="fs-md-card__field-label">Created</div><div className="fs-md-card__field-value">{fmtDateTime(selected.createdAt)}</div></div>
              <div><div className="fs-md-card__field-label">Updated</div><div className="fs-md-card__field-value">{fmtDateTime(selected.updatedAt)}</div></div>
              {selected.acceptedQty !== null && (
                <div><div className="fs-md-card__field-label">Accepted qty</div><div className="fs-md-card__field-value">{selected.acceptedQty}</div></div>
              )}
              {selected.disputedQty !== null && selected.disputedQty > 0 && (
                <div><div className="fs-md-card__field-label">Disputed qty (partial)</div><div className="fs-md-card__field-value">{selected.disputedQty}</div></div>
              )}
            </div>
            {selected.slaBreach && (
              <InlineAlert variant="warning" testId="ops-order-sla">{SLA_LABEL[selected.slaBreach] ?? selected.slaBreach}</InlineAlert>
            )}
            <p className="fs-body" style={{ margin: 0 }}>
              Domain actions stay with the responsible party — Operations monitors and supports; it does not fulfil on their behalf.
            </p>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
