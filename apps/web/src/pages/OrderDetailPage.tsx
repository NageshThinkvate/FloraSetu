import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { inr } from '../lib/api/demand';
import {
  acceptDelivery, allocateLot, AllocationLineRow, BuyerOrderDetail, CLAIM_CATEGORIES, ClaimRow,
  completeSettlement, createClaim, createPackRecord, createShipment, dispatchShipment, fmtDate,
  getOrder, isSupplierSlice, listMyClaims, listPackRecords, listPaymentsForOrder,
  listSettlementsForOrder, listShipmentsForOrder, MANUAL_ORDER_TRANSITIONS, markShortfall,
  OrderDetail, PackRow, PaymentRow, PAYMENT_METHODS, recordPayment, recordPod, recordSettlement,
  reportTempException, SettlementRow, ShipmentRow, submitClaim, transitionOrder, TRANSPORT_MODES,
  verifyPayment, verifySettlement
} from '../lib/api/fulfilment';

// Single order workspace for buyer, supplier (own allocation slice) and ops.
// Drives the full pilot chain: allocate → pack → dispatch → POD → accept → pay → settle.
export function OrderDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    if (!id) return;
    const o = await getOrder(id);
    setOrder(o);
    const [pk, sh, pay, stl, cl] = await Promise.allSettled([
      listPackRecords(id), listShipmentsForOrder(id), listPaymentsForOrder(id),
      listSettlementsForOrder(id), listMyClaims()
    ]);
    if (pk.status === 'fulfilled') setPacks(pk.value.items);
    if (sh.status === 'fulfilled') setShipments(sh.value.items);
    if (pay.status === 'fulfilled') setPayments(pay.value.items);
    if (stl.status === 'fulfilled') setSettlements(stl.value.items);
    if (cl.status === 'fulfilled') setClaims(cl.value.items.filter((c) => c.order_id === id));
  };
  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Order unavailable'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError(''); setNotice(''); setBusy(true);
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  const doAllocate = async (lineId: string, e: FormEvent): Promise<void> => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    await act(
      () => allocateLot({ supplierAllocationLineId: lineId, lotId: String(fd.get('lotId')), qty: Number(fd.get('qty')) }),
      'Lot allocated to line.'
    );
  };

  const doPack = async (line: AllocationLineRow, e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) return;
    const fd = new FormData(e.target as HTMLFormElement);
    await act(
      () => createPackRecord({
        orderId: id,
        supplierAllocationLineId: line.id,
        lotId: String(fd.get('lotId')),
        packedQty: Number(fd.get('packedQty')),
        uomId: line.uom_id,
        packType: String(fd.get('packType') ?? '') || undefined,
        labelRef: String(fd.get('labelRef') ?? '') || undefined
      }),
      'Pack record created.'
    );
  };

  const doShip = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) return;
    const fd = new FormData(e.target as HTMLFormElement);
    await act(
      () => createShipment({
        orderId: id,
        mode: String(fd.get('mode')),
        tempControlled: fd.get('tempControlled') === 'on',
        carrierName: String(fd.get('carrierName') ?? '') || undefined,
        transportRef: String(fd.get('transportRef') ?? '') || undefined,
        parcelAwbRef: String(fd.get('parcelAwbRef') ?? '') || undefined,
        packageCount: fd.get('packageCount') ? Number(fd.get('packageCount')) : undefined,
        eta: fd.get('eta') ? new Date(String(fd.get('eta'))).toISOString() : undefined
      }),
      'Shipment created (PLANNED).'
    );
  };

  const doPod = async (shipmentId: string, e: FormEvent): Promise<void> => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    await act(
      () => recordPod(shipmentId, {
        deliveredQty: Number(fd.get('deliveredQty')),
        receiverName: String(fd.get('receiverName') ?? '') || undefined,
        notes: String(fd.get('podNotes') ?? '') || undefined,
        shortageFlag: fd.get('shortageFlag') === 'on',
        damageFlag: fd.get('damageFlag') === 'on'
      }),
      'POD recorded — order delivered.'
    );
  };

  const doTempException = async (shipmentId: string, e: FormEvent): Promise<void> => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    await act(
      () => reportTempException(shipmentId, {
        severity: String(fd.get('severity')),
        celsius: Number(fd.get('celsius')),
        occurredAt: new Date(String(fd.get('occurredAt'))).toISOString(),
        actionTaken: String(fd.get('actionTaken') ?? '') || undefined
      }),
      'Temperature exception reported.'
    );
  };

  const doAccept = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) return;
    const fd = new FormData(e.target as HTMLFormElement);
    await act(
      () => acceptDelivery(id, {
        acceptedQty: Number(fd.get('acceptedQty')),
        disputedQty: fd.get('disputedQty') ? Number(fd.get('disputedQty')) : undefined,
        reason: String(fd.get('acceptReason') ?? '') || undefined
      }),
      'Delivery acceptance recorded.'
    );
  };

  const doClaim = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) return;
    const fd = new FormData(e.target as HTMLFormElement);
    await act(async () => {
      const claim = await createClaim({
        orderId: id,
        category: String(fd.get('category')),
        description: String(fd.get('description')),
        disputedQty: fd.get('disputedQty') ? Number(fd.get('disputedQty')) : undefined
      });
      await submitClaim(claim.id);
    }, 'Claim submitted to operations.');
  };

  const doPayment = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) return;
    const fd = new FormData(e.target as HTMLFormElement);
    await act(
      () => recordPayment({
        orderId: id,
        amountMinor: Math.round(Number(fd.get('amount')) * 100),
        method: String(fd.get('method')),
        externalRef: String(fd.get('externalRef')),
        paidAt: new Date(String(fd.get('paidAt'))).toISOString()
      }),
      'External payment recorded (RECORDED — pending verification).'
    );
  };

  const doSettlement = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) return;
    const fd = new FormData(e.target as HTMLFormElement);
    await act(
      () => recordSettlement({
        orderId: id,
        supplierOrgId: String(fd.get('supplierOrgId')),
        grossMinor: Math.round(Number(fd.get('gross')) * 100),
        claimAdjustmentMinor: fd.get('claimAdjustment') ? Math.round(Number(fd.get('claimAdjustment')) * 100) : undefined,
        payoutRef: String(fd.get('payoutRef') ?? '') || undefined
      }),
      'Supplier settlement recorded.'
    );
  };

  if (error && !order) {
    return (
      <main className="app-shell" data-testid="order-denied">
        <header className="shell-header"><h1>Order</h1></header>
        <p className="form-error" data-testid="order-error">{error}</p>
      </main>
    );
  }
  if (!order) {
    return <main className="app-shell" data-testid="order-loading"><p className="hint">Loading…</p></main>;
  }

  const supplierSlice = isSupplierSlice(order);
  const buyer = supplierSlice ? null : (order as BuyerOrderDetail);
  const supplierLines = supplierSlice ? order.lines : [];
  const canAccept = !supplierSlice && ['DELIVERED', 'ACCEPTANCE_PENDING'].includes(order.status);
  const canClaim = !supplierSlice && ['DELIVERED', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'CLAIM_OPEN'].includes(order.status);

  return (
    <main className="app-shell" data-testid="order-detail-page">
      <header className="shell-header">
        <h1>Order <code data-testid="order-ref">{order.ref}</code></h1>
        <span className="state-chip" data-testid="order-status">{order.status}</span>
      </header>
      <p className="hint">
        {order.delivery_destination ? `Deliver to ${order.delivery_destination}` : 'No destination recorded'}
        {buyer ? ` · total ${inr(buyer.total_minor)} ${buyer.currency} · ${fmtDate(buyer.created_at)}` : ''}
        {supplierSlice ? ' · supplier view (own allocation only)' : ''}
      </p>
      {buyer?.cancel_reason && <p className="form-error" data-testid="order-cancel-reason">Cancelled: {buyer.cancel_reason}</p>}
      {error && <p className="form-error" data-testid="order-error-inline">{error}</p>}
      {notice && <p className="form-ok" data-testid="order-notice">{notice}</p>}

      {buyer && (
        <section className="panel" data-testid="order-transitions">
          <h2>Lifecycle</h2>
          <div className="inline-form">
            {MANUAL_ORDER_TRANSITIONS.map((to) => (
              <button key={to} className="ghost-btn" disabled={busy} data-testid={`order-transition-${to}`}
                onClick={() => void act(() => transitionOrder(order.id, to, reason || undefined), `Order → ${to}.`)}>
                {to}
              </button>
            ))}
            <input data-testid="order-transition-reason" placeholder="Reason (optional)" value={reason}
              onChange={(e) => setReason(e.target.value)} />
          </div>
        </section>
      )}

      {buyer && (
        <section className="panel" data-testid="order-lines-panel">
          <h2>Lines ({buyer.lines.length})</h2>
          <ul className="plain-list">
            {buyer.lines.map((l) => (
              <li key={l.id} data-testid={`order-line-${l.id}`}>
                <span>qty {l.qty}</span>
                <span>{inr(l.agreed_unit_price_minor)} {l.currency}/unit</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel" data-testid="order-allocations-panel">
        <h2>{supplierSlice ? 'My allocation' : `Supplier allocations (${buyer?.allocations.length ?? 0})`}</h2>
        {supplierSlice && (
          <p><code>{order.allocation.ref}</code> <span className="state-chip">{order.allocation.status}</span></p>
        )}
        {buyer?.allocations.map((a) => (
          <p key={a.id} data-testid={`allocation-${a.id}`}>
            <code>{a.ref}</code> <span className="state-chip">{a.status}</span>
            <span className="hint">supplier {a.supplier_org_id.slice(0, 8)}…</span>
          </p>
        ))}
        <ul className="plain-list">
          {(supplierSlice ? supplierLines : buyer?.allocationLines ?? []).map((l) => {
            const lotAllocs = (supplierSlice ? order.lotAllocations : buyer?.lotAllocations ?? [])
              .filter((la) => la.supplier_allocation_line_id === l.id);
            return (
              <li key={l.id} data-testid={`alloc-line-${l.id}`}>
                <span>awarded {l.awarded_qty}</span>
                <span>{inr(l.unit_price_minor)} {l.currency}/unit</span>
                <span className="state-chip">{l.fulfilment_status}</span>
                {lotAllocs.length > 0 && (
                  <span className="hint">
                    lots: {lotAllocs.map((la) => `${la.lot_id.slice(0, 8)}…×${la.qty}`).join(', ')}
                  </span>
                )}
                {!supplierSlice && ['OPEN', 'LOT_CONFIRMED'].includes(l.fulfilment_status) && (
                  <form className="inline-form" onSubmit={(e) => void doAllocate(l.id, e)} data-testid={`allocate-form-${l.id}`}>
                    <input name="lotId" data-testid={`allocate-lot-${l.id}`} placeholder="Lot UUID" required />
                    <input name="qty" data-testid={`allocate-qty-${l.id}`} type="number" min="0.01" step="any" placeholder="Qty" required />
                    <button type="submit" disabled={busy} data-testid={`allocate-btn-${l.id}`}>Allocate lot</button>
                  </form>
                )}
                {!supplierSlice && !['PACKED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'].includes(l.fulfilment_status) && (
                  <button className="ghost-btn" data-testid={`shortfall-btn-${l.id}`}
                    onClick={() => void act(() => markShortfall(l.id), 'Line marked SHORT.')}>Mark short</button>
                )}
                {l.fulfilment_status === 'ALLOCATED' && (
                  <form className="inline-form" onSubmit={(e) => void doPack(l, e)} data-testid={`pack-form-${l.id}`}>
                    <select name="lotId" data-testid={`pack-lot-${l.id}`} required>
                      <option value="">Lot…</option>
                      {lotAllocs.filter((la) => la.status === 'ALLOCATED').map((la) => (
                        <option key={la.id} value={la.lot_id}>{la.lot_id.slice(0, 8)}… (×{la.qty})</option>
                      ))}
                    </select>
                    <input name="packedQty" data-testid={`pack-qty-${l.id}`} type="number" min="0.01" step="any" placeholder="Packed qty" required />
                    <input name="packType" data-testid={`pack-type-${l.id}`} placeholder="Pack type" />
                    <input name="labelRef" data-testid={`pack-label-${l.id}`} placeholder="Label ref" />
                    <button type="submit" disabled={busy} data-testid={`pack-btn-${l.id}`}>Record packing</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel" data-testid="order-packs-panel">
        <h2>Pack records ({packs.length})</h2>
        <ul className="plain-list">
          {packs.map((p) => (
            <li key={p.id} data-testid={`pack-row-${p.id}`}>
              <code>{p.ref}</code>
              <span>{p.packed_qty} packed</span>
              <span className="hint">lot {p.lot_id.slice(0, 8)}…{p.pack_type ? ` · ${p.pack_type}` : ''}{p.label_ref ? ` · label ${p.label_ref}` : ''}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="order-shipments-panel">
        <h2>Shipments ({shipments.length})</h2>
        {!supplierSlice && order.status === 'READY_FOR_DISPATCH' && (
          <form onSubmit={doShip} className="inline-form" data-testid="shipment-create-form">
            <select name="mode" data-testid="shipment-mode" required>
              {TRANSPORT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <label className="hint">Temp controlled <input name="tempControlled" data-testid="shipment-temp" type="checkbox" /></label>
            <input name="carrierName" data-testid="shipment-carrier" placeholder="Carrier" />
            <input name="transportRef" data-testid="shipment-transport-ref" placeholder="Bus/train/flight/vehicle ref" />
            <input name="parcelAwbRef" data-testid="shipment-awb" placeholder="Parcel/AWB ref" />
            <input name="packageCount" data-testid="shipment-packages" type="number" min="0" placeholder="Packages" />
            <input name="eta" data-testid="shipment-eta" type="datetime-local" />
            <button type="submit" disabled={busy} data-testid="shipment-create-btn">Create shipment</button>
          </form>
        )}
        {shipments.map((s) => (
          <article key={s.id} className="panel" data-testid={`shipment-${s.id}`}>
            <p>
              <code>{s.ref}</code> <span className="state-chip">{s.status}</span>
              <span className="hint">{s.mode}{s.temp_controlled ? ' · temp-controlled' : ''}{s.carrier_name ? ` · ${s.carrier_name}` : ''}</span>
              {s.acceptance_hold && <span className="state-chip frozen">ACCEPTANCE HOLD</span>}
            </p>
            {s.exception_note && <p className="form-error" data-testid={`shipment-note-${s.id}`}>{s.exception_note}</p>}
            <p className="hint">ETA {fmtDate(s.eta)} · dispatched {fmtDate(s.dispatched_at)} · arrived {fmtDate(s.actual_arrival_at)}</p>
            {s.status === 'PLANNED' && (
              <button disabled={busy} data-testid={`shipment-dispatch-${s.id}`}
                onClick={() => void act(() => dispatchShipment(s.id), 'Shipment dispatched.')}>Dispatch</button>
            )}
            {s.status === 'IN_TRANSIT' && (
              <>
                <form onSubmit={(e) => void doPod(s.id, e)} className="inline-form" data-testid={`pod-form-${s.id}`}>
                  <input name="deliveredQty" data-testid={`pod-qty-${s.id}`} type="number" min="0" step="any" placeholder="Delivered qty" required />
                  <input name="receiverName" data-testid={`pod-receiver-${s.id}`} placeholder="Receiver name" />
                  <input name="podNotes" data-testid={`pod-notes-${s.id}`} placeholder="POD notes" />
                  <label className="hint">Shortage <input name="shortageFlag" data-testid={`pod-shortage-${s.id}`} type="checkbox" /></label>
                  <label className="hint">Damage <input name="damageFlag" data-testid={`pod-damage-${s.id}`} type="checkbox" /></label>
                  <button type="submit" disabled={busy} data-testid={`pod-btn-${s.id}`}>Record POD</button>
                </form>
                <form onSubmit={(e) => void doTempException(s.id, e)} className="inline-form" data-testid={`temp-form-${s.id}`}>
                  <select name="severity" data-testid={`temp-severity-${s.id}`}>
                    <option value="WARNING">WARNING</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                  <input name="celsius" data-testid={`temp-celsius-${s.id}`} type="number" step="any" placeholder="°C" required />
                  <input name="occurredAt" data-testid={`temp-at-${s.id}`} type="datetime-local" required />
                  <input name="actionTaken" data-testid={`temp-action-${s.id}`} placeholder="Action taken" />
                  <button type="submit" disabled={busy} data-testid={`temp-btn-${s.id}`}>Report excursion</button>
                </form>
              </>
            )}
          </article>
        ))}
      </section>

      {canAccept && (
        <section className="panel" data-testid="order-accept-panel">
          <h2>Buyer delivery acceptance</h2>
          <form onSubmit={doAccept} className="inline-form" data-testid="accept-form">
            <input name="acceptedQty" data-testid="accept-qty" type="number" min="0" step="any" placeholder="Accepted qty" required />
            <input name="disputedQty" data-testid="accept-disputed" type="number" min="0" step="any" placeholder="Disputed qty (optional)" />
            <input name="acceptReason" data-testid="accept-reason" placeholder="Reason (optional)" />
            <button type="submit" disabled={busy} data-testid="accept-btn">Accept delivery</button>
          </form>
        </section>
      )}

      {canClaim && (
        <section className="panel" data-testid="order-claim-panel">
          <h2>Report an issue</h2>
          <form onSubmit={doClaim} className="inline-form" data-testid="claim-create-form">
            <select name="category" data-testid="claim-category" required>
              {CLAIM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input name="description" data-testid="claim-description" placeholder="Describe the issue" required />
            <input name="disputedQty" data-testid="claim-disputed-qty" type="number" min="0" step="any" placeholder="Disputed qty" />
            <button type="submit" disabled={busy} data-testid="claim-create-btn">Submit claim</button>
          </form>
        </section>
      )}

      <section className="panel" data-testid="order-claims-panel">
        <h2>Claims ({claims.length})</h2>
        <ul className="plain-list">
          {claims.map((c) => (
            <li key={c.id} data-testid={`order-claim-${c.id}`}>
              <code>{c.ref}</code>
              <span className="state-chip">{c.status}</span>
              <span>{c.category}</span>
              <Link to={`/claims/${c.id}`} data-testid={`order-claim-open-${c.id}`}><button className="ghost-btn">Open</button></Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="order-payments-panel">
        <h2>External payments ({payments.length})</h2>
        {!supplierSlice && (
          <form onSubmit={doPayment} className="inline-form" data-testid="payment-record-form">
            <input name="amount" data-testid="payment-amount" type="number" min="0.01" step="any" placeholder="Amount ₹" required />
            <select name="method" data-testid="payment-method">
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <input name="externalRef" data-testid="payment-ref" placeholder="UTR / external reference" required />
            <input name="paidAt" data-testid="payment-paid-at" type="datetime-local" required />
            <button type="submit" disabled={busy} data-testid="payment-record-btn">Record payment</button>
          </form>
        )}
        <ul className="plain-list">
          {payments.map((p) => (
            <li key={p.id} data-testid={`payment-row-${p.id}`}>
              <code>{p.ref}</code>
              <span>{inr(p.amount_minor)} {p.currency}</span>
              <span className="state-chip">{p.status}</span>
              <span className="hint">{p.method} · {p.external_ref} · {fmtDate(p.paid_at)}</span>
              {p.status === 'RECORDED' && (
                <button className="ghost-btn" disabled={busy} data-testid={`payment-verify-${p.id}`}
                  onClick={() => void act(() => verifyPayment(p.id), 'Payment verified.')}>Verify</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="order-settlements-panel">
        <h2>Supplier settlements ({settlements.length})</h2>
        {!supplierSlice && (buyer?.allocations.length ?? 0) > 0 && (
          <form onSubmit={doSettlement} className="inline-form" data-testid="settlement-record-form">
            <select name="supplierOrgId" data-testid="settlement-supplier" required>
              <option value="">Supplier…</option>
              {buyer?.allocations.map((a) => (
                <option key={a.id} value={a.supplier_org_id}>{a.ref} — {a.supplier_org_id.slice(0, 8)}…</option>
              ))}
            </select>
            <input name="gross" data-testid="settlement-gross" type="number" min="0.01" step="any" placeholder="Gross ₹" required />
            <input name="claimAdjustment" data-testid="settlement-claim-adj" type="number" min="0" step="any" placeholder="Claim adj ₹" />
            <input name="payoutRef" data-testid="settlement-payout-ref" placeholder="Payout ref" />
            <button type="submit" disabled={busy} data-testid="settlement-record-btn">Record settlement</button>
          </form>
        )}
        <ul className="plain-list">
          {settlements.map((s) => (
            <li key={s.id} data-testid={`settlement-row-${s.id}`}>
              <code>{s.ref}</code>
              <span>gross {inr(s.gross_minor)} · net {inr(s.net_minor)}</span>
              <span className="state-chip">{s.status}</span>
              {s.status === 'RECORDED' && (
                <button className="ghost-btn" disabled={busy} data-testid={`settlement-verify-${s.id}`}
                  onClick={() => void act(() => verifySettlement(s.id), 'Settlement verified.')}>Verify</button>
              )}
              {s.status === 'VERIFIED' && (
                <button className="ghost-btn" disabled={busy} data-testid={`settlement-complete-${s.id}`}
                  onClick={() => void act(() => completeSettlement(s.id), 'Settlement completed (payout recorded).')}>Complete</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {buyer && (
        <section className="panel" data-testid="order-history-panel">
          <h2>Status history ({buyer.history.length})</h2>
          <ul className="plain-list">
            {buyer.history.map((h, i) => (
              <li key={i} data-testid={`history-row-${i}`}>
                <span className="state-chip">{h.from_status ?? '—'} → {h.to_status}</span>
                <span className="hint">{fmtDate(h.changed_at)}{h.reason ? ` · ${h.reason}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p><Link to={supplierSlice ? '/supply/orders' : '/orders'} data-testid="order-back">← Back</Link></p>
    </main>
  );
}
