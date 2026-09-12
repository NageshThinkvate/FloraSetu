import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { inr } from '../lib/api/demand';
import {
  confirmAllocation, listMyAllocations, listMySettlements, markShortfall,
  SettlementRow, SupplierAllocationSummary
} from '../lib/api/fulfilment';

// Supplier fulfilment workspace: awarded allocations to confirm, line-level fulfilment
// status, and the supplier's own settlement records.
export function SupplierOrdersPage(): JSX.Element {
  const [allocations, setAllocations] = useState<SupplierAllocationSummary[] | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async (): Promise<void> => {
    setAllocations((await listMyAllocations()).items);
    setSettlements((await listMySettlements()).items);
  };
  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Allocations unavailable'));
  }, []);

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError(''); setNotice('');
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const shortfall = async (lineId: string, e: FormEvent): Promise<void> => {
    e.preventDefault();
    const note = (new FormData(e.target as HTMLFormElement).get('note') as string) || undefined;
    await act(() => markShortfall(lineId, note), 'Line marked SHORT.');
  };

  if (error && !allocations) {
    return (
      <main className="app-shell" data-testid="supplier-orders-denied">
        <header className="shell-header"><h1>Supplier fulfilment</h1></header>
        <p className="form-error" data-testid="supplier-orders-error">{error}</p>
      </main>
    );
  }
  if (!allocations) {
    return <main className="app-shell" data-testid="supplier-orders-loading"><p className="hint">Loading…</p></main>;
  }

  return (
    <main className="app-shell" data-testid="supplier-orders-page">
      <header className="shell-header"><h1>Supplier fulfilment</h1></header>
      {error && <p className="form-error" data-testid="supplier-orders-error-inline">{error}</p>}
      {notice && <p className="form-ok" data-testid="supplier-orders-notice">{notice}</p>}

      {allocations.length === 0 && <p className="hint" data-testid="supplier-orders-empty">No awarded allocations yet.</p>}
      {allocations.map((a) => (
        <section className="panel" key={a.id} data-testid={`alloc-panel-${a.id}`}>
          <h2>
            <code>{a.ref}</code> <span className="state-chip">{a.status}</span>
          </h2>
          <p className="hint">
            Order <Link to={`/orders/${a.order_id}`} data-testid={`alloc-order-${a.id}`}>{a.order_ref}</Link>
            {a.delivery_destination ? ` · deliver to ${a.delivery_destination}` : ''}
            {a.delivery_commitment ? ` · commitment: ${a.delivery_commitment}` : ''}
          </p>
          {a.status === 'PENDING_CONFIRMATION' && (
            <button data-testid={`alloc-confirm-${a.id}`} onClick={() => void act(() => confirmAllocation(a.id), 'Allocation confirmed.')}>
              Confirm allocation
            </button>
          )}
          <ul className="plain-list">
            {(a.lines ?? []).map((l) => (
              <li key={l.id} data-testid={`alloc-line-${l.id}`}>
                <span>awarded {l.awarded_qty}</span>
                <span>{inr(l.unit_price_minor)} {l.currency}/unit</span>
                <span className="state-chip">{l.fulfilment_status}</span>
                {!['PACKED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'].includes(l.fulfilment_status) && (
                  <form className="inline-form" onSubmit={(e) => void shortfall(l.id, e)} data-testid={`alloc-shortfall-form-${l.id}`}>
                    <input name="note" placeholder="Shortfall note…" data-testid={`alloc-shortfall-note-${l.id}`} />
                    <button className="ghost-btn" type="submit" data-testid={`alloc-shortfall-btn-${l.id}`}>Mark short</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="panel" data-testid="supplier-settlements">
        <h2>My settlements ({settlements.length})</h2>
        <ul className="plain-list">
          {settlements.map((s) => (
            <li key={s.id} data-testid={`settlement-row-${s.id}`}>
              <code>{s.ref}</code>
              <span className="state-chip">{s.status}</span>
              <span>gross {inr(s.gross_minor)}</span>
              <span>net {inr(s.net_minor)}</span>
              <span className="hint">{s.payout_ref ? `payout ref ${s.payout_ref}` : 'payout pending'}</span>
            </li>
          ))}
        </ul>
        {settlements.length === 0 && <p className="hint">No settlements recorded yet.</p>}
      </section>
    </main>
  );
}
