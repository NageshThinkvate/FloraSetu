import { useEffect, useState } from 'react';
import { adminConfig, ConfigRow, updateConfig } from '../lib/api/admin';
import { useAuth } from '../lib/api/auth';
import { PageHeader } from '../components/PageHeader';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';

// ADR-014: only keys that already exist are runtime-configurable — this page never
// invents configuration. Every change records old value, new value, actor and reason
// in the immutable audit stream (inspectable under Audit Logs).
export function AdminConfigPage(): JSX.Element {
  const { me, activeOrgId } = useAuth();
  const roles = me?.memberships.find((m) => m.org_id === activeOrgId)?.roles ?? [];
  const canWrite = roles.includes('PLATFORM_ADMIN');

  const [items, setItems] = useState<ConfigRow[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  const load = (): void => {
    setItems(null);
    adminConfig()
      .then((r) => setItems(r.items))
      .catch(() => setError("We couldn't load configuration. Try again."));
  };
  useEffect(load, []);

  const save = async (key: string): Promise<void> => {
    setError(''); setNotice(''); setBusy(key);
    try {
      const raw = drafts[key] ?? '';
      const value = raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
      await updateConfig(key, value, reasons[key]?.trim() || undefined);
      setNotice(`Configuration ${key} updated. The change is recorded in the audit log.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div data-testid="admin-config-page">
      <PageHeader overline="Admin Control Plane" title="Configuration" testId="admin-config-header" />
      <p className="fs-body" data-testid="admin-config-note">
        Only values designed to be runtime-configurable appear here. Changes are audited
        with old and new values — no silent overwrites.
      </p>
      {error && <InlineAlert variant="error" testId="admin-config-error">{error}</InlineAlert>}
      {notice && <InlineAlert variant="success" testId="admin-config-notice">{notice}</InlineAlert>}
      {items === null && !error && <SkeletonLoader variant="card" count={3} testId="admin-config-loading" />}
      {items !== null && items.length === 0 && (
        <EmptyState title="No runtime configuration" hint="Externally configurable values will appear here." testId="admin-config-empty" />
      )}
      <div className="fs-md-stack" data-testid="admin-config-list">
        {(items ?? []).map((c) => (
          <div key={c.key} className="fs-card fs-md-card" data-testid={`admin-config-${c.key.toLowerCase().replace(/_/g, '-')}`}>
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{c.key.toLowerCase().replace(/_/g, ' ')}</span>
              <span className="fs-body" data-testid={`admin-config-value-${c.key}`}>{c.value}</span>
            </div>
            {canWrite && (
              <div className="fs-md-stack">
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor={`cfg-${c.key}`}>New value</label>
                  <input
                    id={`cfg-${c.key}`}
                    className="fs-input"
                    data-testid={`admin-config-input-${c.key}`}
                    value={drafts[c.key] ?? ''}
                    onChange={(e) => setDrafts({ ...drafts, [c.key]: e.target.value })}
                  />
                </div>
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor={`cfg-reason-${c.key}`}>Reason (recorded in audit)</label>
                  <input
                    id={`cfg-reason-${c.key}`}
                    className="fs-input"
                    data-testid={`admin-config-reason-${c.key}`}
                    value={reasons[c.key] ?? ''}
                    onChange={(e) => setReasons({ ...reasons, [c.key]: e.target.value })}
                  />
                </div>
                <button
                  className="fs-btn fs-btn--sm"
                  disabled={busy === c.key || !(drafts[c.key] ?? '').trim()}
                  data-testid={`admin-config-save-${c.key}`}
                  onClick={() => void save(c.key)}
                >
                  Save change
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
