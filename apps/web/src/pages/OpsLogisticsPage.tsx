import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { OpsShipment, towerLogistics } from '../lib/api/tower';
import { MODE_LABEL } from './PartnerJobsPage';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';
import { SideSheet } from '../components/SideSheet';

const EXCEPTION_LABEL: Record<string, string> = {
  PICKUP_DELAY: 'Pickup delay',
  VEHICLE_BREAKDOWN: 'Vehicle breakdown',
  MISSED_DEPARTURE: 'Missed departure',
  PARCEL_REJECTED: 'Parcel refused',
  DAMAGE_OBSERVED: 'Damage observed',
  TEMPERATURE_CONCERN: 'Temperature concern',
  ADDRESS_ISSUE: 'Delivery issue',
  RECIPIENT_UNAVAILABLE: 'Recipient unavailable',
  OTHER: 'Other'
};

const FILTERS: [string, string][] = [
  ['all', 'All'],
  ['delayed', 'Delayed'],
  ['exceptions', 'Exceptions'],
  ['pod-missing', 'POD missing'],
  ['awaiting-resource', 'Awaiting partner resource'],
  ['in-transit', 'In transit'],
  ['delivered', 'Delivered']
];

const fmtDateTime = (v: string | null): string =>
  v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

// ADR-012/ADR-013: this workspace is monitor + support only. No driver/vehicle assignment,
// no milestone marking, no POD actions exist here — those belong to the logistics partner.
export function OpsLogisticsPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const filter = params.get('f') ?? 'all';
  const focus = params.get('focus') ?? '';
  const [items, setItems] = useState<OpsShipment[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<OpsShipment | null>(null);

  const load = (): void => {
    setItems(null);
    towerLogistics()
      .then((r) => setItems(r.items))
      .catch(() => setError("We couldn't load the logistics monitor. Try again."));
  };
  useEffect(load, []);

  useEffect(() => {
    if (focus && items) {
      setSelected(items.find((s) => s.id === focus) ?? null);
    }
  }, [focus, items]);

  const shown = (items ?? []).filter((s) => {
    switch (filter) {
      case 'delayed':
        return s.pickupOverdue || s.etaBreached;
      case 'exceptions':
        return s.openExceptions > 0;
      case 'pod-missing':
        return s.podMissing;
      case 'awaiting-resource':
        return s.awaitingPartnerResource;
      case 'in-transit':
        return s.status === 'IN_TRANSIT';
      case 'delivered':
        return s.status === 'DELIVERED';
      default:
        return true;
    }
  });

  const flags = (s: OpsShipment): string[] =>
    [
      s.pickupOverdue ? 'Pickup overdue' : '',
      s.etaBreached ? 'Running late' : '',
      s.podMissing ? 'POD missing' : '',
      s.awaitingPartnerResource ? 'Awaiting partner resource' : '',
      s.openExceptions > 0 ? `${s.openExceptions} open issue${s.openExceptions > 1 ? 's' : ''}` : ''
    ].filter(Boolean);

  return (
    <div data-testid="ops-logistics-page">
      <PageHeader
        overline="Operations — monitoring only"
        title="Logistics monitor"
        testId="ops-logistics-header"
      />
      {error && (
        <InlineAlert variant="error" testId="ops-logistics-error">
          {error}
          <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="ops-logistics-retry" onClick={() => { setError(''); load(); }}>
            Retry
          </button>
        </InlineAlert>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--fs-space-2)', marginBottom: 'var(--fs-space-4)' }} data-testid="ops-logistics-filters">
        {FILTERS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={`fs-btn fs-btn--sm ${filter === v ? '' : 'fs-btn--ghost'}`}
            aria-pressed={filter === v}
            data-testid={`ops-logistics-filter-${v}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (v === 'all') {
                next.delete('f');
              } else {
                next.set('f', v);
              }
              setParams(next, { replace: true });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {items === null && !error && <SkeletonLoader variant="card" count={4} testId="ops-logistics-loading" />}
      {items !== null && shown.length === 0 && (
        <EmptyState
          title="No shipments in this view"
          hint="Shipments assigned to logistics partners will appear here for monitoring."
          testId="ops-logistics-empty"
        />
      )}
      <div className="fs-md-stack">
        {shown.map((s) => (
          <button
            key={s.id}
            type="button"
            className="fs-card fs-md-card"
            style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
            data-testid={`ops-shipment-${s.ref}`}
            onClick={() => setSelected(s)}
          >
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">
                {s.ref} · {MODE_LABEL[s.mode ?? ''] ?? s.mode ?? 'Transport'}
              </span>
              <StatusPill status={s.status} />
            </div>
            <div className="fs-md-card__fields">
              <div>
                <div className="fs-md-card__field-label">Logistics partner</div>
                <div className="fs-md-card__field-value">{s.partnerName ?? 'Not yet assigned'}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Order</div>
                <div className="fs-md-card__field-value">{s.orderRef ?? '—'}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Route</div>
                <div className="fs-md-card__field-value">{s.originText ?? '—'} → {s.destinationText ?? '—'}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">ETA</div>
                <div className="fs-md-card__field-value">{fmtDateTime(s.eta)}</div>
              </div>
            </div>
            {flags(s).length > 0 && (
              <p className="fs-body" style={{ margin: 0 }} data-testid={`ops-shipment-flags-${s.ref}`}>
                {flags(s).join(' · ')}
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
        title={selected ? `Shipment ${selected.ref}` : ''}
        testId="ops-shipment-sheet"
      >
        {selected && (
          <div className="fs-md-stack" data-testid="ops-shipment-sheet-body">
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{MODE_LABEL[selected.mode ?? ''] ?? selected.mode ?? 'Transport'}</span>
              <StatusPill status={selected.status} />
            </div>
            <div className="fs-md-card__fields">
              <div><div className="fs-md-card__field-label">Logistics partner</div><div className="fs-md-card__field-value">{selected.partnerName ?? 'Not yet assigned'}</div></div>
              <div><div className="fs-md-card__field-label">Order</div><div className="fs-md-card__field-value">{selected.orderRef ?? '—'}</div></div>
              <div><div className="fs-md-card__field-label">Pickup</div><div className="fs-md-card__field-value">{selected.originText ?? '—'}</div></div>
              <div><div className="fs-md-card__field-label">Destination</div><div className="fs-md-card__field-value">{selected.destinationText ?? '—'}</div></div>
              {selected.carrierName && <div><div className="fs-md-card__field-label">Operator / carrier</div><div className="fs-md-card__field-value">{selected.carrierName}</div></div>}
              {selected.transportRef && <div><div className="fs-md-card__field-label">Transport reference</div><div className="fs-md-card__field-value">{selected.transportRef}</div></div>}
              {selected.parcelAwbRef && <div><div className="fs-md-card__field-label">Parcel / AWB</div><div className="fs-md-card__field-value">{selected.parcelAwbRef}</div></div>}
              <div><div className="fs-md-card__field-label">Packages</div><div className="fs-md-card__field-value">{selected.packageCount ?? '—'}</div></div>
              <div><div className="fs-md-card__field-label">Temperature control</div><div className="fs-md-card__field-value">{selected.tempControlled ? 'Required' : 'Not required'}</div></div>
              <div><div className="fs-md-card__field-label">Pickup deadline</div><div className="fs-md-card__field-value">{fmtDateTime(selected.pickupAt)}</div></div>
              <div><div className="fs-md-card__field-label">ETD / ETA</div><div className="fs-md-card__field-value">{fmtDateTime(selected.etd)} / {fmtDateTime(selected.eta)}</div></div>
              <div><div className="fs-md-card__field-label">Accepted at</div><div className="fs-md-card__field-value">{fmtDateTime(selected.jobAcceptedAt)}</div></div>
              <div><div className="fs-md-card__field-label">Arrived pickup</div><div className="fs-md-card__field-value">{fmtDateTime(selected.arrivedPickupAt)}</div></div>
              <div><div className="fs-md-card__field-label">Departed</div><div className="fs-md-card__field-value">{fmtDateTime(selected.dispatchedAt)}</div></div>
              <div><div className="fs-md-card__field-label">Arrived delivery</div><div className="fs-md-card__field-value">{fmtDateTime(selected.arrivedDeliveryAt)}</div></div>
              <div><div className="fs-md-card__field-label">Delivered</div><div className="fs-md-card__field-value">{fmtDateTime(selected.actualArrivalAt)}</div></div>
              <div><div className="fs-md-card__field-label">Proof of delivery</div><div className="fs-md-card__field-value" data-testid="ops-shipment-pod">{selected.hasPod ? 'Submitted' : 'Not yet'}</div></div>
            </div>
            {selected.openExceptionTypes.length > 0 && (
              <InlineAlert variant="warning" testId="ops-shipment-exceptions">
                Open issues: {selected.openExceptionTypes.map((t) => EXCEPTION_LABEL[t] ?? t).join(', ')}
              </InlineAlert>
            )}
            <p className="fs-body" style={{ margin: 0 }} data-testid="ops-shipment-readonly-note">
              Execution belongs to the logistics partner. FloraSetu Operations monitors, supports and audits — it does not drive.
            </p>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
