import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api/client';
import { ModuleNavigator } from './ModuleNavigator';

type Health = 'checking' | 'ok' | 'down';

export function AppShell(): JSX.Element {
  const [health, setHealth] = useState<Health>('checking');

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
        <span className="badge" data-testid="build-badge">Build 0 — Architecture Freeze</span>
      </header>
      <p className="health-line" data-testid="api-health">
        API:{' '}
        {health === 'checking' && 'checking…'}
        {health === 'ok' && <span className="ok">connected</span>}
        {health === 'down' && <span className="down">unreachable</span>}
        {'  '}· 12 bounded contexts scaffolded · no feature screens in Build 0
      </p>
      <ModuleNavigator />
      <footer className="shell-foot">
        Modular monolith · PostgreSQL + PostGIS · Redis · transactional outbox · PWA shell (Capacitor-ready, ADR-006)
      </footer>
    </main>
  );
}
