import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClaimRow, fmtDate, listMyClaims } from '../lib/api/fulfilment';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';

const categoryLabel = (v: string): string => v.toLowerCase().replace(/_/g, ' ');

// Buyer issues list (Phase 8: design-system rebuild — functionality unchanged).
export function ClaimsPage(): JSX.Element {
  const navigate = useNavigate();
  const [claims, setClaims] = useState<ClaimRow[] | null>(null);
  const [error, setError] = useState('');

  const load = (): void => {
    setClaims(null);
    listMyClaims()
      .then((r) => setClaims(r.items))
      .catch(() => setError("We couldn't load your issues. Try again."));
  };
  useEffect(load, []);

  return (
    <div data-testid="claims-page">
      <PageHeader overline="Your purchases" title="Issues & claims" testId="claims-header" />
      <p className="fs-body">Raise an issue from a delivered order's page (“Report an issue”).</p>
      {error && (
        <InlineAlert variant="error" testId="claims-error">
          {error}
          <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="claims-retry" onClick={() => { setError(''); load(); }}>
            Retry
          </button>
        </InlineAlert>
      )}
      {claims === null && !error && <SkeletonLoader variant="card" count={3} testId="claims-loading" />}
      {claims !== null && claims.length === 0 && (
        <EmptyState
          title="No issues raised"
          hint="If something is wrong with a delivery, report it from the order and track it here."
          testId="claims-empty"
        />
      )}
      <div className="fs-md-stack" data-testid="claims-list-panel">
        {(claims ?? []).map((c) => (
          <button
            key={c.id}
            type="button"
            className="fs-card fs-md-card"
            style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
            data-testid={`claim-row-${c.id}`}
            onClick={() => navigate(`/buyer/issues/${c.id}`)}
          >
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{c.ref} · {categoryLabel(c.category)}</span>
              <StatusPill status={c.status} />
            </div>
            <div className="fs-md-card__fields">
              <div>
                <div className="fs-md-card__field-label">Raised</div>
                <div className="fs-md-card__field-value">{fmtDate(c.created_at)}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Supplier response</div>
                <div className="fs-md-card__field-value">{c.response_at ? 'Received' : 'Not yet'}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
