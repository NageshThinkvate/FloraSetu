import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listRequirements, RequirementSummary } from '../lib/api/demand';

export function DemandHomePage(): JSX.Element {
  const [items, setItems] = useState<RequirementSummary[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    listRequirements()
      .then((r) => setItems(r.items))
      .catch(() => setError('Could not load requirements'));
  }, []);

  return (
    <main className="app-shell" data-testid="demand-home">
      <header className="shell-header">
        <h1>Procurement</h1>
        <Link to="/demand/quick" data-testid="quick-request-cta"><button>+ Quick request</button></Link>
      </header>
      <div className="inline-form" style={{ marginBottom: 24 }}>
        <Link to="/demand/events" data-testid="nav-events"><button className="ghost-btn">Events</button></Link>
        <Link to="/demand/rfqs" data-testid="nav-my-rfqs"><button className="ghost-btn">My RFQs</button></Link>
        <Link to="/supply/inbox" data-testid="nav-supplier-inbox"><button className="ghost-btn">Supplier inbox</button></Link>
        <Link to="/supply/quotes" data-testid="nav-my-quotes"><button className="ghost-btn">My quotations</button></Link>
      </div>
      {error && <p className="form-error" data-testid="demand-error">{error}</p>}
      <section className="module-grid" data-testid="requirement-list">
        {items.map((r) => (
          <article key={r.id} className="module-tile" data-testid={`requirement-${r.id}`}>
            <h2>{r.title}</h2>
            <p>
              <span className="state-chip">{r.mode}</span>{' '}
              <span className={`state-chip${['AWARDED', 'CANCELLED', 'CLOSED'].includes(r.status) ? ' frozen' : ''}`}>{r.status}</span>
            </p>
            <p>{r.ref} · {r.line_count} line(s){r.event_name ? ` · ${r.event_name}` : ''}</p>
            <Link to={`/demand/requirements/${r.id}`} data-testid={`open-requirement-${r.id}`}>
              <button className="ghost-btn">Open</button>
            </Link>
          </article>
        ))}
        {items.length === 0 && !error && <p className="hint">No requirements yet — start with a Quick request.</p>}
      </section>
    </main>
  );
}
