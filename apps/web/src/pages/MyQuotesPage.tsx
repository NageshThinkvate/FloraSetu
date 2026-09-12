import { useEffect, useState } from 'react';
import { listMyQuotes, QuoteSummary } from '../lib/api/demand';

export function MyQuotesPage(): JSX.Element {
  const [items, setItems] = useState<QuoteSummary[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    listMyQuotes().then((r) => setItems(r.items)).catch(() => setError('Could not load quotations'));
  }, []);

  return (
    <main className="app-shell" data-testid="my-quotes">
      <header className="shell-header"><h1>My quotations</h1></header>
      {error && <p className="form-error" data-testid="quotes-error">{error}</p>}
      <div className="table-wrap">
        <table className="data-table" data-testid="quotes-table">
          <thead>
            <tr><th>Ref</th><th>RFQ</th><th>Version</th><th>Status</th><th>Valid until</th></tr>
          </thead>
          <tbody>
            {items.map((q) => (
              <tr key={q.id} data-testid={`quote-row-${q.id}`}>
                <td>{q.ref}</td>
                <td>{q.rfq_title} <span className="hint">({q.rfq_ref})</span></td>
                <td>v{q.current_version_no}</td>
                <td><span className="state-chip">{q.version_status}</span></td>
                <td>{new Date(q.valid_to).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && !error && <p className="hint">No quotations yet — check your RFQ inbox.</p>}
      </div>
    </main>
  );
}
