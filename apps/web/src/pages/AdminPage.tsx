import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api/client';
import { useAuth } from '../lib/api/auth';

interface AdminOrg {
  id: string;
  ref: string;
  name: string;
  type: string;
  status: string;
  kyb_status: string;
}

interface ChangeRequest {
  id: string;
  status: string;
  payout_freeze: boolean;
  created_at: string;
}

export function AdminPage(): JSX.Element {
  const { activeOrgId } = useAuth();
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [selected, setSelected] = useState<AdminOrg | null>(null);
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = async (): Promise<void> => {
    try {
      setOrgs((await apiGet<{ items: AdminOrg[] }>('/admin/orgs')).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Not authorized');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  return (
    <main className="app-shell" data-testid="admin-page">
      <header className="shell-header">
        <h1>Platform administration</h1>
      </header>
      <section className="panel">
        <h2>Organizations</h2>
        <div className="table-wrap">
        <table className="data-table" data-testid="admin-orgs-table">
          <thead>
            <tr><th>Ref</th><th>Name</th><th>Type</th><th>Status</th><th>KYB</th><th></th></tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} data-testid={`admin-org-${o.id}`}>
                <td>{o.ref}</td><td>{o.name}</td><td>{o.type}</td><td>{o.status}</td><td>{o.kyb_status}</td>
                <td>
                  <button className="ghost-btn" data-testid={`admin-org-open-${o.id}`} onClick={() => setSelected(o)}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      {selected && (
        <section className="panel" data-testid="admin-org-detail">
          <h2>{selected.name} <span className="state-chip">{selected.ref}</span></h2>
          <div className="inline-form">
            {selected.kyb_status === 'IN_REVIEW' && (
              <>
                <button data-testid="kyb-verify-btn" onClick={() => void run(() =>
                  apiPost(`/admin/kyb/${selected.id}/review`, { decision: 'VERIFIED' }), 'KYB verified')}>Verify KYB</button>
                <button data-testid="kyb-reject-btn" onClick={() => void run(() =>
                  apiPost(`/admin/kyb/${selected.id}/review`, { decision: 'REJECTED', note: 'documents unclear' }), 'KYB rejected')}>Reject KYB</button>
              </>
            )}
            {selected.status === 'ACTIVE' ? (
              <>
                <input data-testid="restrict-reason" placeholder="suspension reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button data-testid="restrict-btn" onClick={() => void run(() =>
                  apiPost(`/admin/orgs/${selected.id}/restrict`, { reason }), 'Organization suspended')}>Suspend</button>
              </>
            ) : (
              <button data-testid="lift-btn" onClick={() => void run(() =>
                apiPost(`/admin/orgs/${selected.id}/lift`, {}), 'Restriction lifted')}>Lift suspension</button>
            )}
            <button className="ghost-btn" data-testid="load-bank-changes" onClick={() => void run(async () => {
              setChangeRequests((await apiGet<{ items: ChangeRequest[] }>(`/orgs/${selected.id}/bank/change-requests`)).items);
            }, 'Change requests loaded')}>Bank change requests</button>
          </div>
          {changeRequests.length > 0 && (
            <ul className="plain-list" data-testid="bank-change-list">
              {changeRequests.map((c) => (
                <li key={c.id}>
                  {c.status} · freeze: {String(c.payout_freeze)} · {new Date(c.created_at).toLocaleString()}
                  {['PENDING_REVERIFICATION', 'APPROVED_FIRST'].includes(c.status) && (
                    <button data-testid={`approve-change-${c.id}`} onClick={() => void run(() =>
                      apiPost(`/orgs/${selected.id}/bank/change-requests/${c.id}/approve`, {}), `Approval recorded`)}>Approve</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {notice && <p className="form-ok" data-testid="admin-notice">{notice}</p>}
      {error && <p className="form-error" data-testid="admin-error">{error}</p>}
    </main>
  );
}
