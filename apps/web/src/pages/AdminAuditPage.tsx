import { FormEvent, useEffect, useState } from 'react';
import { adminAudit, adminAuditExport, AuditRow } from '../lib/api/admin';
import { PageHeader } from '../components/PageHeader';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';

const fmtDateTime = (v: string): string =>
  new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// ADR-014: audit inspection for authorized admin/auditor roles. Events are immutable —
// this page searches, inspects and exports; it can never edit, delete or backdate.
// Exports carry event identifiers and never include secrets or bank data.
export function AdminAuditPage(): JSX.Element {
  const [items, setItems] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ action: '', objectType: '', traceId: '', from: '', to: '' });

  const load = (f = filters): void => {
    setItems(null);
    adminAudit(f)
      .then((r) => setItems(r.items))
      .catch(() => setError("We couldn't search the audit log. Try again."));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load({ action: '', objectType: '', traceId: '', from: '', to: '' }), []);

  const search = (e: FormEvent): void => {
    e.preventDefault();
    setError('');
    load();
  };

  const field = (key: keyof typeof filters, label: string, testId: string, type = 'text'): JSX.Element => (
    <div className="fs-field">
      <label className="fs-field__label" htmlFor={testId}>{label}</label>
      <input
        id={testId}
        className="fs-input"
        data-testid={testId}
        type={type}
        value={filters[key]}
        onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div data-testid="admin-audit-page">
      <PageHeader
        overline="Admin Control Plane"
        title="Audit logs"
        testId="admin-audit-header"
        actions={
          <button
            className="fs-btn fs-btn--secondary fs-btn--sm"
            data-testid="admin-audit-export"
            onClick={() => void adminAuditExport(filters).catch(() => setError('Export failed. Try again.'))}
          >
            Export CSV
          </button>
        }
      />
      <p className="fs-body" data-testid="admin-audit-note">
        Audit events are immutable. Corrections always happen through new events — nothing here can be edited or deleted.
      </p>
      {error && <InlineAlert variant="error" testId="admin-audit-error">{error}</InlineAlert>}
      <form onSubmit={search} className="fs-md-stack" style={{ maxWidth: 520 }} data-testid="admin-audit-filters">
        {field('action', 'Action (e.g. org.kyb.review)', 'admin-audit-action')}
        {field('objectType', 'Object type (e.g. organization)', 'admin-audit-object-type')}
        {field('traceId', 'Trace ID', 'admin-audit-trace')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--fs-space-3)' }}>
          {field('from', 'From', 'admin-audit-from', 'datetime-local')}
          {field('to', 'To', 'admin-audit-to', 'datetime-local')}
        </div>
        <button type="submit" className="fs-btn fs-btn--sm" data-testid="admin-audit-search">Search</button>
      </form>
      {items === null && !error && <SkeletonLoader variant="card" count={4} testId="admin-audit-loading" />}
      {items !== null && items.length === 0 && (
        <EmptyState title="No events match" hint="Adjust the filters." testId="admin-audit-empty" />
      )}
      <div className="fs-md-stack" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="admin-audit-list">
        {(items ?? []).map((a) => (
          <div key={a.id} className="fs-card fs-md-card" data-testid={`admin-audit-${a.id.slice(0, 8)}`}>
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{a.action}</span>
              <span className="fs-body">{fmtDateTime(a.occurred_at)}</span>
            </div>
            <div className="fs-md-card__fields">
              <div>
                <div className="fs-md-card__field-label">Object</div>
                <div className="fs-md-card__field-value">{a.object_type}{a.object_ref ? ` · ${a.object_ref}` : ''}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Actor roles</div>
                <div className="fs-md-card__field-value">{a.actor_roles.map((r) => r.toLowerCase().replace(/_/g, ' ')).join(', ') || '—'}</div>
              </div>
              <div>
                <div className="fs-md-card__field-label">Trace</div>
                <div className="fs-md-card__field-value">{a.trace_id ? a.trace_id.slice(0, 8) : '—'}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
