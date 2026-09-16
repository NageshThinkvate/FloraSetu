import { useEffect, useState } from 'react';
import { adminRoles, RoleMatrixRow } from '../lib/api/admin';
import { PageHeader } from '../components/PageHeader';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';

// ADR-014: the seeded role/permission matrix, displayed read-only. Roles are static by
// architecture (Build 1) — there is deliberately no create/edit/delete or assignment UI.
export function AdminRolesPage(): JSX.Element {
  const [roles, setRoles] = useState<RoleMatrixRow[] | null>(null);
  const [error, setError] = useState('');

  const load = (): void => {
    setRoles(null);
    adminRoles()
      .then((r) => setRoles(r.items))
      .catch(() => setError("We couldn't load the role matrix. Try again."));
  };
  useEffect(load, []);

  return (
    <div data-testid="admin-roles-page">
      <PageHeader overline="Admin Control Plane" title="Roles & permissions" testId="admin-roles-header" />
      <p className="fs-body" data-testid="admin-roles-readonly-note">
        Roles are seeded and static by platform architecture. This matrix is read-only —
        access changes happen through organization membership governance, never by editing roles.
      </p>
      {error && (
        <InlineAlert variant="error" testId="admin-roles-error">
          {error}
          <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="admin-roles-retry" onClick={() => { setError(''); load(); }}>
            Retry
          </button>
        </InlineAlert>
      )}
      {roles === null && !error && <SkeletonLoader variant="card" count={4} testId="admin-roles-loading" />}
      {roles !== null && roles.length === 0 && (
        <EmptyState title="No roles to display" hint="Seeded system roles will appear here." testId="admin-roles-empty" />
      )}
      <div className="fs-md-stack" data-testid="admin-roles-list">
        {(roles ?? []).map((r) => (
          <div key={r.name} className="fs-card fs-md-card" data-testid={`admin-role-${r.name.toLowerCase().replace(/_/g, '-')}`}>
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{r.name.toLowerCase().replace(/_/g, ' ')}</span>
              {r.mfa_required && <span className="fs-body" data-testid={`admin-role-mfa-${r.name}`}>MFA required</span>}
            </div>
            <div className="fs-md-card__field-label">Permissions ({r.permissions.length})</div>
            <p className="fs-body" style={{ margin: 0 }} data-testid={`admin-role-perms-${r.name}`}>
              {r.permissions.map((p) => p.code).join(' · ') || 'No direct permissions'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
