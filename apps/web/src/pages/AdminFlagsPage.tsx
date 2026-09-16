import { useEffect, useState } from 'react';
import { adminFlags, FlagRow, setFlag } from '../lib/api/admin';
import { useAuth } from '../lib/api/auth';
import { PageHeader } from '../components/PageHeader';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';

const fmtDateTime = (v: string): string =>
  new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// ADR-014: feature-flag governance. Flags are effective-dated — a change closes the
// current window and opens a new one (history preserved, never overwritten). A flag
// being ON never bypasses RBAC, KYB or any domain invariant.
export function AdminFlagsPage(): JSX.Element {
  const { me, activeOrgId } = useAuth();
  const roles = me?.memberships.find((m) => m.org_id === activeOrgId)?.roles ?? [];
  const canManage = roles.includes('PLATFORM_ADMIN');

  const [items, setItems] = useState<FlagRow[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<{ key: string; enabled: boolean; current: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    setItems(null);
    adminFlags()
      .then((r) => setItems(r.items))
      .catch(() => setError("We couldn't load feature flags. Try again."));
  };
  useEffect(load, []);

  const current = (key: string): FlagRow | undefined =>
    (items ?? []).find((f) => f.key === key && f.valid_to === null);
  const keys = [...new Set((items ?? []).map((f) => f.key))];

  const apply = async (): Promise<void> => {
    if (!confirm) {
      return;
    }
    setError(''); setNotice(''); setBusy(true);
    try {
      await setFlag(confirm.key, confirm.enabled, reason.trim() || undefined);
      setNotice(`Flag ${confirm.key.toLowerCase().replace(/_/g, ' ')} is now ${confirm.enabled ? 'on' : 'off'}. The change is effective-dated and audited.`);
      setConfirm(null);
      setReason('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="admin-flags-page">
      <PageHeader overline="Admin Control Plane" title="Feature flags" testId="admin-flags-header" />
      <p className="fs-body" data-testid="admin-flags-note">
        Flags gate feature availability only — they never override sign-in, verification,
        role authorization or any business rule.
      </p>
      {error && <InlineAlert variant="error" testId="admin-flags-error">{error}</InlineAlert>}
      {notice && <InlineAlert variant="success" testId="admin-flags-notice">{notice}</InlineAlert>}
      {items === null && !error && <SkeletonLoader variant="card" count={3} testId="admin-flags-loading" />}
      {items !== null && keys.length === 0 && (
        <EmptyState title="No feature flags" hint="Flags introduced by the platform will appear here." testId="admin-flags-empty" />
      )}
      <div className="fs-md-stack" data-testid="admin-flags-list">
        {keys.map((key) => {
          const cur = current(key);
          const history = (items ?? []).filter((f) => f.key === key);
          return (
            <div key={key} className="fs-card fs-md-card" data-testid={`admin-flag-${key.toLowerCase().replace(/_/g, '-')}`}>
              <div className="fs-task-card__top">
                <span className="fs-md-card__primary">{key.toLowerCase().replace(/_/g, ' ')}</span>
                <span className="fs-body" data-testid={`admin-flag-state-${key}`}>{cur?.enabled ? 'On' : 'Off'}</span>
              </div>
              <div className="fs-md-card__fields">
                <div>
                  <div className="fs-md-card__field-label">Since</div>
                  <div className="fs-md-card__field-value">{cur ? fmtDateTime(cur.valid_from) : '—'}</div>
                </div>
                <div>
                  <div className="fs-md-card__field-label">History entries</div>
                  <div className="fs-md-card__field-value">{history.length}</div>
                </div>
              </div>
              {canManage && cur && confirm?.key !== key && (
                <button
                  className="fs-btn fs-btn--sm fs-btn--secondary"
                  data-testid={`admin-flag-toggle-${key}`}
                  onClick={() => { setConfirm({ key, enabled: !cur.enabled, current: cur.enabled }); setReason(''); }}
                >
                  Turn {cur.enabled ? 'off' : 'on'}
                </button>
              )}
              {canManage && cur && confirm?.key === key && (
                <div className="fs-md-stack" data-testid={`admin-flag-confirm-${key}`}>
                  <p className="fs-body" style={{ margin: 0 }}>
                    Turn {key.toLowerCase().replace(/_/g, ' ')} {confirm.enabled ? 'on' : 'off'}? This takes effect
                    immediately and is recorded in the audit log. Authorization rules still apply to every user.
                  </p>
                  <div className="fs-field">
                    <label className="fs-field__label" htmlFor={`flag-reason-${key}`}>Reason (recorded in audit)</label>
                    <input
                      id={`flag-reason-${key}`}
                      className="fs-input"
                      data-testid="admin-flag-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--fs-space-2)' }}>
                    <button
                      className="fs-btn fs-btn--sm"
                      disabled={busy}
                      data-testid="admin-flag-confirm-btn"
                      onClick={() => void apply()}
                    >
                      {busy ? 'Saving…' : 'Confirm change'}
                    </button>
                    <button
                      className="fs-btn fs-btn--sm fs-btn--ghost"
                      data-testid="admin-flag-cancel-btn"
                      onClick={() => setConfirm(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
