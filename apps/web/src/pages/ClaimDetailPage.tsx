import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { inr } from '../lib/api/demand';
import {
  addClaimEvidence, CLAIM_NEXT, ClaimDetail, fmtDate, getClaim,
  respondClaim, submitClaim, transitionClaim, uploadMedia
} from '../lib/api/fulfilment';
import { useAuth } from '../lib/api/auth';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';

const categoryLabel = (v: string): string => v.toLowerCase().replace(/_/g, ' ');

// Buyer issue workspace (Phase 8: design-system rebuild — functionality unchanged).
// Decision actions render only for claim.manage holders; buyers submit drafts + evidence.
export function ClaimDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { me, activeOrgId } = useAuth();
  const roles = me?.memberships.find((m) => m.org_id === activeOrgId)?.roles ?? [];
  const canDecide = roles.includes('PROCUREMENT_OPS') || roles.includes('PLATFORM_ADMIN');

  const [claim, setClaim] = useState<ClaimDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [transitionTo, setTransitionTo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    if (!id) {
      return;
    }
    setClaim(await getClaim(id));
  };
  useEffect(() => {
    void load().catch(() => setError("We couldn't load this issue. It may not exist or you may not have access."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError(''); setNotice(''); setBusy(true);
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That action could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  const uploadEvidence = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) {
      return;
    }
    const input = (e.target as HTMLFormElement).querySelector<HTMLInputElement>('input[type=file]');
    const file = input?.files?.[0];
    if (!file) {
      setError('Choose a photo or PDF first.');
      return;
    }
    await run(async () => {
      const media = await uploadMedia(file, 'claim');
      const fd = new FormData(e.target as HTMLFormElement);
      await addClaimEvidence(id, {
        mediaObjectId: media.id,
        note: String(fd.get('note') ?? '') || undefined
      });
    }, 'Evidence added.');
  };

  if (error && !claim) {
    return (
      <div data-testid="claim-denied">
        <PageHeader overline="Your purchases" title="Issue" testId="claim-header" />
        <InlineAlert variant="error" testId="claim-error">{error}</InlineAlert>
      </div>
    );
  }
  if (!claim) {
    return (
      <div data-testid="claim-loading">
        <PageHeader overline="Your purchases" title="Issue" testId="claim-header" />
        <SkeletonLoader variant="card" count={3} testId="claim-skeleton" />
      </div>
    );
  }

  const next = canDecide ? CLAIM_NEXT[claim.status] ?? [] : [];

  return (
    <div data-testid="claim-page">
      <PageHeader overline="Your purchases" title={`Issue ${claim.ref}`} testId="claim-header" />
      {error && <InlineAlert variant="error" testId="claim-error-inline">{error}</InlineAlert>}
      {notice && <InlineAlert variant="success" testId="claim-notice">{notice}</InlineAlert>}

      <div className="fs-card fs-md-card" data-testid="claim-summary">
        <div className="fs-task-card__top">
          <span className="fs-md-card__primary">{categoryLabel(claim.category)}</span>
          <StatusPill status={claim.status} />
        </div>
        <div className="fs-md-card__fields">
          <div><div className="fs-md-card__field-label">Issue type</div><div className="fs-md-card__field-value">{categoryLabel(claim.claim_type)}</div></div>
          <div><div className="fs-md-card__field-label">Raised</div><div className="fs-md-card__field-value">{fmtDate(claim.created_at)}</div></div>
          {claim.disputed_qty && <div><div className="fs-md-card__field-label">Disputed qty</div><div className="fs-md-card__field-value">{claim.disputed_qty}</div></div>}
        </div>
        {claim.description && <p className="fs-body" data-testid="claim-description">{claim.description}</p>}
        {claim.status === 'DRAFT' && (
          <button
            className="fs-btn"
            disabled={busy}
            data-testid="claim-submit-btn"
            onClick={() => void run(() => submitClaim(claim.id), 'Issue submitted. FloraSetu support will review it.')}
          >
            Submit issue
          </button>
        )}
      </div>

      {claim.counterparty_response && (
        <div className="fs-card fs-md-card" data-testid="claim-response">
          <div className="fs-md-card__field-label">Supplier response</div>
          <p className="fs-body" style={{ margin: 0 }}>{claim.counterparty_response}</p>
        </div>
      )}
      {claim.resolution_note && (
        <div className="fs-card fs-md-card" data-testid="claim-resolution">
          <div className="fs-md-card__field-label">Resolution</div>
          <p className="fs-body" style={{ margin: 0 }}>{claim.resolution_note}</p>
        </div>
      )}

      <div className="fs-card fs-md-card" data-testid="claim-evidence-panel">
        <div className="fs-md-card__field-label">Evidence ({claim.evidences.length})</div>
        {claim.evidences.length === 0 && <p className="fs-body" style={{ margin: 0 }}>No evidence attached yet.</p>}
        {claim.evidences.map((ev) => (
          <p key={ev.id} className="fs-body" style={{ margin: 0 }} data-testid={`claim-evidence-${ev.id}`}>
            {ev.note ?? 'Attachment'} · {fmtDate(ev.created_at)}
          </p>
        ))}
        {!['CLOSED', 'REJECTED'].includes(claim.status) && (
          <form onSubmit={(e) => void uploadEvidence(e)} className="fs-md-stack" data-testid="claim-evidence-form">
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="claim-evidence-file">Photo or PDF</label>
              <input
                id="claim-evidence-file"
                className="fs-input"
                     data-testid="claim-evidence-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                required
              />
            </div>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="claim-evidence-note">Note (optional)</label>
              <input id="claim-evidence-note" name="note" className="fs-input" data-testid="claim-evidence-note" />
            </div>
            <button type="submit" className="fs-btn fs-btn--sm" disabled={busy} data-testid="claim-evidence-btn">
              Add evidence
            </button>
          </form>
        )}
      </div>

      {claim.status === 'COUNTERPARTY_RESPONSE' && (
        <div className="fs-card fs-md-card" data-testid="claim-respond-panel">
          <div className="fs-md-card__field-label">Respond to the issue</div>
          <form
            className="fs-md-stack"
            data-testid="claim-respond-form"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.target as HTMLFormElement);
              void run(() => respondClaim(claim.id, String(fd.get('note') ?? '')), 'Response sent.');
            }}
          >
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="claim-respond-note">Your response</label>
              <input id="claim-respond-note" name="note" className="fs-input" data-testid="claim-respond-note" required />
            </div>
            <button type="submit" className="fs-btn fs-btn--sm" disabled={busy} data-testid="claim-respond-btn">
              Send response
            </button>
          </form>
        </div>
      )}

      <div className="fs-card fs-md-card" data-testid="claim-decisions">
        <div className="fs-md-card__field-label">Decisions ({claim.decisions.length})</div>
        {claim.decisions.length === 0 && <p className="fs-body" style={{ margin: 0 }}>No decision recorded yet.</p>}
        {claim.decisions.map((d) => (
          <p key={d.id} className="fs-body" style={{ margin: 0 }} data-testid={`claim-decision-${d.id}`}>
            {d.outcome.toLowerCase().replace(/_/g, ' ')}{d.adjustment_minor ? ` · ${inr(d.adjustment_minor)}` : ''} · {fmtDate(d.created_at)}
          </p>
        ))}
      </div>

      {canDecide && next.length > 0 && (
        <div className="fs-card fs-md-card" data-testid="claim-transition-panel">
          <div className="fs-md-card__field-label">Claim decision (operations)</div>
          <form
            className="fs-md-stack"
            data-testid="claim-transition-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!transitionTo) {
                return;
              }
              const fd = new FormData(e.target as HTMLFormElement);
              void run(() => transitionClaim(claim.id, {
                to: transitionTo,
                resolutionNote: String(fd.get('resolutionNote') ?? '') || undefined,
                adjustmentMinor: fd.get('adjustment') ? Math.round(Number(fd.get('adjustment')) * 100) : undefined
              }), `Claim moved to ${transitionTo.toLowerCase().replace(/_/g, ' ')}.`);
            }}
          >
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="claim-transition-to">Next step</label>
              <select
                id="claim-transition-to"
                className="fs-input"
                data-testid="claim-transition-to"
                value={transitionTo}
                onChange={(e) => setTransitionTo(e.target.value)}
                required
              >
                <option value="">Choose next step…</option>
                {next.map((t) => <option key={t} value={t}>{t.toLowerCase().replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="claim-resolution-note">Resolution note</label>
              <input id="claim-resolution-note" name="resolutionNote" className="fs-input" data-testid="claim-resolution-note" />
            </div>
            {transitionTo === 'FINANCIAL_ADJUSTMENT' && (
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="claim-adjustment">Adjustment amount (₹)</label>
                <input
                  id="claim-adjustment"
                  name="adjustment"
                  className="fs-input"
                  data-testid="claim-adjustment"
                  type="number"
                  min="0.01"
                  step="any"
                  required
                />
              </div>
            )}
            <button type="submit" className="fs-btn" disabled={busy || !transitionTo} data-testid="claim-transition-btn">
              Apply decision
            </button>
          </form>
        </div>
      )}
      <p className="fs-body">
        <Link to="/buyer/issues" data-testid="claim-back">← Back to issues</Link>
      </p>
    </div>
  );
}
