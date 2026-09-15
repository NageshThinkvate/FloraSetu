import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listDriverJobs, listPartnerJobs, LogisticsJob } from '../lib/api/logistics';
import { PageHeader } from '../components/PageHeader';
import { TaskCard } from '../components/TaskCard';
import { EmptyState } from '../components/EmptyState';
import { SkeletonLoader } from '../components/SkeletonLoader';

export const MODE_LABEL: Record<string, string> = {
  BUS_PARCEL: 'Bus parcel',
  RAIL_PARCEL: 'Rail parcel',
  AIR_CARGO: 'Air cargo',
  NORMAL_ROAD: 'Road',
  INSULATED_ROAD: 'Insulated road',
  REEFER_ROAD: 'Reefer road',
  LOCAL_PICKUP: 'Local pickup',
  SPECIAL_EXPRESS: 'Special express'
};

function jobState(j: LogisticsJob): string {
  if (j.status === 'DELIVERED') {
    return 'DELIVERED';
  }
  if (j.status === 'IN_TRANSIT') {
    return 'IN_TRANSIT';
  }
  if (j.pickup_at) {
    return 'READY_FOR_DISPATCH';
  }
  if (j.job_accepted_at) {
    return 'SUPPLY_CONFIRMED';
  }
  return 'PENDING_CONFIRMATION';
}

export function PartnerJobsPage({ deliveredOnly = false }: { deliveredOnly?: boolean }): JSX.Element {
  const [jobs, setJobs] = useState<LogisticsJob[] | null>(null);
  const [mineOnly, setMineOnly] = useState(false);

  useEffect(() => {
    setJobs(null);
    const load = mineOnly ? listDriverJobs : listPartnerJobs;
    load()
      .then((r) => setJobs(r.items))
      .catch(() => setJobs([]));
  }, [mineOnly]);

  const shown = (jobs ?? []).filter((j) => (deliveredOnly ? j.status === 'DELIVERED' : j.status !== 'DELIVERED'));

  return (
    <div data-testid="partner-jobs-page">
      <PageHeader
        overline="Logistics partner"
        title={deliveredOnly ? 'Delivered jobs' : 'Jobs'}
        testId="partner-jobs-header"
        actions={
          <button
            className="fs-btn fs-btn--ghost fs-btn--sm"
            data-testid="partner-jobs-toggle"
            aria-pressed={mineOnly}
            onClick={() => setMineOnly((v) => !v)}
          >
            {mineOnly ? 'My assigned jobs' : 'All organization jobs'}
          </button>
        }
      />
      {jobs === null && <SkeletonLoader variant="card" count={3} testId="partner-jobs-loading" />}
      {jobs !== null && shown.length === 0 && (
        <EmptyState
          title={deliveredOnly ? 'Nothing delivered yet' : 'No jobs right now'}
          hint={deliveredOnly
            ? 'Jobs you deliver will appear here with their proof of delivery.'
            : 'New pickup and delivery jobs assigned to your organization will appear here.'}
          testId="partner-jobs-empty"
        />
      )}
      <div className="fs-md-stack">
        {shown.map((j) => (
          <Link
            key={j.id}
            to={`/partner/logistics/jobs/${j.id}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
            data-testid={`partner-job-${j.id.slice(0, 8)}`}
          >
            <TaskCard
              title={`${j.ref} · ${MODE_LABEL[j.mode] ?? j.mode}`}
              meta={[
                j.origin_address ? `From ${j.origin_address}` : 'Pickup address on job',
                j.dest_address ? `To ${j.dest_address}` : 'Delivery address on job',
                j.package_count ? `${j.package_count} packages` : ''
              ].filter(Boolean)}
              status={jobState(j)}
              age={j.eta ? `ETA ${new Date(j.eta).toLocaleDateString('en-IN')}` : ''}
              testId={`partner-job-card-${j.id.slice(0, 8)}`}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
