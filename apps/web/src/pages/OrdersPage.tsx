import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { inr } from '../lib/api/demand';
import { fmtDate, listMyOrders, OrderSummary } from '../lib/api/fulfilment';

export function OrdersPage(): JSX.Element {
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listMyOrders()
      .then((r) => setOrders(r.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Orders unavailable'));
  }, []);

  if (error) {
    return (
      <main className="app-shell" data-testid="orders-denied">
        <header className="shell-header"><h1>My orders</h1></header>
        <p className="form-error" data-testid="orders-error">{error}</p>
      </main>
    );
  }
  if (!orders) {
    return <main className="app-shell" data-testid="orders-loading"><p className="hint">Loading…</p></main>;
  }

  return (
    <main className="app-shell" data-testid="orders-page">
      <header className="shell-header"><h1>My orders</h1></header>
      {orders.length === 0 && (
        <p className="hint" data-testid="orders-empty">No orders yet — convert a final award from the control tower or RFQ flow.</p>
      )}
      <section className="panel" data-testid="orders-list-panel">
        <ul className="plain-list">
          {orders.map((o) => (
            <li key={o.id} data-testid={`order-row-${o.id}`}>
              <code>{o.ref}</code>
              <span className="state-chip">{o.status}</span>
              <span>{inr(o.total_minor)} {o.currency}</span>
              <span className="hint">{o.lines} lines · {o.suppliers} suppliers · {fmtDate(o.created_at)}</span>
              <Link to={`/orders/${o.id}`} data-testid={`order-open-${o.id}`}><button className="ghost-btn">Open</button></Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
