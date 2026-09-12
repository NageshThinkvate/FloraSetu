import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClaimRow, fmtDate, listMyClaims } from '../lib/api/fulfilment';

export function ClaimsPage(): JSX.Element {
  const [claims, setClaims] = useState<ClaimRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listMyClaims()
      .then((r) => setClaims(r.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Claims unavailable'));
  }, []);

  if (error) {
    return (
      <main className="app-shell" data-testid="claims-denied">
        <header className="shell-header"><h1>Claims</h1></header>
        <p className="form-error" data-testid="claims-error">{error}</p>
      </main>
    );
  }
  if (!claims) {
    return <main className="app-shell" data-testid="claims-loading"><p className="hint">Loading…</p></main>;
  }

  return (
    <main className="app-shell" data-testid="claims-page">
      <header className="shell-header"><h1>Claims</h1></header>
      <p className="hint">Raise a claim from a delivered order's page (“Report an issue”).</p>
      <section className="panel" data-testid="claims-list-panel">
        <ul className="plain-list">
          {claims.map((c) => (
            <li key={c.id} data-testid={`claim-row-${c.id}`}>
              <code>{c.ref}</code>
              <span className="state-chip">{c.status}</span>
              <span>{c.category}</span>
              <span className="hint">{fmtDate(c.created_at)}</span>
              <Link to={`/claims/${c.id}`} data-testid={`claim-open-${c.id}`}><button className="ghost-btn">Open</button></Link>
            </li>
          ))}
        </ul>
        {claims.length === 0 && <p className="hint" data-testid="claims-empty">No claims.</p>}
      </section>
    </main>
  );
}
