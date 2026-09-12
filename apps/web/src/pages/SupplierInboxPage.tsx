import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { InboxItem, rfqInbox } from '../lib/api/demand';

export function SupplierInboxPage(): JSX.Element {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    rfqInbox().then((r) => setItems(r.items)).catch(() => setError('Could not load inbox'));
  }, []);

  return (
    <main className="app-shell" data-testid="supplier-inbox">
      <header className="shell-header"><h1>RFQ inbox</h1></header>
      {error && <p className="form-error" data-testid="inbox-error">{error}</p>}
      <section className="module-grid" data-testid="inbox-list">
        {items.map((i) => (
          <article key={i.invitation_id} className="module-tile" data-testid={`inbox-${i.id}`}>
            <h2>{i.title}</h2>
            <p>
              <span className="state-chip">{i.invitation_status}</span>{' '}
              {i.quote_deadline && <span className="hint">quote by {new Date(i.quote_deadline).toLocaleString()}</span>}
            </p>
            <p>{i.ref}</p>
            <Link to={`/supply/rfqs/${i.id}`} data-testid={`inbox-open-${i.id}`}>
              <button className="ghost-btn">Open</button>
            </Link>
          </article>
        ))}
        {items.length === 0 && !error && <p className="hint">No open invitations.</p>}
      </section>
    </main>
  );
}
