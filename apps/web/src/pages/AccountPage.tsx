import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../lib/api/auth';
import { apiGet, apiPost } from '../lib/api/client';
import { uploadMedia } from '../lib/api/fulfilment';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';

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
const KYB_DOC_TYPES: [string, string][] = [
  ['GST', 'GST certificate'], ['PAN', 'PAN'], ['TRADE_LICENSE', 'Trade license'], ['OTHER', 'Other document']
];
const typeLabel = (v: string): string => v.toLowerCase().replace(/_/g, ' ');

// Account & organization (Phase 8: design-system rebuild). KYB submission now uses the
// REAL media upload flow — the legacy hardcoded 1KB placeholder document is gone.
export function AccountPage(): JSX.Element {
  const { me, activeOrgId, selectOrg, logout, refresh } = useAuth();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [kybDocType, setKybDocType] = useState('GST');
  const [bankForm, setBankForm] = useState({ accountRef: '', ifsc: '', accountNumber: '', holderName: '' });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    if (!activeOrgId) {
      return;
    }
    try {
      const detail = await apiGet<OrgDetail>(`/orgs/${activeOrgId}`);
      setOrg(detail);
      setMembers((await apiGet<{ items: Member[] }>(`/orgs/${activeOrgId}/members`)).items);
      if (SUPPLIER_SIDE.has(detail.type)) {
        setAccounts((await apiGet<{ items: BankAccount[] }>(`/orgs/${activeOrgId}/bank/accounts`)).items);
      }
    } catch {
      /* membership may be pending */
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  if (!me) {
    return (
      <div data-testid="account-page">
        <PageHeader overline="Account" title="Account & organization" testId="account-header" />
        <SkeletonLoader variant="card" count={2} testId="account-loading" />
      </div>
    );
  }

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError(''); setNotice(''); setBusy(true);
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const submitKyb = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!org) {
      return;
    }
    const input = (e.target as HTMLFormElement).querySelector<HTMLInputElement>('input[type=file]');
    const file = input?.files?.[0];
    if (!file) {
      setError('Choose the document file first.');
      return;
    }
    await run(async () => {
      const media = await uploadMedia(file, 'kyb');
      await apiPost(`/orgs/${org.id}/kyb/submit`, {
        documents: [{ docType: kybDocType, objectKey: media.objectKey, contentType: file.type || 'application/pdf', byteSize: file.size }]
      });
    }, 'Document submitted for verification review.');
  };

  return (
    <div data-testid="account-page">
      <PageHeader
        overline="Account"
        title="Account & organization"
        testId="account-header"
        actions={<button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="logout-btn" onClick={() => void logout()}>Sign out</button>}
      />
      {notice && <InlineAlert variant="success" testId="account-notice">{notice}</InlineAlert>}
      {error && <InlineAlert variant="error" testId="account-error">{error}</InlineAlert>}

      <div className="fs-card fs-md-card" data-testid="profile-panel">
        <div className="fs-task-card__top">
          <span className="fs-md-card__primary">{me.display_name}</span>
          <span className="fs-body">{me.mfaActive ? 'MFA active' : 'MFA not set up'}</span>
        </div>
        <p className="fs-body" style={{ margin: 0 }}>{me.email}</p>
        {!me.mfaActive && (
          <div className="fs-md-stack">
            {!mfaSecret ? (
              <button
                className="fs-btn fs-btn--sm fs-btn--secondary"
                data-testid="mfa-enroll-btn"
                disabled={busy}
                onClick={() => void run(async () => {
                  const r = await apiPost<{ secret: string }>('/auth/mfa/enroll', {});
                  setMfaSecret(r.secret);
                }, 'MFA enrollment started. Add the secret to your authenticator app.')}
              >
                Set up MFA
              </button>
            ) : (
              <>
                <p className="fs-body" style={{ margin: 0 }}>
                  Add this secret to your authenticator app: <strong data-testid="mfa-secret">{mfaSecret}</strong>
                </p>
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor="mfa-code-input">6-digit code</label>
                  <input
                    id="mfa-code-input"
                    className="fs-input"
                    data-testid="mfa-code-input"
                    inputMode="numeric"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                  />
                </div>
                <button
                  className="fs-btn fs-btn--sm"
                  data-testid="mfa-verify-btn"
                  disabled={busy || mfaCode.trim().length !== 6}
                  onClick={() => void run(async () => {
                    await apiPost('/auth/mfa/verify', { code: mfaCode });
                    await refresh();
                  }, 'MFA is now active on your account.')}
                >
                  Verify & activate
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="fs-card fs-md-card" data-testid="orgs-panel">
        <div className="fs-md-card__field-label">My organizations</div>
        <div className="fs-md-stack">
          {me.memberships.map((m) => (
            <div key={m.org_id} className="fs-task-card__top">
              <button
                className={`fs-btn fs-btn--sm ${m.org_id === activeOrgId ? '' : 'fs-btn--ghost'}`}
                aria-pressed={m.org_id === activeOrgId}
                data-testid={`org-select-${m.org_id}`}
                onClick={() => selectOrg(m.org_id)}
              >
                {m.name} · {typeLabel(m.type)} · {typeLabel(m.org_status)}
                {m.membership_status !== 'ACTIVE' && ` (${m.membership_status.toLowerCase()})`}
              </button>
              {m.membership_status === 'INVITED' && (
                <button
                  className="fs-btn fs-btn--sm fs-btn--secondary"
                  data-testid={`org-accept-${m.org_id}`}
                  disabled={busy}
                  onClick={() => void run(() => apiPost(`/orgs/${m.org_id}/members/accept/${m.org_id}`, {}), 'Invitation accepted.')}
                >
                  Accept invite
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {org && (
        <div className="fs-card fs-md-card" data-testid="org-detail-panel">
          <div className="fs-task-card__top">
            <span className="fs-md-card__primary">{org.name}</span>
            <StatusPill status={org.status} />
          </div>
          <div className="fs-md-card__fields">
            <div><div className="fs-md-card__field-label">Reference</div><div className="fs-md-card__field-value">{org.ref}</div></div>
            <div><div className="fs-md-card__field-label">Category</div><div className="fs-md-card__field-value">{typeLabel(org.type)}</div></div>
            <div><div className="fs-md-card__field-label">Verification</div><div className="fs-md-card__field-value" data-testid="kyb-status"><StatusPill status={org.kyb_status} /></div></div>
          </div>
          {org.kyb_status !== 'VERIFIED' && (
            <form className="fs-md-stack" onSubmit={(e) => void submitKyb(e)} data-testid="kyb-submit-form">
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="kyb-doc-type">Document type</label>
                <select
                  id="kyb-doc-type"
                  className="fs-input"
                  data-testid="kyb-doc-type"
                  value={kybDocType}
                  onChange={(e) => setKybDocType(e.target.value)}
                >
                  {KYB_DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="kyb-doc-file">Document file (PDF or image)</label>
                <input
                  id="kyb-doc-file"
                  className="fs-input"
                  data-testid="kyb-doc-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  required
                />
              </div>
              <button type="submit" className="fs-btn fs-btn--sm" disabled={busy} data-testid="kyb-submit-btn">
                Submit for verification
              </button>
              <p className="fs-body" style={{ margin: 0 }}>
                Documents are stored privately and reviewed by an authorized verifier. Rejected submissions can be corrected and resubmitted.
              </p>
            </form>
          )}
        </div>
      )}

      {org && (
        <div className="fs-card fs-md-card" data-testid="members-panel">
          <div className="fs-md-card__field-label">Members</div>
          {members.map((m) => (
            <p key={m.membership_id} className="fs-body" style={{ margin: 0 }} data-testid={`member-${m.user_id}`}>
              {m.display_name} — {m.roles.map(typeLabel).join(', ') || 'member'} ({m.status.toLowerCase()})
            </p>
          ))}
          <form
            className="fs-md-stack"
            data-testid="invite-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => apiPost(`/orgs/${org.id}/members`, { email: inviteEmail }), 'Invitation sent.');
            }}
          >
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="invite-email">Invite by email</label>
              <input
                id="invite-email"
                className="fs-input"
                data-testid="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="fs-btn fs-btn--sm" disabled={busy} data-testid="invite-submit">Invite</button>
          </form>
        </div>
      )}

      {org && SUPPLIER_SIDE.has(org.type) && (
        <div className="fs-card fs-md-card" data-testid="bank-panel">
          <div className="fs-md-card__field-label">Bank / payout profile</div>
          {accounts.length === 0 && <p className="fs-body" style={{ margin: 0 }}>No payout account on file.</p>}
          {accounts.map((a) => (
            <p key={a.id} className="fs-body" style={{ margin: 0 }} data-testid={`bank-account-${a.id}`}>
              {a.holder_name} · {a.ifsc} · {a.account_number} {a.superseded && '(superseded)'}
            </p>
          ))}
          <div className="fs-md-stack">
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="bank-holder">Account holder</label>
              <input id="bank-holder" className="fs-input" data-testid="bank-holder" value={bankForm.holderName} onChange={(e) => setBankForm({ ...bankForm, holderName: e.target.value })} />
            </div>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="bank-ifsc">IFSC</label>
              <input id="bank-ifsc" className="fs-input" data-testid="bank-ifsc" value={bankForm.ifsc} onChange={(e) => setBankForm({ ...bankForm, ifsc: e.target.value })} />
            </div>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="bank-number">Account number</label>
              <input id="bank-number" className="fs-input" data-testid="bank-number" inputMode="numeric" value={bankForm.accountNumber} onChange={(e) => setBankForm({ ...bankForm, accountNumber: e.target.value })} />
            </div>
            <button
              className="fs-btn fs-btn--sm"
              data-testid="bank-submit-btn"
              disabled={busy || !bankForm.holderName.trim() || !bankForm.ifsc.trim() || !bankForm.accountNumber.trim()}
              onClick={() => void run(() =>
                apiPost(`/orgs/${org.id}/bank/accounts`, { ...bankForm, accountRef: bankForm.holderName || 'PRIMARY' }),
                'Bank change submitted — pending re-verification (payouts frozen until approved)')}
            >
              Submit bank change
            </button>
          </div>
          <p className="fs-body" style={{ margin: 0 }}>
            Bank changes enter re-verification and require dual platform approval before payouts resume.
          </p>
        </div>
      )}
    </div>
  );
}
