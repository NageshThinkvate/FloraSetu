import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { inr } from '../lib/api/demand';
import {
  completeSettlement, convertAward, fmtDate, resolveShipmentException,
  TowerExceptions, towerExceptions, verifyPayment, verifySettlement
} from '../lib/api/fulfilment';

// Operations Pilot Control Tower (§24): read-only exception queues aggregated across
// contexts through public contracts, plus the minimal ops actions to clear them.
export function ControlTowerPage(): JSX.Element {
  const [tower, setTower] = useState<TowerExceptions | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => setTower(await towerExceptions());
  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Control tower unavailable'));
  }, []);

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError(''); setNotice(''); setBusy(true);
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

  const resolveException = async (exceptionId: string, e: FormEvent): Promise<void> => {
    e.preventDefault();
    const resolution = String(new FormData(e.target as HTMLFormElement).get('resolution') ?? '');
    await act(() => resolveShipmentException(exceptionId, resolution), 'Exception resolved — hold released.');
  };

  if (error && !tower) {
    return (
      <main className="app-shell" data-testid="tower-denied">
        <header className="shell-header"><h1>Pilot control tower</h1></header>
        <p className="form-error" data-testid="tower-error">{error}</p>
      </main>
    );
  }
  if (!tower) {
    return <main className="app-shell" data-testid="tower-loading"><p className="hint">Loading…</p></main>;
  }

  return (
    <main className="app-shell" data-testid="tower-page">
      <header className="shell-header"><h1>Pilot control tower</h1></header>
      {error && <p className="form-error" data-testid="tower-error-inline">{error}</p>}
      {notice && <p className="form-ok" data-testid="tower-notice">{notice}</p>}

      <section className="panel" data-testid="tower-awards">
        <h2>Awards not converted ({tower.awardNotConverted.length})</h2>
        <ul className="plain-list">
          {tower.awardNotConverted.map((a) => (
            <li key={a.id} data-testid={`tower-award-${a.id}`}>
              <code>{a.ref ?? a.id.slice(0, 8)}</code>
              <span className="hint">{a.status ?? 'FINAL'}{a.created_at ? ` · ${fmtDate(a.created_at)}` : ''}</span>
              <button disabled={busy} data-testid={`tower-convert-${a.id}`}
                onClick={() => void act(async () => {
                  const order = await convertAward(a.id);
                  setNotice(`Order ${order.ref} created.`);
                }, 'Award converted.')}>Convert to order</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="tower-orders">
        <h2>Order exceptions</h2>
        <h3 className="sub-h">Supplier not confirmed &gt;24h ({tower.supplierNotConfirmed.length})</h3>
        <ul className="plain-list">
          {tower.supplierNotConfirmed.map((o) => (
            <li key={o.id} data-testid={`tower-unconfirmed-${o.id}`}>
              <code>{o.ref}</code><span className="hint">{fmtDate(o.created_at)}</span>
              <Link to={`/orders/${o.id}`}><button className="ghost-btn">Open</button></Link>
            </li>
          ))}
        </ul>
        <h3 className="sub-h">Lines short after QC ({tower.orderShortAfterQc.length})</h3>
        <ul className="plain-list">
          {tower.orderShortAfterQc.map((l) => (
            <li key={l.id} data-testid={`tower-short-${l.id}`}>
              <code>{l.order_ref}</code>
              <span className="hint">awarded {l.awarded_qty} · allocated {l.allocated_qty}</span>
              <Link to={`/orders/${l.order_id}`}><button className="ghost-btn">Open</button></Link>
            </li>
          ))}
        </ul>
        <h3 className="sub-h">Buyer acceptance pending ({tower.buyerAcceptancePending.length})</h3>
        <ul className="plain-list">
          {tower.buyerAcceptancePending.map((o) => (
            <li key={o.id} data-testid={`tower-acceptance-${o.id}`}>
              <code>{o.ref}</code><span className="hint">{fmtDate(o.updated_at)}</span>
              <Link to={`/orders/${o.id}`}><button className="ghost-btn">Open</button></Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="tower-supply">
        <h2>Supply & QC exceptions</h2>
        <h3 className="sub-h">Lots awaiting QC ({tower.lotAwaitingQc.length})</h3>
        <ul className="plain-list">
          {tower.lotAwaitingQc.map((l) => (
            <li key={l.id} data-testid={`tower-qc-${l.id}`}>
              <span>declared {l.declared_qty}</span><span className="hint">{fmtDate(l.created_at)}</span>
              <Link to="/ops/qc" data-testid={`tower-qc-open-${l.id}`}><button className="ghost-btn">QC queue</button></Link>
            </li>
          ))}
        </ul>
        <h3 className="sub-h">Lots on QC hold ({tower.qcHoldOrReject.length})</h3>
        <ul className="plain-list">
          {tower.qcHoldOrReject.map((l) => (
            <li key={l.id} data-testid={`tower-hold-${l.id}`}>
              <span>held {l.qc_held_qty}</span>
              <Link to={`/supply/lots/${l.id}`}><button className="ghost-btn">Resolve</button></Link>
            </li>
          ))}
        </ul>
        <h3 className="sub-h">Packed, awaiting dispatch ({tower.packedAwaitingDispatch.length})</h3>
        <ul className="plain-list">
          {tower.packedAwaitingDispatch.map((l) => (
            <li key={l.id} data-testid={`tower-packed-${l.id}`}>
              <span>packed {l.packed_qty} · dispatched {l.dispatched_qty}</span>
              <Link to={`/supply/lots/${l.id}`}><button className="ghost-btn">Lot</button></Link>
            </li>
          ))}
        </ul>
        <h3 className="sub-h">Open inspections ({tower.openInspections.length})</h3>
        <ul className="plain-list">
          {tower.openInspections.map((i) => (
            <li key={i.id} data-testid={`tower-inspection-${i.id}`}>
              <span className="hint">lot {i.lot_id.slice(0, 8)}… · {fmtDate(i.created_at)}</span>
              <Link to="/ops/qc"><button className="ghost-btn">QC queue</button></Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="tower-logistics">
        <h2>Logistics exceptions</h2>
        <h3 className="sub-h">Dispatch overdue ({tower.dispatchOverdue.length})</h3>
        <ul className="plain-list">
          {tower.dispatchOverdue.map((s) => (
            <li key={s.id} data-testid={`tower-dispatch-${s.id}`}>
              <code>{s.ref}</code><span className="hint">{fmtDate(s.created_at)}</span>
              <Link to={`/orders/${s.order_id}`}><button className="ghost-btn">Order</button></Link>
            </li>
          ))}
        </ul>
        <h3 className="sub-h">ETA overdue ({tower.etaOverdue.length})</h3>
        <ul className="plain-list">
          {tower.etaOverdue.map((s) => (
            <li key={s.id} data-testid={`tower-eta-${s.id}`}>
              <code>{s.ref}</code><span className="hint">ETA {fmtDate(s.eta)}</span>
              <Link to={`/orders/${s.order_id}`}><button className="ghost-btn">Order</button></Link>
            </li>
          ))}
        </ul>
        <h3 className="sub-h">POD missing &gt;24h ({tower.podMissing.length})</h3>
        <ul className="plain-list">
          {tower.podMissing.map((s) => (
            <li key={s.id} data-testid={`tower-pod-${s.id}`}>
              <code>{s.ref}</code><span className="hint">dispatched {fmtDate(s.dispatched_at)}</span>
              <Link to={`/orders/${s.order_id}`}><button className="ghost-btn">Order</button></Link>
            </li>
          ))}
        </ul>
        <h3 className="sub-h">Open shipment exceptions ({tower.openShipmentExceptions.length})</h3>
        <ul className="plain-list">
          {tower.openShipmentExceptions.map((x) => (
            <li key={x.id} data-testid={`tower-exception-${x.id}`}>
              <span className="state-chip frozen">HOLD</span>
              <span className="hint">
                {x.blocks_buyer_acceptance ? 'blocks acceptance' : ''}{x.blocks_supplier_settlement ? ' blocks settlement' : ''}
              </span>
              <form className="inline-form" onSubmit={(e) => void resolveException(x.id, e)} data-testid={`tower-resolve-form-${x.id}`}>
                <input name="resolution" data-testid={`tower-resolution-${x.id}`} placeholder="Resolution note" required />
                <button type="submit" disabled={busy} data-testid={`tower-resolve-${x.id}`}>Resolve & release hold</button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="tower-finance">
        <h2>Finance exceptions</h2>
        <h3 className="sub-h">Payments awaiting verification ({tower.paymentUnverified.length})</h3>
        <ul className="plain-list">
          {tower.paymentUnverified.map((p) => (
            <li key={p.id} data-testid={`tower-payment-${p.id}`}>
              <code>{p.ref}</code>
              <span>{inr(p.amount_minor)}</span>
              <button className="ghost-btn" disabled={busy} data-testid={`tower-payment-verify-${p.id}`}
                onClick={() => void act(() => verifyPayment(p.id), 'Payment verified.')}>Verify</button>
              <Link to={`/orders/${p.order_id}`}><button className="ghost-btn">Order</button></Link>
            </li>
          ))}
        </ul>
        <h3 className="sub-h">Settlements pending ({tower.settlementPending.length})</h3>
        <ul className="plain-list">
          {tower.settlementPending.map((s) => (
            <li key={s.id} data-testid={`tower-settlement-${s.id}`}>
              <code>{s.ref}</code>
              <span>net {inr(s.net_minor)}</span>
              <span className="state-chip">{s.status}</span>
              {s.status === 'RECORDED' && (
                <button className="ghost-btn" disabled={busy} data-testid={`tower-settlement-verify-${s.id}`}
                  onClick={() => void act(() => verifySettlement(s.id), 'Settlement verified.')}>Verify</button>
              )}
              {s.status === 'VERIFIED' && (
                <button className="ghost-btn" disabled={busy} data-testid={`tower-settlement-complete-${s.id}`}
                  onClick={() => void act(() => completeSettlement(s.id), 'Settlement completed.')}>Complete</button>
              )}
              <Link to={`/orders/${s.order_id}`}><button className="ghost-btn">Order</button></Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" data-testid="tower-claims">
        <h2>Open claims ({tower.claimOpen.length})</h2>
        <ul className="plain-list">
          {tower.claimOpen.map((c) => (
            <li key={c.id} data-testid={`tower-claim-${c.id}`}>
              <code>{c.ref}</code>
              <span className="state-chip">{c.status}</span>
              <span>{c.category}</span>
              <span className="hint">{fmtDate(c.created_at)}</span>
              <Link to={`/claims/${c.id}`}><button className="ghost-btn">Open</button></Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
