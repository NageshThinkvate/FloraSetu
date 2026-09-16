import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AdminOrg, adminOrgs } from '../lib/api/admin';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';

const TYPE_FILTERS: [string, string][] = [
  ['all', 'All types'], ['BUYER', 'Buyer'], ['GROWER', 'Grower'], ['LOGISTICS_PROVIDER', 'Logistics'],
  ['COLD_CHAIN_PARTNER', 'Cold-chain'], ['PLATFORM_OPS', 'Platform']
];
const STATUS_FILTERS: [string, string][] = [
  ['all', 'Any status'], ['ACTIVE', 'Active'], ['SUSPENDED', 'Suspended']
];
const KYB_FILTERS: [string, string][] = [
  ['all', 'Any verification'], ['NOT_STARTED', 'Not started'], ['IN_REVIEW', 'In review'],
  ['VERIFIED', 'Verified'], ['REJECTED', 'Rejected']
];

const typeLabel = (v: string): string => v.toLowerCase().replace(/_/g, ' ');

// ADR-014: organization governance. Masked fields only — bank/KYC data never lists here.
export function AdminOrganizationsPage(): JSX.Element {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const type = params.get('type') ?? 'all';
  const status = params.get('status') ?? 'all';
  const kyb = params.get('kyb') ?? 'all';
  const [orgs, setOrgs] = useState<AdminOrg[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = (): void => {
    setOrgs(null);
    adminOrgs()
      .then((r) => setOrgs(r.items))
      .catch(() => setError("We couldn't load organizations. Try again."));
  };
  useEffect(load, []);

  const setParam = (key: string, value: string): void => {
    const next = new URLSearchParams(params);
    if (value === 'all') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  const shown = (orgs ?? []).filter((o) =>
    (type === 'all' || o.type === type)
    && (status === 'all' || o.status === status)
    && (kyb === 'all' || o.kyb_status === kyb)
    && (!query.trim()
      || o.name.toLowerCase().includes(query.trim().toLowerCase())
      || o.ref.toLowerCase().includes(query.trim().toLowerCase())));

  const filterRow = (label: string, key: string, options: [string, string][], current: string, testId: string): JSX.Element => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--fs-space-2)', alignItems: 'center' }} data-testid={testId}>
      <span className="fs-body" style={{ margin: 0 }}>{label}</span>
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          className={`fs-btn fs-btn--sm ${current === v ? '' : 'fs-btn--ghost'}`}
          aria-pressed={current === v}
          data-testid={`${testId}-${v.toLowerCase().replace(/_/g, '-')}`}
          onClick={() => setParam(key, v)}
        >
          {l}
        </button>
      ))}
    </div>
  );

  return (
    <div data-testid="admin-orgs-page">
      <PageHeader overline="Admin Control Plane" title="Organizations" testId="admin-orgs-header" />
      {error && (
        <InlineAlert variant="error" testId="admin-orgs-error">
          {error}
          <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="admin-orgs-retry" onClick={() => { setError(''); load(); }}>
            Retry
          </button>
        </InlineAlert>
      )}
      <div className="fs-field" style={{ maxWidth: 420 }} data-testid="admin-orgs-search-wrap">
        <label className="fs-field__label" htmlFor="admin-orgs-search">Search by name or reference</label>
        <input
          id="admin-orgs-search"
          className="fs-input"
          data-testid="admin-orgs-search"
          placeholder="e.g. Nilgiri Fresh, ORG-2026-…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="fs-md-stack" style={{ marginBottom: 'var(--fs-space-4)' }}>
        {filterRow('Type', 'type', TYPE_FILTERS, type, 'admin-orgs-type')}
        {filterRow('Status', 'status', STATUS_FILTERS, status, 'admin-orgs-status')}
        {filterRow('Verification', 'kyb', KYB_FILTERS, kyb, 'admin-orgs-kyb')}
      </div>
      {orgs === null && !error && <SkeletonLoader variant="card" count={4} testId="admin-orgs-loading" />}
      {orgs !== null && shown.length === 0 && (
        <EmptyState title="No organizations match" hint="Adjust the filters or search." testId="admin-orgs-empty" />
      )}
      <div className="fs-md-stack" data-testid="admin-orgs-list">
        {shown.map((o) => (
          <button
            key={o.id}
            type="button"
            className="fs-card fs-md-card"
            style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
            data-testid={`admin-org-${o.ref}`}
            onClick={() => navigate(`/admin/organizations/${o.id}`)}
          >
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{o.name}</span>
              <StatusPill status={o.status} />
            </div>
            <div className="fs-md-card__fields">
              <div>
                <div className="fs-md-card__field-label">Reference</div>
                <div className="fs-md-card__field-value">{o.ref}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Type</div>
                <div className="fs-md-card__field-value">{typeLabel(o.type)}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Verification</div>
                <div className="fs-md-card__field-value"><StatusPill status={o.kyb_status} /></div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Capabilities</div>
                <div className="fs-md-card__field-value">{o.capabilities.length > 0 ? o.capabilities.map(typeLabel).join(', ') : '—'}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
