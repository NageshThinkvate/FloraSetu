import { useEffect, useState } from 'react';
import { adminSecurity, SecurityOverview } from '../lib/api/admin';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';

const fmtDateTime = (v: string): string =>
  new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// ADR-014: security administration — implemented controls only: privileged-user MFA
// state, security audit events, and time-boxed support (break-glass) grants.
// No secrets, no sessions, no fake controls.
export function AdminSecurityPage(): JSX.Element {
  const [data, setData] = useState<SecurityOverview | null>(null);
  const [error, setError] = useState('');

  const load = (): void => {
    setData(null);
    adminSecurity()
      .then(setData)
      .catch(() => setError("We couldn't load the security overview. Try again."));
  };
  useEffect(load, []);

  return (
    <div data-testid="admin-security-page">
      <PageHeader overline="Admin Control Plane" title="Security" testId="admin-security-header" />
      {error && (
        <InlineAlert variant="error" testId="admin-security-error">
          {error}
          <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="admin-security-retry" onClick={() => { setError(''); load(); }}>
            Retry
          </button>
        </InlineAlert>
      )}
      {data === null && !error && <SkeletonLoader variant="card" count={3} testId="admin-security-loading" />}
      {data && (
        <>
          <h2 className="fs-heading-3" data-testid="admin-security-mfa-title">Privileged users & MFA</h2>
          <div className="fs-md-stack" data-testid="admin-security-privileged">
            {data.privilegedUsers.length === 0 && (
              <p className="fs-body" data-testid="admin-security-no-privileged">No privileged platform users found.</p>
            )}
            {data.privilegedUsers.map((u) => (
              <div key={u.id} className="fs-card fs-md-card" data-testid={`admin-security-user-${u.ref}`}>
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
                    <div className="fs-md-card__field-label">Platform roles</div>
                    <div className="fs-md-card__field-value">{(u.privileged_roles ?? []).map((r) => r.toLowerCase().replace(/_/g, ' ')).join(', ')}</div>
                  </div>
                  <div>
                    <div className="fs-md-card__field-label">MFA</div>
                    <div className="fs-md-card__field-value" data-testid={`admin-security-mfa-${u.ref}`}>
                      {u.mfa_active ? 'Enrolled' : 'Not enrolled'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <h2 className="fs-heading-3" data-testid="admin-security-grants-title">Support access (break-glass) grants</h2>
          <div className="fs-md-stack" data-testid="admin-security-grants">
            {data.supportGrants.length === 0 && (
              <p className="fs-body" data-testid="admin-security-no-grants">No support access grants recorded.</p>
            )}
            {data.supportGrants.map((g) => (
              <div key={g.id} className="fs-card fs-md-card" data-testid={`admin-security-grant-${g.id.slice(0, 8)}`}>
                <div className="fs-task-card__top">
                  <span className="fs-md-card__primary">{g.support_email} → {g.org_name}</span>
                  <span className="fs-body">{new Date(g.expires_at).getTime() > Date.now() ? 'Active' : 'Expired'}</span>
                </div>
                <p className="fs-body" style={{ margin: 0 }}>
                  {g.reason} · granted {fmtDateTime(g.created_at)} · expires {fmtDateTime(g.expires_at)}
                </p>
              </div>
            ))}
          </div>

          <h2 className="fs-heading-3" data-testid="admin-security-events-title">Recent security events</h2>
          <div className="fs-md-stack" data-testid="admin-security-events">
            {data.securityEvents.length === 0 && (
              <p className="fs-body" data-testid="admin-security-no-events">No security events recorded.</p>
            )}
            {data.securityEvents.map((e, i) => (
              <div key={i} className="fs-card fs-md-card" data-testid={`admin-security-event-${i}`}>
                <div className="fs-task-card__top">
                  <span className="fs-md-card__primary">{e.event_type.replace(/\./g, ' · ')}</span>
                  <span className="fs-body">{e.severity}</span>
                </div>
                <p className="fs-body" style={{ margin: 0 }}>{fmtDateTime(e.occurred_at)}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
