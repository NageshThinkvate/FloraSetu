import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminOverview, adminOverview } from '../lib/api/admin';
import { PageHeader } from '../components/PageHeader';
import { MetricCard } from '../components/MetricCard';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';

const fmtDateTime = (v: string): string =>
  new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const ACTION_LABEL: Record<string, string> = {
  'org.suspend': 'Organization suspended',
  'org.unsuspend': 'Organization reactivated',
  'org.kyb.review': 'KYB decision',
  'org.kyb.submit': 'KYB submitted',
  'admin.user.suspend': 'User suspended',
  'admin.user.reactivate': 'User reactivated',
  'admin.config.update': 'Configuration changed',
  'admin.flag.update': 'Feature flag changed',
  'admin.audit_export': 'Audit export'
};

// ADR-014: control-plane summary — what needs governance attention. Not the ops board.
export function AdminOverviewPage(): JSX.Element {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');

  const load = (): void => {
    setData(null);
    adminOverview()
      .then(setData)
      .catch(() => setError("We couldn't load the control-plane summary. Try again."));
  };
  useEffect(load, []);

  return (
    <div data-testid="admin-overview-page">
      <PageHeader overline="Admin Control Plane" title="What needs governance attention" testId="admin-overview-header" />
      {error && (
        <InlineAlert variant="error" testId="admin-overview-error">
          {error}
          <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="admin-overview-retry" onClick={() => { setError(''); load(); }}>
            Retry
          </button>
        </InlineAlert>
      )}
      {data === null && !error && <SkeletonLoader variant="card" count={3} testId="admin-overview-loading" />}
      {data && (
        <>
          <div className="fs-grid fs-grid--metrics" data-testid="admin-overview-metrics">
            <Link to="/admin/kyb" data-testid="admin-metric-kyb">
              <MetricCard label="KYB pending review" value={String(data.kybPendingReview)} />
            </Link>
            <Link to="/admin/organizations" data-testid="admin-metric-restricted">
              <MetricCard label="Restricted organizations" value={String(data.restrictedOrganizations)} />
            </Link>
            <Link to="/admin/users?status=SUSPENDED" data-testid="admin-metric-suspended">
              <MetricCard label="Suspended users" value={String(data.suspendedUsers)} />
            </Link>
            <MetricCard label="Payout-freezing bank changes" value={String(data.payoutFreezingBankChanges)} testId="admin-metric-freeze" />
            <Link to="/admin/security" data-testid="admin-metric-security">
              <MetricCard label="Security events (24h)" value={String(data.securityEventsLast24h)} />
            </Link>
          </div>
          <h2 className="fs-heading-3">Recent administrative activity</h2>
          <div className="fs-md-stack" data-testid="admin-overview-activity">
            {data.recentAdminActivity.length === 0 && (
              <p className="fs-body" data-testid="admin-overview-no-activity">No administrative activity recorded yet.</p>
            )}
            {data.recentAdminActivity.map((a, i) => (
              <div key={`${a.action}-${i}`} className="fs-card fs-md-card" data-testid={`admin-activity-${i}`}>
                <div className="fs-task-card__top">
                  <span className="fs-md-card__primary">{ACTION_LABEL[a.action] ?? a.action}</span>
                  <span className="fs-body">{fmtDateTime(a.occurred_at)}</span>
                </div>
                <p className="fs-body" style={{ margin: 0 }}>
                  {a.object_type}{a.object_ref ? ` · ${a.object_ref}` : ''}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
