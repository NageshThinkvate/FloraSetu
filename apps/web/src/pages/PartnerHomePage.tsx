import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJobsDashboard, JobsDashboard, listDriverJobs, LogisticsJob } from '../lib/api/logistics';
import { useAuth } from '../lib/api/auth';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { TaskCard } from '../components/TaskCard';
import { MODE_LABEL, nextAction } from './PartnerJobsPage';

const BUCKETS: { key: keyof JobsDashboard; label: string; filter: string; testId: string }[] = [
  { key: 'new_jobs', label: 'New jobs', filter: 'new', testId: 'partner-dash-new' },
  { key: 'pickup_today', label: 'Pickup today', filter: 'pickup-today', testId: 'partner-dash-pickup-today' },
  { key: 'awaiting_pickup', label: 'Awaiting pickup', filter: 'awaiting-pickup', testId: 'partner-dash-awaiting' },
  { key: 'in_transit', label: 'In transit', filter: 'in-transit', testId: 'partner-dash-transit' },
  { key: 'delivery_today', label: 'Delivery today', filter: 'delivery-today', testId: 'partner-dash-delivery-today' },
  { key: 'pod_missing', label: 'POD missing', filter: 'pod-missing', testId: 'partner-dash-pod' },
  { key: 'exceptions_open', label: 'Exceptions', filter: 'exceptions', testId: 'partner-dash-exceptions' }
];

export function PartnerHomePage(): JSX.Element {
  const { me, activeOrgId } = useAuth();
  const isManager = me?.memberships.find((m) => m.org_id === activeOrgId)?.roles.includes('ORG_ADMIN') ?? false;
  const [dash, setDash] = useState<JobsDashboard | null>(null);
  const [mine, setMine] = useState<LogisticsJob[] | null>(null);

  useEffect(() => {
    if (isManager) {
      getJobsDashboard().then(setDash).catch(() => setDash(null));
    } else {
      listDriverJobs()
        .then((r) => setMine(r.items.filter((j) => j.status !== 'DELIVERED')))
        .catch(() => setMine([]));
    }
  }, [isManager]);

  if (!isManager) {
    return (
      <div data-testid="partner-home-driver">
        <PageHeader overline="Driver" title="Today's jobs" testId="partner-home-driver-header" />
        {mine === null && <SkeletonLoader variant="card" count={3} testId="partner-home-driver-loading" />}
        {mine !== null && mine.length === 0 && (
          <EmptyState
            title="No jobs assigned to you"
            hint="When your dispatcher assigns you a pickup or delivery, it will appear here."
            testId="partner-home-driver-empty"
          />
        )}
        <div className="fs-md-stack">
          {(mine ?? []).map((j) => (
            <Link
              key={j.id}
              to={`/partner/logistics/jobs/${j.id}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
              data-testid={`driver-home-job-${j.id.slice(0, 8)}`}
            >
              <TaskCard
                title={`${j.ref} · ${MODE_LABEL[j.mode ?? ''] ?? j.mode ?? 'Transport'}`}
                meta={[
                  j.origin_text ? `Pickup: ${j.origin_text}` : '',
                  j.destination_text ? `Deliver: ${j.destination_text}` : '',
                  `Next: ${nextAction(j)}`
                ].filter(Boolean)}
                status={j.status}
                testId={`driver-home-card-${j.id.slice(0, 8)}`}
              />
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="partner-home">
      <PageHeader overline="Logistics partner" title="Jobs overview" testId="partner-home-header" />
      {dash === null && <SkeletonLoader variant="card" count={3} testId="partner-home-loading" />}
      {dash !== null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--fs-space-3)' }} data-testid="partner-dashboard">
          {BUCKETS.map((b) => (
            <Link
              key={b.key}
              to={`/partner/logistics/jobs?f=${b.filter}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
              data-testid={b.testId}
            >
              <MetricCard label={b.label} value={String(dash[b.key])} testId={`${b.testId}-card`} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
