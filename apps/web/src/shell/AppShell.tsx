import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api/client';
import { useAuth } from '../lib/api/auth';
import { ModuleNavigator } from './ModuleNavigator';

type Health = 'checking' | 'ok' | 'down';

const FEATURE_LINKS = [
  { to: '/demand', label: 'Procurement home', testid: 'home-link-demand', blurb: 'Requirements, statuses, awards' },
  { to: '/demand/quick', label: 'Quick request', testid: 'home-link-quick', blurb: 'Mobile-first: product, qty, unit, date — done' },
  { to: '/demand/events', label: 'Events', testid: 'home-link-events', blurb: 'Ceremonies + bill of materials sourcing' },
  { to: '/demand/rfqs', label: 'My RFQs', testid: 'home-link-rfqs', blurb: 'Invitations, quote comparison, awards' },
  { to: '/orders', label: 'My orders', testid: 'home-link-orders', blurb: 'Award-converted orders, delivery acceptance' },
  { to: '/supply/inbox', label: 'Supplier inbox', testid: 'home-link-inbox', blurb: 'Invitations awaiting your quote' },
  { to: '/supply/quotes', label: 'My quotations', testid: 'home-link-quotes', blurb: 'Submitted quotes and versions' },
  { to: '/supply/orders', label: 'Supplier fulfilment', testid: 'home-link-fulfilment', blurb: 'Allocations to confirm, pack and ship' },
  { to: '/supply/lots', label: 'My supply lots', testid: 'home-link-lots', blurb: 'Harvest/stock intake, QC submission, lot media' },
  { to: '/claims', label: 'Claims', testid: 'home-link-claims', blurb: 'Post-delivery issues with evidence trail' },
  { to: '/ops/desk', label: 'Procurement desk', testid: 'home-link-ops', blurb: 'Managed sourcing queues (ops)' },
  { to: '/ops/qc', label: 'QC queue', testid: 'home-link-qc', blurb: 'Lot inspections with pinned grade profiles (ops)' },
  { to: '/ops/tower', label: 'Pilot control tower', testid: 'home-link-tower', blurb: 'Exception queues across the pilot (ops)' },
  { to: '/ops/finance', label: 'Finance desk', testid: 'home-link-finance', blurb: 'External payments + supplier settlements (ops)' },
  { to: '/catalog', label: 'Catalog', testid: 'home-link-catalog', blurb: 'Canonical products, grades, packs, UoM' },
  { to: '/account', label: 'Account', testid: 'home-link-account', blurb: 'Profile, MFA, orgs, KYB, bank' }
];

export function AppShell(): JSX.Element {
  const [health, setHealth] = useState<Health>('checking');
  const { me } = useAuth();

  useEffect(() => {
    let alive = true;
    apiGet<{ status: string }>('/health')
      .then(() => alive && setHealth('ok'))
      .catch(() => alive && setHealth('down'));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="app-shell" data-testid="app-shell">
      <header className="shell-header">
        <h1>FloraSetu</h1>
        <span className="badge" data-testid="build-badge">Build 4 — Pilot Fulfilment</span>
      </header>
      <p className="health-line" data-testid="api-health">
        API:{' '}
        {health === 'checking' && 'checking…'}
        {health === 'ok' && <span className="ok">connected</span>}
        {health === 'down' && <span className="down">unreachable</span>}
        {'  '}· B2B floriculture procurement · mobile-first PWA
      </p>

      {!me && (
        <section className="panel" data-testid="home-cta">
          <h2>Get started</h2>
          <p className="hint">Sign in to procure flowers, run RFQs and compare supplier quotes.</p>
          <div className="inline-form">
            <Link to="/login" data-testid="home-login"><button>Sign in</button></Link>
            <Link to="/register" data-testid="home-register"><button className="ghost-btn">Register</button></Link>
          </div>
        </section>
      )}

      <section data-testid="home-features">
        <h2 className="sub-h">Live screens</h2>
        <div className="module-grid">
          {FEATURE_LINKS.map((f) => (
            <article key={f.to} className="module-tile" data-testid={`home-tile-${f.testid}`}>
              <h2>{f.label}</h2>
              <p>{f.blurb}</p>
              <Link to={f.to} data-testid={f.testid}>
                <button className="ghost-btn">Open</button>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <h2 className="sub-h" style={{ marginTop: 40 }}>Platform modules</h2>
      <ModuleNavigator />
      <footer className="shell-foot">
        Modular monolith · PostgreSQL + PostGIS · Redis · transactional outbox · PWA shell (Capacitor-ready, ADR-006)
      </footer>
    </main>
  );
}
