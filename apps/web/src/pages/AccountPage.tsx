import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../lib/api/auth';
import { apiGet, apiPost } from '../lib/api/client';

interface OrgDetail {
  id: string;
  ref: string;
  name: string;
  type: string;
  status: string;
  kyb_status: string;
}

interface BankAccount {
  id: string;
  account_ref: string;
  ifsc: string;
  account_number: string;
  holder_name: string;
  superseded: boolean;
}

interface Member {
  membership_id: string;
  status: string;
  user_id: string;
  display_name: string;
  roles: string[];
}

const SUPPLIER_SIDE = new Set(['GROWER', 'GROWER_GROUP', 'IMPORTER', 'AGGREGATION_HUB', 'WHOLESALER', 'QC_PARTNER', 'LOGISTICS_PROVIDER', 'COLD_CHAIN_PARTNER']);

export function AccountPage(): JSX.Element {
  const { me, activeOrgId, selectOrg, logout, refresh } = useAuth();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [bankForm, setBankForm] = useState({ accountRef: '', ifsc: '', accountNumber: '', holderName: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = async (): Promise<void> => {
    if (!activeOrgId) {
      return;
    }
    try {
      setOrg(await apiGet<OrgDetail>(`/orgs/${activeOrgId}`));
      setMembers((await apiGet<{ items: Member[] }>(`/orgs/${activeOrgId}/members`)).items);
      if (org && SUPPLIER_SIDE.has(org.type)) {
        setAccounts((await apiGet<{ items: BankAccount[] }>(`/orgs/${activeOrgId}/bank/accounts`)).items);
      }
    } catch {
      /* membership may be pending */
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, org?.type]);

  if (!me) {
    return <main className="app-shell" data-testid="account-page">Loading…</main>;
  }

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
    <main className="app-shell" data-testid="account-page">
      <header className="shell-header">
        <h1>Account</h1>
        <button className="ghost-btn" data-testid="logout-btn" onClick={() => void logout()}>Sign out</button>
      </header>

      <section className="panel" data-testid="profile-panel">
        <h2>{me.display_name}</h2>
        <p>{me.email} · MFA {me.mfaActive ? 'active' : 'not set up'}</p>
        {!me.mfaActive && (
          <div className="inline-form">
            {!mfaSecret ? (
              <button data-testid="mfa-enroll-btn" onClick={() => void run(async () => {
                const r = await apiPost<{ secret: string }>('/auth/mfa/enroll', {});
                setMfaSecret(r.secret);
              }, 'MFA enrollment started')}>Set up MFA</button>
            ) : (
              <>
                <p className="hint">Add this secret to your authenticator: <code data-testid="mfa-secret">{mfaSecret}</code></p>
                <input data-testid="mfa-code-input" placeholder="6-digit code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
                <button data-testid="mfa-verify-btn" onClick={() => void run(async () => {
                  await apiPost('/auth/mfa/verify', { code: mfaCode });
                  await refresh();
                }, 'MFA active')}>Verify</button>
              </>
            )}
          </div>
        )}
      </section>

      <section className="panel" data-testid="orgs-panel">
        <h2>My organizations</h2>
        <ul className="plain-list">
          {me.memberships.map((m) => (
            <li key={m.org_id}>
              <button
                className={m.org_id === activeOrgId ? 'org-pill active' : 'org-pill'}
                data-testid={`org-select-${m.org_id}`}
                onClick={() => selectOrg(m.org_id)}
              >
                {m.name} · {m.type} · {m.org_status}
                {m.membership_status !== 'ACTIVE' && ` (${m.membership_status.toLowerCase()})`}
              </button>
              {m.membership_status === 'INVITED' && (
                <button data-testid={`org-accept-${m.org_id}`} onClick={() => void run(async () => {
                  const detail = await apiGet<{ items: Member[] }>(`/orgs/${m.org_id}/members`).catch(() => null);
                  void detail;
                  await apiPost(`/orgs/${m.org_id}/members/accept/${m.org_id}`, {});
                }, 'Invitation accepted')}>Accept</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {org && (
        <section className="panel" data-testid="org-detail-panel">
          <h2>{org.name} <span className="state-chip">{org.ref}</span></h2>
          <p>Category: {org.type} · Status: {org.status} · KYB: <span data-testid="kyb-status">{org.kyb_status}</span></p>
          {org.kyb_status !== 'VERIFIED' && (
            <button data-testid="kyb-submit-btn" onClick={() => void run(() =>
              apiPost(`/orgs/${org.id}/kyb/submit`, {
                documents: [{ docType: 'GST', objectKey: `kyb/${org.id}/gst.pdf`, contentType: 'application/pdf', byteSize: 1024 }]
              }), 'KYB submitted for review')}>Submit KYB document</button>
          )}
        </section>
      )}

      {org && (
        <section className="panel" data-testid="members-panel">
          <h2>Members</h2>
          <ul className="plain-list">
            {members.map((m) => (
              <li key={m.membership_id} data-testid={`member-${m.user_id}`}>
                {m.display_name} — {m.roles.join(', ') || 'no roles'} ({m.status.toLowerCase()})
              </li>
            ))}
          </ul>
          <form className="inline-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => apiPost(`/orgs/${org.id}/members`, { email: inviteEmail }), 'Invitation sent'); }}>
            <input data-testid="invite-email" type="email" placeholder="invite by email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            <button type="submit" data-testid="invite-submit">Invite</button>
          </form>
        </section>
      )}

      {org && SUPPLIER_SIDE.has(org.type) && (
        <section className="panel" data-testid="bank-panel">
          <h2>Bank / payout profile</h2>
          <ul className="plain-list">
            {accounts.map((a) => (
              <li key={a.id} data-testid={`bank-account-${a.id}`}>
                {a.holder_name} · {a.ifsc} · {a.account_number} {a.superseded && '(superseded)'}
              </li>
            ))}
          </ul>
          <div className="inline-form bank-form">
            <input data-testid="bank-holder" placeholder="Account holder" value={bankForm.holderName} onChange={(e) => setBankForm({ ...bankForm, holderName: e.target.value })} />
            <input data-testid="bank-ifsc" placeholder="IFSC" value={bankForm.ifsc} onChange={(e) => setBankForm({ ...bankForm, ifsc: e.target.value })} />
            <input data-testid="bank-number" placeholder="Account number" value={bankForm.accountNumber} onChange={(e) => setBankForm({ ...bankForm, accountNumber: e.target.value })} />
            <button data-testid="bank-submit-btn" onClick={() => void run(() =>
              apiPost(`/orgs/${org.id}/bank/accounts`, { ...bankForm, accountRef: bankForm.holderName || 'PRIMARY' }),
              'Bank change submitted — pending reverification (payouts frozen)')}>Submit bank change</button>
          </div>
          <p className="hint">Bank changes enter PENDING_REVERIFICATION and require dual platform approval.</p>
        </section>
      )}

      {notice && <p className="form-ok" data-testid="account-notice">{notice}</p>}
      {error && <p className="form-error" data-testid="account-error">{error}</p>}
    </main>
  );
}
