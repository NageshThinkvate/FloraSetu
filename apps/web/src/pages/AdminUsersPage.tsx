import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminUser, adminUsers, reactivateUser, suspendUser } from '../lib/api/admin';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';
import { SideSheet } from '../components/SideSheet';

const STATUS_FILTERS: [string, string][] = [
  ['all', 'Any status'], ['ACTIVE', 'Active'], ['SUSPENDED', 'Suspended'], ['DEACTIVATED', 'Deactivated']
];

// ADR-014: platform user governance. Suspend/reactivate only — no password access,
// no IAM mutation, no MFA changes. Every action is reasoned and audited.
export function AdminUsersPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (q = query, s = status): void => {
    setUsers(null);
    adminUsers(q || undefined, s === 'all' ? undefined : s)
      .then((r) => setUsers(r.items))
      .catch(() => setError("We couldn't load users. Try again."));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), [status]);

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError(''); setNotice(''); setBusy(true);
    try {
      await fn();
      setNotice(ok);
      setSelected(null);
      setReason('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="admin-users-page">
      <PageHeader overline="Admin Control Plane" title="Users & access" testId="admin-users-header" />
      {error && <InlineAlert variant="error" testId="admin-users-error">{error}</InlineAlert>}
      {notice && <InlineAlert variant="success" testId="admin-users-notice">{notice}</InlineAlert>}

      <form
        className="fs-field"
        style={{ maxWidth: 420 }}
        data-testid="admin-users-search-form"
        onSubmit={(e) => { e.preventDefault(); load(query); }}
      >
        <label className="fs-field__label" htmlFor="admin-users-search">Search by name, email or reference</label>
        <input
          id="admin-users-search"
          className="fs-input"
          data-testid="admin-users-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </form>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--fs-space-2)', marginBottom: 'var(--fs-space-4)' }} data-testid="admin-users-filters">
        {STATUS_FILTERS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={`fs-btn fs-btn--sm ${status === v ? '' : 'fs-btn--ghost'}`}
            aria-pressed={status === v}
            data-testid={`admin-users-status-${v.toLowerCase()}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (v === 'all') {
                next.delete('status');
              } else {
                next.set('status', v);
              }
              setParams(next, { replace: true });
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {users === null && !error && <SkeletonLoader variant="card" count={4} testId="admin-users-loading" />}
      {users !== null && users.length === 0 && (
        <EmptyState title="No users match" hint="Adjust the search or status filter." testId="admin-users-empty" />
      )}
      <div className="fs-md-stack" data-testid="admin-users-list">
        {(users ?? []).map((u) => (
          <button
            key={u.id}
            type="button"
            className="fs-card fs-md-card"
            style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
            data-testid={`admin-user-${u.ref}`}
            onClick={() => { setSelected(u); setReason(''); }}
          >
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{u.display_name}</span>
              <StatusPill status={u.status} />
            </div>
            <div className="fs-md-card__fields">
              <div>
                <div className="fs-md-card__field-label">Email</div>
                <div className="fs-md-card__field-value">{u.email}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Reference</div>
                <div className="fs-md-card__field-value">{u.ref}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Organizations</div>
                <div className="fs-md-card__field-value">{(u.memberships ?? []).map((m) => m.orgName).join(', ') || '—'}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">MFA</div>
                <div className="fs-md-card__field-value">{u.mfa_active ? 'Enrolled' : 'Not enrolled'}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <SideSheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? selected.display_name : ''}
        testId="admin-user-sheet"
      >
        {selected && (
          <div className="fs-md-stack" data-testid="admin-user-sheet-body">
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{selected.email}</span>
              <StatusPill status={selected.status} />
            </div>
            <div className="fs-md-card__fields">
              <div><div className="fs-md-card__field-label">Reference</div><div className="fs-md-card__field-value">{selected.ref}</div></div>
              <div><div className="fs-md-card__field-label">MFA</div><div className="fs-md-card__field-value">{selected.mfa_active ? 'Enrolled' : 'Not enrolled'}</div></div>
            </div>
            <div className="fs-md-card__field-label">Memberships</div>
            {(selected.memberships ?? []).map((m) => (
              <p key={m.orgId} className="fs-body" style={{ margin: 0 }} data-testid={`admin-user-membership-${m.orgRef}`}>
                {m.orgName} ({m.orgRef}) · {m.roles.map((r) => r.toLowerCase().replace(/_/g, ' ')).join(', ') || 'member'} · {m.membershipStatus.toLowerCase()}
              </p>
            ))}
            {selected.status === 'ACTIVE' && (
              <>
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor="admin-user-reason">Suspension reason (required, audited)</label>
                  <input
                    id="admin-user-reason"
                    className="fs-input"
                    data-testid="admin-user-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                <button
                  className="fs-btn fs-btn--danger"
                  disabled={busy || !reason.trim()}
                  data-testid="admin-user-suspend"
                  onClick={() => void act(() => suspendUser(selected.id, reason.trim()), 'User suspended. Their history is preserved; login and org actions are blocked.')}
                >
                  Suspend user
                </button>
              </>
            )}
            {selected.status === 'SUSPENDED' && (
              <button
                className="fs-btn"
                disabled={busy}
                data-testid="admin-user-reactivate"
                onClick={() => void act(() => reactivateUser(selected.id), 'User reactivated.')}
              >
                Reactivate user
              </button>
            )}
            <p className="fs-body" style={{ margin: 0 }}>
              Suspension blocks login and organization actions but never erases the user's history.
              Passwords and MFA secrets are never visible here.
            </p>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
