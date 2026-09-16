import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KybQueueRow, kybQueue } from '../lib/api/admin';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';

const FILTERS: [string, string][] = [
  ['IN_REVIEW', 'Awaiting review'],
  ['REJECTED', 'Correction requested / rejected'],
  ['VERIFIED', 'Approved'],
  ['all', 'All']
];

const ageLabel = (iso: string | null): string => {
  if (!iso) {
    return '—';
  }
  const h = (Date.now() - new Date(iso).getTime()) / 3600e3;
  if (h < 24) {
    return `${Math.max(1, Math.round(h))} hrs`;
  }
  return `${Math.round(h / 24)} days`;
};

const rowLabel = (r: KybQueueRow): string =>
  r.kyb_status === 'REJECTED' && r.last_reason_code === 'CORRECTION_REQUIRED' ? 'Correction requested' : '';

// ADR-014: KYB review queue — visible only to kyb.review holders (backend-enforced).
export function AdminKybQueuePage(): JSX.Element {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = params.get('f') ?? 'IN_REVIEW';
  const [items, setItems] = useState<KybQueueRow[] | null>(null);
  const [error, setError] = useState('');

  const load = (): void => {
    setItems(null);
    kybQueue()
      .then((r) => setItems(r.items))
      .catch(() => setError("We couldn't load the review queue. Try again."));
  };
  useEffect(load, []);

  const shown = (items ?? []).filter((r) => filter === 'all' || r.kyb_status === filter);

  return (
    <div data-testid="admin-kyb-page">
      <PageHeader overline="Admin Control Plane" title="Business verification reviews" testId="admin-kyb-header" />
      {error && (
        <InlineAlert variant="error" testId="admin-kyb-error">
          {error}
          <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="admin-kyb-retry" onClick={() => { setError(''); load(); }}>
            Retry
          </button>
        </InlineAlert>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--fs-space-2)', marginBottom: 'var(--fs-space-4)' }} data-testid="admin-kyb-filters">
        {FILTERS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={`fs-btn fs-btn--sm ${filter === v ? '' : 'fs-btn--ghost'}`}
            aria-pressed={filter === v}
            data-testid={`admin-kyb-filter-${v.toLowerCase().replace(/_/g, '-')}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (v === 'IN_REVIEW') {
                next.delete('f');
              } else {
                next.set('f', v);
              }
              setParams(next, { replace: true });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {items === null && !error && <SkeletonLoader variant="card" count={4} testId="admin-kyb-loading" />}
      {items !== null && shown.length === 0 && (
        <EmptyState
          title="Nothing in this queue"
          hint="Organizations that submit verification documents will appear here."
          testId="admin-kyb-empty"
        />
      )}
      <div className="fs-md-stack" data-testid="admin-kyb-list">
        {shown.map((r) => (
          <button
            key={r.id}
            type="button"
            className="fs-card fs-md-card"
            style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
            data-testid={`admin-kyb-${r.ref}`}
            onClick={() => navigate(`/admin/kyb/${r.id}`)}
          >
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{r.name}</span>
              <StatusPill status={r.kyb_status} label={rowLabel(r) || undefined} />
            </div>
            <div className="fs-md-card__fields">
              <div>
                <div className="fs-md-card__field-label">Reference</div>
                <div className="fs-md-card__field-value">{r.ref}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Type</div>
                <div className="fs-md-card__field-value">{r.type.toLowerCase().replace(/_/g, ' ')}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Documents</div>
                <div className="fs-md-card__field-value">{r.document_count}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">{r.kyb_status === 'IN_REVIEW' ? 'Waiting' : 'Decided'}</div>
                <div className="fs-md-card__field-value">
                  {r.kyb_status === 'IN_REVIEW' ? ageLabel(r.last_submitted_at) : ageLabel(r.decided_at)}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
