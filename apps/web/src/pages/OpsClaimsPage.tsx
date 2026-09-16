import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClaimRow, fmtDate, listMyClaims } from '../lib/api/fulfilment';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';

const FILTERS: [string, string][] = [
  ['all', 'All'],
  ['triage', 'Needs triage'],
  ['review', 'In review'],
  ['follow', 'Resolution follow-through'],
  ['closed', 'Closed']
];

const GROUPS: Record<string, string[]> = {
  triage: ['SUBMITTED', 'EVIDENCE_VALIDATION'],
  review: ['COUNTERPARTY_RESPONSE', 'UNDER_REVIEW', 'PROPOSED_RESOLUTION'],
  follow: ['APPROVED', 'FINANCIAL_ADJUSTMENT', 'REPLACEMENT'],
  closed: ['CLOSED', 'REJECTED']
};

// Human next-action owners (§24) — mirrors the control tower's claim ownership map.
const CLAIM_OWNER: Record<string, string> = {
  DRAFT: 'Buyer', SUBMITTED: 'FloraSetu support', EVIDENCE_VALIDATION: 'FloraSetu support',
  COUNTERPARTY_RESPONSE: 'Supplier', UNDER_REVIEW: 'FloraSetu support',
  PROPOSED_RESOLUTION: 'Buyer', OPENED: 'FloraSetu support', DECIDED: 'FloraSetu finance',
  APPROVED: 'FloraSetu support', FINANCIAL_ADJUSTMENT: 'FloraSetu finance', REPLACEMENT: 'Supplier'
};

const categoryLabel = (v: string): string => v.toLowerCase().replace(/_/g, ' ');

// ADR-013: evidence-first claims workspace for support/reviewers. Staff visibility comes
// from claim.read/claim.manage (backend-enforced); decisions live on the detail page and
// render only for the explicit claim-resolution permission.
export function OpsClaimsPage(): JSX.Element {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = params.get('f') ?? 'all';
  const [claims, setClaims] = useState<ClaimRow[] | null>(null);
  const [error, setError] = useState('');

  const load = (): void => {
    setClaims(null);
    listMyClaims()
      .then((r) => setClaims(r.items))
      .catch(() => setError("We couldn't load the claims queue. Try again."));
  };
  useEffect(load, []);

  const shown = (claims ?? []).filter((c) => filter === 'all' || (GROUPS[filter] ?? []).includes(c.status));

  return (
    <div data-testid="ops-claims-page">
      <PageHeader overline="Operations" title="Claims & support" testId="ops-claims-header" />
      {error && (
        <InlineAlert variant="error" testId="ops-claims-error">
          {error}
          <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="ops-claims-retry" onClick={() => { setError(''); load(); }}>
            Retry
          </button>
        </InlineAlert>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--fs-space-2)', marginBottom: 'var(--fs-space-4)' }} data-testid="ops-claims-filters">
        {FILTERS.map(([v, label]) => (
          <button
            key={v}
            type="button"
            className={`fs-btn fs-btn--sm ${filter === v ? '' : 'fs-btn--ghost'}`}
            aria-pressed={filter === v}
            data-testid={`ops-claims-filter-${v}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (v === 'all') {
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
      {claims === null && !error && <SkeletonLoader variant="card" count={4} testId="ops-claims-loading" />}
      {claims !== null && shown.length === 0 && (
        <EmptyState
          title="No claims in this view"
          hint="Claims raised by buyers will appear here for support triage."
          testId="ops-claims-empty"
        />
      )}
      <div className="fs-md-stack" data-testid="ops-claims-list">
        {shown.map((c) => (
          <button
            key={c.id}
            type="button"
            className="fs-card fs-md-card"
            style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
            data-testid={`ops-claim-${c.ref}`}
            onClick={() => navigate(`/ops/claims/${c.id}`)}
          >
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{c.ref} · {categoryLabel(c.category)}</span>
              <StatusPill status={c.status} />
            </div>
            <div className="fs-md-card__fields">
              <div>
                <div className="fs-md-card__field-label">Claim type</div>
                <div className="fs-md-card__field-value">{categoryLabel(c.claim_type)}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Next action owner</div>
                <div className="fs-md-card__field-value" data-testid={`ops-claim-owner-${c.ref}`}>{CLAIM_OWNER[c.status] ?? 'FloraSetu support'}</div>
              </div>
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
