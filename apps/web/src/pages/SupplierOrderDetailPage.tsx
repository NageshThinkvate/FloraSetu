import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  confirmAllocation, createPackRecord, fmtDate, getOrder, isSupplierSlice,
  listPackRecords, listShipmentsForOrder, PackRow, ShipmentRow, SupplierOrderDetail
} from '../lib/api/fulfilment';
import { inr } from '../lib/api/demand';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';
import { EmptyState } from '../components/EmptyState';

// Supplier fulfilment (Phase 4): Confirm order → supply lot linked/evidence → Pack →
// handoff to logistics → dispatch → delivered. The logistics partner and current status
// are always visible. No operational buttons that belong to other workspaces.
const PACK_TYPES = ['CARTON', 'CRATE', 'BOX', 'BUNDLE'];

export function SupplierOrderDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const [order, setOrder] = useState<SupplierOrderDetail | null>(null);
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [packFor, setPackFor] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const o = await getOrder(id);
    if (!isSupplierSlice(o)) {
      throw new Error('This order belongs to your buyer workspace.');
    }
    setOrder(o);
    setPacks((await listPackRecords(id).catch(() => ({ items: [] }))).items);
    setShipments((await listShipmentsForOrder(id).catch(() => ({ items: [] }))).items);
  }, [id]);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Order unavailable'));
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const pack = async (lineId: string, e: FormEvent): Promise<void> => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const lotAlloc = order?.lotAllocations.find((la) => la.supplier_allocation_line_id === lineId);
    if (!lotAlloc) {
      setError('No supply lot is linked to this line yet — FloraSetu assigns supply after you confirm.');
      return;
    }
    const line = order?.lines.find((l) => l.id === lineId);
    await act(async () => {
      await createPackRecord({
        orderId: id,
        supplierAllocationLineId: lineId,
        lotId: lotAlloc.lot_id,
        packedQty: Number(fd.get('packedQty')),
        uomId: line?.uom_id,
        packType: String(fd.get('packType') ?? 'CARTON'),
        cartonCount: fd.get('cartonCount') ? Number(fd.get('cartonCount')) : undefined
      });
      setPackFor(null);
    }, 'Packed and recorded. FloraSetu is notified for dispatch.');
  };

  if (error && !order) {
    return <InlineAlert variant="error" testId="supplier-order-error">{error}</InlineAlert>;
  }
  if (!order) {
    return <SkeletonLoader variant="card" count={3} testId="supplier-order-loading" />;
  }

  const confirmed = order.allocation.status !== 'PENDING_CONFIRMATION';
  const steps = [
    { key: 'confirm', label: 'Confirm order', done: confirmed },
    { key: 'supply', label: 'Supply lot linked', done: order.lotAllocations.length > 0 },
    { key: 'evidence', label: 'Lot evidence complete', done: order.lotAllocations.length > 0 },
    { key: 'pack', label: 'Packed', done: order.lines.every((l) => ['PACKED', 'DISPATCHED', 'DELIVERED'].includes(l.fulfilment_status)) && order.lines.length > 0 },
    { key: 'handoff', label: 'Handoff to logistics', done: shipments.length > 0 },
    { key: 'delivered', label: 'Delivered', done: ['DELIVERED', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'CLOSED', 'CLAIM_OPEN'].includes(order.status) }
  ];
  const current = steps.find((s) => !s.done);

  return (
    <div data-testid="supplier-order-page">
      <PageHeader overline="Fulfilment" title={order.ref} testId="supplier-order-header" />
      <div className="fs-task-card__top">
        <StatusPill status={order.status} testId="supplier-order-status" />
        {order.delivery_destination && <span className="fs-caption fs-text-secondary">Deliver to {order.delivery_destination}</span>}
      </div>
      {notice && <InlineAlert variant="success" testId="supplier-order-notice">{notice}</InlineAlert>}
      {error && <InlineAlert variant="error" testId="supplier-order-error-inline">{error}</InlineAlert>}

      <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="supplier-order-steps">
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--fs-space-2)' }}>
          {steps.map((s) => (
            <li key={s.key} data-testid={`supplier-step-${s.key}`} style={{ display: 'flex', gap: 'var(--fs-space-3)', alignItems: 'center' }}>
              <span aria-hidden style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                background: s.done ? 'var(--fs-color-success, #1d7a4f)' : current?.key === s.key ? 'var(--fs-color-info, #2563eb)' : '#d6dcd8',
                color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12
              }}>{s.done ? '✓' : ''}</span>
              <span className="fs-body" style={{ fontWeight: current?.key === s.key ? 700 : 400 }}>{s.label}</span>
            </li>
          ))}
        </ol>
      </section>

      {!confirmed && (
        <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="supplier-order-confirm">
          <p className="fs-body-l" style={{ marginTop: 0 }}>New order — confirm you can fulfil it.</p>
          <div className="fs-md-card__fields" style={{ marginBottom: 'var(--fs-space-4)' }}>
            {order.lines.map((l) => (
              <div key={l.id}>
                <div className="fs-md-card__field-label">Awarded</div>
                <div className="fs-md-card__field-value">{l.awarded_qty} @ {inr(l.unit_price_minor)} {l.currency}/unit</div>
              </div>
            ))}
          </div>
          <button className="fs-btn" data-testid="supplier-confirm-btn" disabled={busy}
            onClick={() => void act(() => confirmAllocation(order.allocation.id), 'Order confirmed. FloraSetu will link your supply lot next.')}>
            Confirm order
          </button>
        </section>
      )}

      <section style={{ marginTop: 'var(--fs-space-4)' }} data-testid="supplier-order-lines">
        <p className="fs-overline">Lines &amp; packing</p>
        <div className="fs-md-stack">
          {order.lines.map((l) => {
            const lotAlloc = order.lotAllocations.find((la) => la.supplier_allocation_line_id === l.id);
            const linePacks = packs.filter((p) => p.supplier_allocation_line_id === l.id);
            const packed = ['PACKED', 'DISPATCHED', 'DELIVERED'].includes(l.fulfilment_status);
            return (
              <article key={l.id} className="fs-card fs-md-card" data-testid={`supplier-line-${l.id.slice(0, 8)}`}>
                <div className="fs-task-card__top">
                  <span className="fs-md-card__primary">{l.awarded_qty} awarded · {inr(l.unit_price_minor)}/unit</span>
                  <StatusPill status={l.fulfilment_status} testId={`supplier-line-status-${l.id.slice(0, 8)}`} />
                </div>
                {lotAlloc ? (
                  <p className="fs-body" style={{ margin: 'var(--fs-space-2) 0' }}>
                    Supply lot: <Link to={`/supplier/supply/${lotAlloc.lot_id}`} data-testid={`supplier-line-lot-${l.id.slice(0, 8)}`}>open lot &amp; evidence</Link>
                    {' '}<span className="fs-caption fs-text-secondary">({lotAlloc.qty} allocated)</span>
                  </p>
                ) : (
                  <p className="fs-caption fs-text-secondary" style={{ margin: 'var(--fs-space-2) 0' }}>
                    No lot linked yet — FloraSetu assigns supply after confirmation.{' '}
                    <Link to="/supplier/supply/new" data-testid={`supplier-line-addsupply-${l.id.slice(0, 8)}`}>Add supply now</Link>
                  </p>
                )}
                {linePacks.length > 0 && (
                  <p className="fs-caption" data-testid={`supplier-line-packed-${l.id.slice(0, 8)}`}>
                    Packed: {linePacks.map((p) => `${p.packed_qty}${p.carton_count ? ` · ${p.carton_count} cartons` : ''}`).join(' + ')}
                  </p>
                )}
                {confirmed && !packed && lotAlloc && (
                  packFor === l.id ? (
                    <form onSubmit={(e) => void pack(l.id, e)} className="fs-md-stack" data-testid={`supplier-pack-form-${l.id.slice(0, 8)}`}
                      style={{ marginTop: 'var(--fs-space-3)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--fs-space-3)' }}>
                        <div className="fs-field">
                          <label className="fs-field__label" htmlFor={`pq-${l.id}`}>Packed quantity</label>
                          <input id={`pq-${l.id}`} name="packedQty" className="fs-input fs-num" data-testid={`supplier-pack-qty-${l.id.slice(0, 8)}`}
                            type="number" min="0.01" step="any" defaultValue={String(lotAlloc.qty)} required />
                        </div>
                        <div className="fs-field">
                          <label className="fs-field__label" htmlFor={`pt-${l.id}`}>Pack type</label>
                          <select id={`pt-${l.id}`} name="packType" className="fs-select" data-testid={`supplier-pack-type-${l.id.slice(0, 8)}`}>
                            {PACK_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}
                          </select>
                        </div>
                        <div className="fs-field">
                          <label className="fs-field__label" htmlFor={`pc-${l.id}`}>Cartons</label>
                          <input id={`pc-${l.id}`} name="cartonCount" className="fs-input fs-num" data-testid={`supplier-pack-cartons-${l.id.slice(0, 8)}`}
                            type="number" min="1" />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--fs-space-2)' }}>
                        <button type="submit" className="fs-btn fs-btn--sm" data-testid={`supplier-pack-submit-${l.id.slice(0, 8)}`} disabled={busy}>Record packing</button>
                        <button type="button" className="fs-btn fs-btn--ghost fs-btn--sm" onClick={() => setPackFor(null)}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <button className="fs-btn fs-btn--sm" style={{ marginTop: 'var(--fs-space-2)' }}
                      data-testid={`supplier-pack-btn-${l.id.slice(0, 8)}`} onClick={() => setPackFor(l.id)}>
                      Pack this line
                    </button>
                  )
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section style={{ marginTop: 'var(--fs-space-4)' }} data-testid="supplier-order-logistics">
        <p className="fs-overline">Logistics</p>
        {shipments.length === 0 ? (
          <EmptyState
            title="Not handed off yet"
            hint="Once packing is done, FloraSetu assigns a logistics partner and the leg appears here."
            testId="supplier-logistics-empty"
          />
        ) : (
          <div className="fs-md-stack">
            {shipments.map((s) => (
              <article key={s.id} className="fs-card fs-md-card" data-testid={`supplier-shipment-${s.ref}`}>
                <div className="fs-task-card__top">
                  <span className="fs-md-card__primary">
                    {s.logistics_org_name ?? s.carrier_name ?? 'Logistics partner'}
                  </span>
                  <StatusPill status={s.status} testId={`supplier-shipment-status-${s.ref}`} />
                </div>
                <div className="fs-md-card__fields">
                  <div><div className="fs-md-card__field-label">Mode</div><div className="fs-md-card__field-value">{s.mode.replace(/_/g, ' ').toLowerCase()}</div></div>
                  {(s.parcel_awb_ref ?? s.transport_ref) && (
                    <div><div className="fs-md-card__field-label">Reference</div><div className="fs-md-card__field-value">{s.parcel_awb_ref ?? s.transport_ref}</div></div>
                  )}
                  {s.pickup_at && <div><div className="fs-md-card__field-label">Picked up</div><div className="fs-md-card__field-value">{fmtDate(s.pickup_at)}</div></div>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <p style={{ marginTop: 'var(--fs-space-5)' }}>
        <Link to="/supplier/orders" data-testid="supplier-order-back">← All orders</Link>
      </p>
    </div>
  );
}
