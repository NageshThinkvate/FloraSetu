import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listMyRfqs, RfqSummary } from '../lib/api/demand';

export function RfqsPage(): JSX.Element {
  const [items, setItems] = useState<RfqSummary[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    listMyRfqs().then((r) => setItems(r.items)).catch(() => setError('Could not load RFQs'));
  }, []);

  return (
    <main className="app-shell" data-testid="rfqs-page">
      <header className="shell-header"><h1>My RFQs</h1></header>
      {error && <p className="form-error" data-testid="rfqs-error">{error}</p>}
      <div className="table-wrap">
        <table className="data-table" data-testid="rfq-table">
          <thead>
            <tr><th>Ref</th><th>Title</th><th>Mode</th><th>Status</th><th>Invited</th><th>Quotes</th><th>Deadline</th><th /></tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} data-testid={`rfq-row-${r.id}`}>
                <td>{r.ref}</td>
                <td>{r.title}</td>
                <td>{r.mode}</td>
                <td><span className="state-chip">{r.status}</span></td>
                <td>{r.invited}</td>
                <td>{r.quotes}</td>
                <td>{r.quote_deadline ? new Date(r.quote_deadline).toLocaleString() : '—'}</td>
                <td>
                  <Link to={`/demand/rfqs/${r.id}`} data-testid={`open-rfq-${r.id}`}>
                    <button className="ghost-btn">Open</button>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && !error && <p className="hint">No RFQs yet — submit a requirement first.</p>}
      </div>
    </main>
  );
}
