import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AdminOrg, adminOrg, liftOrg, restrictOrg } from '../lib/api/admin';
import { apiGet } from '../lib/api/client';
import { useAuth } from '../lib/api/auth';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';

interface MemberRow { user_id: string; email: string; display_name: string; status: string; roles: string[] }
interface KybHistoryItem { to_status: string; reason_code: string | null; note: string | null; created_at: string }
interface AuditItem { action: string; object_type: string; occurred_at: string }

const fmtDateTime = (v: string): string =>
  new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const typeLabel = (v: string): string => v.toLowerCase().replace(/_/g, ' ');

// ADR-014: organization detail — identity, verification, members, capabilities, security
// status and administrative audit. Bank/KYC detail is deliberately NOT shown here.
export function AdminOrgDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { me, activeOrgId } = useAuth();
  const roles = me?.memberships.find((m) => m.org_id === activeOrgId)?.roles ?? [];
  const canRestrict = roles.includes('PLATFORM_ADMIN');

  const [org, setOrg] = useState<AdminOrg | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [history, setHistory] = useState<KybHistoryItem[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    if (!id) {
      return;
    }
    setOrg(await adminOrg(id));
    // Independent sections: a denied/empty section never blanks the whole page.
    apiGet<{ items: MemberRow[] }>(`/orgs/${id}/members`).then((r) => setMembers(r.items)).catch(() => setMembers([]));
    apiGet<{ items: KybHistoryItem[] }>(`/orgs/${id}/kyb/history`).then((r) => setHistory(r.items)).catch(() => setHistory([]));
    apiGet<{ items: AuditItem[] }>(`/admin/audit?orgId=${id}`).then((r) => setAudit(r.items.slice(0, 15))).catch(() => setAudit([]));
  };
  useEffect(() => {
    void load().catch(() => setError("We couldn't load this organization."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError(''); setNotice(''); setBusy(true);
    try {
      await fn();
      setNotice(ok);
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !org) {
    return (
      <div data-testid="admin-org-denied">
        <PageHeader overline="Admin Control Plane" title="Organization" testId="admin-org-header" />
        <InlineAlert variant="error" testId="admin-org-error">{error}</InlineAlert>
      </div>
    );
  }
  if (!org) {
    return (
      <div data-testid="admin-org-loading">
        <PageHeader overline="Admin Control Plane" title="Organization" testId="admin-org-header" />
        <SkeletonLoader variant="card" count={3} testId="admin-org-skeleton" />
      </div>
    );
  }

  return (
    <div data-testid="admin-org-page">
      <PageHeader overline="Admin Control Plane" title={org.name} testId="admin-org-header" />
      {error && <InlineAlert variant="error" testId="admin-org-error-inline">{error}</InlineAlert>}
      {notice && <InlineAlert variant="success" testId="admin-org-notice">{notice}</InlineAlert>}

      <div className="fs-card fs-md-card" data-testid="admin-org-identity">
        <div className="fs-task-card__top">
          <span className="fs-md-card__primary">Identity</span>
          <StatusPill status={org.status} />
        </div>
        <div className="fs-md-card__fields">
          <div><div className="fs-md-card__field-label">Reference</div><div className="fs-md-card__field-value">{org.ref}</div></div>
          <div><div className="fs-md-card__field-label">Type</div><div className="fs-md-card__field-value">{typeLabel(org.type)}</div></div>
          <div><div className="fs-md-card__field-label">Verification</div><div className="fs-md-card__field-value"><StatusPill status={org.kyb_status} /></div></div>
          <div><div className="fs-md-card__field-label">On platform since</div><div className="fs-md-card__field-value">{fmtDateTime(org.created_at)}</div></div>
        </div>
      </div>

      <div className="fs-card fs-md-card" data-testid="admin-org-capabilities">
        <div className="fs-md-card__field-label">Capabilities</div>
        <p className="fs-body" style={{ margin: 0 }}>
          {org.capabilities.length > 0 ? org.capabilities.map(typeLabel).join(', ') : 'No special capabilities'}
        </p>
      </div>

      <div className="fs-card fs-md-card" data-testid="admin-org-members">
        <div className="fs-md-card__field-label">Members ({org.member_count ?? members.length})</div>
        {members.length === 0 && <p className="fs-body" style={{ margin: 0 }}>Member details are not available to your role.</p>}
        {members.map((m) => (
          <p key={m.user_id} className="fs-body" style={{ margin: 0 }} data-testid={`admin-org-member-${m.user_id.slice(0, 8)}`}>
            {m.display_name} · {m.email} · {m.roles.map(typeLabel).join(', ') || 'member'} · {m.status.toLowerCase()}
          </p>
        ))}
      </div>

      <div className="fs-card fs-md-card" data-testid="admin-org-verification">
        <div className="fs-md-card__field-label">Verification history</div>
        {history.length === 0 && <p className="fs-body" style={{ margin: 0 }}>No verification activity yet.</p>}
        {history.map((h, i) => (
          <p key={i} className="fs-body" style={{ margin: 0 }} data-testid={`admin-org-kyb-history-${i}`}>
            {h.to_status === 'REJECTED' && h.reason_code === 'CORRECTION_REQUIRED' ? 'Correction requested' : typeLabel(h.to_status)}
            {h.note ? ` — ${h.note}` : ''} · {fmtDateTime(h.created_at)}
          </p>
        ))}
      </div>

      <div className="fs-card fs-md-card" data-testid="admin-org-security">
        <div className="fs-task-card__top">
          <span className="fs-md-card__primary">Status & restrictions</span>
          <StatusPill status={org.status} />
        </div>
        {canRestrict && org.status === 'ACTIVE' && (
          <div className="fs-md-stack">
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="admin-org-reason">Suspension reason (required, audited)</label>
              <input
                id="admin-org-reason"
                className="fs-input"
                data-testid="admin-org-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <button
              className="fs-btn fs-btn--danger"
              disabled={busy || !reason.trim()}
              data-testid="admin-org-suspend"
              onClick={() => void act(() => restrictOrg(org.id, reason.trim()), 'Organization suspended. Records are preserved; transactional privileges are revoked.')}
            >
              Suspend organization
            </button>
          </div>
        )}
        {canRestrict && org.status === 'SUSPENDED' && (
          <button
            className="fs-btn"
            disabled={busy}
            data-testid="admin-org-lift"
            onClick={() => void act(() => liftOrg(org.id), 'Organization reactivated. The suspension period remains in history.')}
          >
            Reactivate organization
          </button>
        )}
        <p className="fs-body" style={{ margin: 0 }}>
          Suspension never deletes records or rewrites financial history; reactivation is audited too.
        </p>
      </div>

      <div className="fs-card fs-md-card" data-testid="admin-org-audit">
        <div className="fs-md-card__field-label">Recent administrative changes</div>
        {audit.length === 0 && <p className="fs-body" style={{ margin: 0 }}>No administrative events for this organization.</p>}
        {audit.map((a, i) => (
          <p key={i} className="fs-body" style={{ margin: 0 }} data-testid={`admin-org-audit-${i}`}>
            {a.action} · {fmtDateTime(a.occurred_at)}
          </p>
        ))}
      </div>
    </div>
  );
}
