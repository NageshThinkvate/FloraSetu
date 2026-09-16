import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listDriverJobs, listPartnerJobs, LogisticsJob } from '../lib/api/logistics';
import { useAuth } from '../lib/api/auth';
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

const isToday = (v: string | null): boolean => !!v && new Date(v).toDateString() === new Date().toDateString();

// List-level hint only — the job detail page gates actions on the backend event timeline.
export function nextAction(j: LogisticsJob): string {
  if (j.status === 'DELIVERED') {
    return 'Completed';
  }
  if (!j.job_accepted_at) {
    return 'Accept job';
  }
  if (!j.arrived_pickup_at) {
    return 'Arrived at pickup';
  }
  if (j.status === 'PLANNED') {
    return 'Confirm pickup / start transit';
  }
  if (!j.arrived_delivery_at) {
    return 'Arrived at delivery';
  }
  return 'Deliver + submit POD';
}

type Bucket =
  | 'all' | 'new' | 'pickup-today' | 'awaiting-pickup' | 'in-transit'
  | 'delivery-today' | 'pod-missing' | 'exceptions' | 'delivered';

const BUCKET_LABEL: [Bucket, string][] = [
  ['all', 'All'],
  ['new', 'New'],
  ['pickup-today', 'Pickup today'],
  ['awaiting-pickup', 'Awaiting pickup'],
  ['in-transit', 'In progress'],
  ['delivery-today', 'Delivery today'],
  ['pod-missing', 'POD missing'],
  ['exceptions', 'Exceptions'],
  ['delivered', 'Delivered']
];

function inBucket(j: LogisticsJob, b: Bucket): boolean {
  switch (b) {
    case 'new':
      return !j.job_accepted_at && j.status !== 'DELIVERED';
    case 'pickup-today':
      return j.status === 'PLANNED' && isToday(j.pickup_at);
    case 'awaiting-pickup':
      return !!j.job_accepted_at && j.status === 'PLANNED';
    case 'in-transit':
      return j.status === 'IN_TRANSIT';
    case 'delivery-today':
      return j.status === 'IN_TRANSIT' && isToday(j.eta);
    case 'pod-missing':
      return !!j.arrived_delivery_at && j.status !== 'DELIVERED';
    case 'exceptions':
      return j.open_exceptions > 0 && j.status !== 'DELIVERED';
    case 'delivered':
      return j.status === 'DELIVERED';
    default:
      return true;
  }
}

export function PartnerJobsPage({ deliveredOnly = false }: { deliveredOnly?: boolean }): JSX.Element {
  const { me, activeOrgId } = useAuth();
  const isManager = me?.memberships.find((m) => m.org_id === activeOrgId)?.roles.includes('ORG_ADMIN') ?? false;
  const [params, setParams] = useSearchParams();
  const bucket = (deliveredOnly ? 'delivered' : (params.get('f') ?? 'all')) as Bucket;
  const modeFilter = params.get('mode') ?? '';
  const [jobs, setJobs] = useState<LogisticsJob[] | null>(null);
  const [mineOnly, setMineOnly] = useState<boolean | null>(null);

  // Drivers default to "my assigned jobs"; partner managers see the whole organization.
  const effectiveMineOnly = mineOnly ?? !isManager;

  useEffect(() => {
    setJobs(null);
    const load = effectiveMineOnly ? listDriverJobs : listPartnerJobs;
    load()
      .then((r) => setJobs(r.items))
      .catch(() => setJobs([]));
  }, [effectiveMineOnly]);

  const shown = (jobs ?? []).filter((j) => inBucket(j, bucket) && (!modeFilter || j.mode === modeFilter));

  const setFilter = (b: Bucket): void => {
    const next = new URLSearchParams(params);
    if (b === 'all') {
      next.delete('f');
    } else {
      next.set('f', b);
    }
    setParams(next, { replace: true });
  };

  return (
    <div data-testid="partner-jobs-page">
      <PageHeader
        overline="Logistics partner"
        title={deliveredOnly ? 'Delivered jobs' : 'Logistics jobs'}
        testId="partner-jobs-header"
        actions={
          isManager ? (
            <button
              className="fs-btn fs-btn--ghost fs-btn--sm"
              data-testid="partner-jobs-toggle"
              aria-pressed={effectiveMineOnly}
              onClick={() => setMineOnly((v) => !(v ?? false))}
            >
              {effectiveMineOnly ? 'My assigned jobs' : 'All organization jobs'}
            </button>
          ) : undefined
        }
      />
      {!deliveredOnly && (
        <div data-testid="partner-jobs-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--fs-space-2)', marginBottom: 'var(--fs-space-4)' }}>
          {BUCKET_LABEL.map(([b, label]) => (
            <button
              key={b}
              type="button"
              className={`fs-btn fs-btn--sm ${bucket === b ? '' : 'fs-btn--ghost'}`}
              data-testid={`partner-filter-${b}`}
              aria-pressed={bucket === b}
              onClick={() => setFilter(b)}
            >
              {label}
            </button>
          ))}
          <select
            className="fs-select"
            style={{ maxWidth: 180 }}
            data-testid="partner-filter-mode"
            value={modeFilter}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) {
                next.set('mode', e.target.value);
              } else {
                next.delete('mode');
              }
              setParams(next, { replace: true });
            }}
          >
            <option value="">All transport modes</option>
            {Object.entries(MODE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      )}
      {jobs === null && <SkeletonLoader variant="card" count={3} testId="partner-jobs-loading" />}
      {jobs !== null && shown.length === 0 && (
        <EmptyState
          title={deliveredOnly ? 'Nothing delivered yet' : 'No jobs in this view'}
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
              title={`${j.ref} · ${MODE_LABEL[j.mode ?? ''] ?? j.mode ?? 'Transport'}`}
              meta={[
                j.origin_text ? `Pickup: ${j.origin_text}` : '',
                j.destination_text ? `Deliver: ${j.destination_text}` : '',
                j.package_count != null ? `${j.package_count} packages` : '',
                j.driver_name ? `Driver: ${j.driver_name}` : (j.status !== 'DELIVERED' ? 'Driver not assigned' : ''),
                j.open_exceptions > 0 ? 'Issue reported — see job' : '',
                `Next: ${nextAction(j)}`
              ].filter(Boolean)}
              status={j.status}
              age={j.eta ? `ETA ${new Date(j.eta).toLocaleDateString('en-IN')}` : ''}
              testId={`partner-job-card-${j.id.slice(0, 8)}`}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
