import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { inr } from '../lib/api/demand';
import { CLAIM_NEXT, ClaimDetail, fmtDate, getClaim, transitionClaim } from '../lib/api/fulfilment';
import { useAuth } from '../lib/api/auth';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';

const categoryLabel = (v: string): string => v.toLowerCase().replace(/_/g, ' ');

// ADR-013 + Phase 6 owner ruling: claim decision actions render ONLY for the explicit
// claim-resolution permission (claim.manage — PROCUREMENT_OPS / PLATFORM_ADMIN system
// roles; the backend enforces it regardless). Support (claim.read) gets an evidence-first
// read-only case view: no adjudication, no liability calls, no financial resolution.
export function OpsClaimDetailPage(): JSX.Element {
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
    void load().catch(() => setError("We couldn't load this claim. It may not exist or you may not have access."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const transition = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id || !transitionTo) {
      return;
    }
    setError(''); setNotice(''); setBusy(true);
    try {
      const fd = new FormData(e.target as HTMLFormElement);
      await transitionClaim(id, {
        to: transitionTo,
        resolutionNote: String(fd.get('resolutionNote') ?? '') || undefined,
        adjustmentMinor: fd.get('adjustment') ? Math.round(Number(fd.get('adjustment')) * 100) : undefined
      });
      setNotice(`Claim moved to ${transitionTo.toLowerCase().replace(/_/g, ' ')}.`);
      setTransitionTo('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That decision could not be applied. Check your permissions and the claim state.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !claim) {
    return (
      <div data-testid="ops-claim-denied">
        <PageHeader overline="Operations — claims" title="Claim" testId="ops-claim-header" />
        <InlineAlert variant="error" testId="ops-claim-error">{error}</InlineAlert>
      </div>
    );
  }
  if (!claim) {
    return (
      <div data-testid="ops-claim-loading">
        <PageHeader overline="Operations — claims" title="Claim" testId="ops-claim-header" />
        <SkeletonLoader variant="card" count={3} testId="ops-claim-skeleton" />
      </div>
    );
  }

  const next = canDecide ? CLAIM_NEXT[claim.status] ?? [] : [];

  return (
    <div data-testid="ops-claim-detail-page">
      <PageHeader overline="Operations — claims" title={`Claim ${claim.ref}`} testId="ops-claim-header" />
      {error && <InlineAlert variant="error" testId="ops-claim-error-inline">{error}</InlineAlert>}
      {notice && <InlineAlert variant="success" testId="ops-claim-notice">{notice}</InlineAlert>}

      <div className="fs-card fs-md-card" data-testid="ops-claim-summary">
        <div className="fs-task-card__top">
          <span className="fs-md-card__primary">{categoryLabel(claim.category)}</span>
          <StatusPill status={claim.status} />
        </div>
        <div className="fs-md-card__fields">
          <div><div className="fs-md-card__field-label">Claim type</div><div className="fs-md-card__field-value">{categoryLabel(claim.claim_type)}</div></div>
          <div><div className="fs-md-card__field-label">Raised</div><div className="fs-md-card__field-value">{fmtDate(claim.created_at)}</div></div>
          {claim.disputed_qty && <div><div className="fs-md-card__field-label">Disputed qty</div><div className="fs-md-card__field-value">{claim.disputed_qty}</div></div>}
          <div>
            <div className="fs-md-card__field-label">Order</div>
            <div className="fs-md-card__field-value">
              <Link to={`/ops/orders?focus=${claim.order_id}`} data-testid="ops-claim-order-link">Open in order monitor</Link>
            </div>
          </div>
        </div>
        {claim.description && <p className="fs-body" data-testid="ops-claim-description">{claim.description}</p>}
      </div>

      {claim.counterparty_response && (
        <div className="fs-card fs-md-card" data-testid="ops-claim-response">
          <div className="fs-md-card__field-label">Supplier response</div>
          <p className="fs-body" style={{ margin: 0 }}>{claim.counterparty_response}</p>
        </div>
      )}
      {claim.resolution_note && (
        <div className="fs-card fs-md-card" data-testid="ops-claim-resolution">
          <div className="fs-md-card__field-label">Resolution note</div>
          <p className="fs-body" style={{ margin: 0 }}>{claim.resolution_note}</p>
        </div>
      )}

      <div className="fs-card fs-md-card" data-testid="ops-claim-evidence">
        <div className="fs-md-card__field-label">Evidence ({claim.evidences.length})</div>
        {claim.evidences.length === 0 && <p className="fs-body" style={{ margin: 0 }}>No evidence attached yet.</p>}
        {claim.evidences.map((ev) => (
          <p key={ev.id} className="fs-body" style={{ margin: 0 }} data-testid={`ops-claim-evidence-${ev.id}`}>
            {ev.note ?? 'Attachment'} · {fmtDate(ev.created_at)}
          </p>
        ))}
      </div>

      <div className="fs-card fs-md-card" data-testid="ops-claim-decisions">
        <div className="fs-md-card__field-label">Decisions ({claim.decisions.length})</div>
        {claim.decisions.length === 0 && <p className="fs-body" style={{ margin: 0 }}>No decision recorded yet.</p>}
        {claim.decisions.map((d) => (
          <p key={d.id} className="fs-body" style={{ margin: 0 }} data-testid={`ops-claim-decision-${d.id}`}>
            {d.outcome.toLowerCase().replace(/_/g, ' ')}{d.adjustment_minor ? ` · ${inr(d.adjustment_minor)}` : ''} · {fmtDate(d.created_at)}
          </p>
        ))}
      </div>

      {canDecide && next.length > 0 && (
        <div className="fs-card fs-md-card" data-testid="ops-claim-decision-panel">
          <div className="fs-md-card__field-label">Claim decision</div>
          <form onSubmit={(e) => void transition(e)} className="fs-md-stack" data-testid="ops-claim-transition-form">
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="ops-claim-transition-to">Next step</label>
              <select
                id="ops-claim-transition-to"
                className="fs-input"
                data-testid="ops-claim-transition-to"
                value={transitionTo}
                onChange={(e) => setTransitionTo(e.target.value)}
                required
              >
                <option value="">Choose next step…</option>
                {next.map((t) => <option key={t} value={t}>{t.toLowerCase().replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="ops-claim-resolution-note">Resolution note</label>
              <input id="ops-claim-resolution-note" name="resolutionNote" className="fs-input" data-testid="ops-claim-resolution-note" />
            </div>
            {transitionTo === 'FINANCIAL_ADJUSTMENT' && (
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="ops-claim-adjustment">Adjustment amount (₹)</label>
                <input
                  id="ops-claim-adjustment"
                  name="adjustment"
                  className="fs-input"
                  data-testid="ops-claim-adjustment"
                  type="number"
                  min="0.01"
                  step="any"
                  required
                />
              </div>
            )}
            <button type="submit" className="fs-btn" disabled={busy || !transitionTo} data-testid="ops-claim-transition-btn">
              Apply decision
            </button>
          </form>
        </div>
      )}
      {!canDecide && (
        <p className="fs-body" data-testid="ops-claim-readonly-note">
          Your role can view claims, evidence and timelines. Claim decisions and financial
          resolutions are made by the claims-resolution role — support never adjudicates.
        </p>
      )}
      <p className="fs-body">
        <Link to="/ops/claims" data-testid="ops-claim-back">← Back to claims</Link>
      </p>
    </div>
  );
}
