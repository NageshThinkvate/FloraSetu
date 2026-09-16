import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { KYB_REJECTION_REASONS, KybReviewDetail, kybReviewDetail, reviewKyb } from '../lib/api/admin';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';

const fmtDateTime = (v: string): string =>
  new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const kb = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const DOC_LABEL: Record<string, string> = {
  GST: 'GST certificate', PAN: 'PAN', TRADE_LICENSE: 'Trade license', BANK_PROOF: 'Bank proof', OTHER: 'Other document'
};

// ADR-014: evidence-first KYB reviewer. Decisions go through the controlled backend
// action only — status is never typed into a form. Correction = REJECTED +
// CORRECTION_REQUIRED + mandatory note (the org resubmits via the existing flow).
export function AdminKybReviewPage(): JSX.Element {
  const { orgId } = useParams<{ orgId: string }>();
  const [detail, setDetail] = useState<KybReviewDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [decision, setDecision] = useState<'VERIFIED' | 'REJECTED' | ''>('');
  const [reasonCode, setReasonCode] = useState('CORRECTION_REQUIRED');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    if (!orgId) {
      return;
    }
    setDetail(await kybReviewDetail(orgId));
  };
  useEffect(() => {
    void load().catch(() => setError("We couldn't load this review. It may not exist or you may not have access."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!orgId || !decision) {
      return;
    }
    setError(''); setNotice(''); setBusy(true);
    try {
      const fd = new FormData(e.target as HTMLFormElement);
      await reviewKyb(orgId, {
        decision,
        reasonCode: decision === 'REJECTED' ? reasonCode : undefined,
        note: String(fd.get('note') ?? '') || undefined
      });
      setNotice(decision === 'VERIFIED' ? 'Organization verified.' : 'Decision recorded. The organization can see what must be corrected and resubmit.');
      setDecision('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That decision could not be applied.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !detail) {
    return (
      <div data-testid="admin-kyb-review-denied">
        <PageHeader overline="Admin Control Plane" title="Verification review" testId="admin-kyb-review-header" />
        <InlineAlert variant="error" testId="admin-kyb-review-error">{error}</InlineAlert>
      </div>
    );
  }
  if (!detail) {
    return (
      <div data-testid="admin-kyb-review-loading">
        <PageHeader overline="Admin Control Plane" title="Verification review" testId="admin-kyb-review-header" />
        <SkeletonLoader variant="card" count={3} testId="admin-kyb-review-skeleton" />
      </div>
    );
  }

  const { org, documents, history } = detail;
  const decided = org.kyb_status !== 'IN_REVIEW';

  return (
    <div data-testid="admin-kyb-review-page">
      <PageHeader overline="Admin Control Plane — verification" title={org.name} testId="admin-kyb-review-header" />
      {error && <InlineAlert variant="error" testId="admin-kyb-review-error-inline">{error}</InlineAlert>}
      {notice && <InlineAlert variant="success" testId="admin-kyb-review-notice">{notice}</InlineAlert>}

      <div className="fs-kyb-review" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--fs-space-4)' }}>
        <div className="fs-md-stack">
          <div className="fs-card fs-md-card" data-testid="admin-kyb-review-claims">
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">Organization claims</span>
              <StatusPill status={org.kyb_status} />
            </div>
            <div className="fs-md-card__fields">
              <div><div className="fs-md-card__field-label">Reference</div><div className="fs-md-card__field-value">{org.ref}</div></div>
              <div><div className="fs-md-card__field-label">Type</div><div className="fs-md-card__field-value">{org.type.toLowerCase().replace(/_/g, ' ')}</div></div>
              <div><div className="fs-md-card__field-label">Organization status</div><div className="fs-md-card__field-value"><StatusPill status={org.status} /></div></div>
              <div><div className="fs-md-card__field-label">On platform since</div><div className="fs-md-card__field-value">{fmtDateTime(org.created_at)}</div></div>
            </div>
          </div>
          <div className="fs-card fs-md-card" data-testid="admin-kyb-review-history">
            <div className="fs-md-card__field-label">Verification history</div>
            {history.length === 0 && <p className="fs-body" style={{ margin: 0 }}>No prior activity.</p>}
            {history.map((h, i) => (
              <p key={i} className="fs-body" style={{ margin: 0 }} data-testid={`admin-kyb-history-${i}`}>
                {h.to_status === 'REJECTED' && h.reason_code === 'CORRECTION_REQUIRED'
                  ? 'Correction requested'
                  : h.to_status.toLowerCase().replace(/_/g, ' ')}
                {h.note ? ` — ${h.note}` : ''} · {fmtDateTime(h.created_at)}
              </p>
            ))}
          </div>
        </div>

        <div className="fs-card fs-md-card" data-testid="admin-kyb-review-documents">
          <div className="fs-md-card__field-label">Submitted evidence ({documents.length})</div>
          {documents.length === 0 && <p className="fs-body" style={{ margin: 0 }}>No documents submitted.</p>}
          {documents.map((d) => (
            <div key={d.id} className="fs-task-card__top" data-testid={`admin-kyb-doc-${d.id.slice(0, 8)}`}>
              <span className="fs-body" style={{ margin: 0 }}>
                {DOC_LABEL[d.docType] ?? d.docType} · {d.contentType} · {kb(d.byteSize)} · {fmtDateTime(d.uploadedAt)}
              </span>
              <a
                className="fs-btn fs-btn--ghost fs-btn--sm"
                href={d.url}
                target="_blank"
                rel="noreferrer"
                data-testid={`admin-kyb-doc-open-${d.id.slice(0, 8)}`}
              >
                View
              </a>
            </div>
          ))}
          <p className="fs-body" style={{ margin: 0 }}>
            Documents open through short-lived signed links. Access is logged in the security audit stream.
          </p>
        </div>
      </div>

      <div className="fs-card fs-md-card" data-testid="admin-kyb-review-decision" style={{ position: 'sticky', bottom: 'var(--fs-space-2)' }}>
        <div className="fs-md-card__field-label">Decision</div>
        {decided && (
          <p className="fs-body" data-testid="admin-kyb-review-decided">
            This organization is {org.kyb_status.toLowerCase()}. Further submissions arrive as a new review cycle.
          </p>
        )}
        {!decided && (
          <form onSubmit={(e) => void submit(e)} className="fs-md-stack" data-testid="admin-kyb-decision-form">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--fs-space-2)' }}>
              <button
                type="button"
                className={`fs-btn fs-btn--sm ${decision === 'VERIFIED' ? '' : 'fs-btn--ghost'}`}
                aria-pressed={decision === 'VERIFIED'}
                data-testid="admin-kyb-decide-approve"
                onClick={() => setDecision('VERIFIED')}
              >
                Approve
              </button>
              <button
                type="button"
                className={`fs-btn fs-btn--sm ${decision === 'REJECTED' && reasonCode === 'CORRECTION_REQUIRED' ? '' : 'fs-btn--ghost'}`}
                aria-pressed={decision === 'REJECTED' && reasonCode === 'CORRECTION_REQUIRED'}
                data-testid="admin-kyb-decide-correction"
                onClick={() => { setDecision('REJECTED'); setReasonCode('CORRECTION_REQUIRED'); }}
              >
                Request correction
              </button>
              <button
                type="button"
                className={`fs-btn fs-btn--sm ${decision === 'REJECTED' && reasonCode !== 'CORRECTION_REQUIRED' ? '' : 'fs-btn--ghost'}`}
                aria-pressed={decision === 'REJECTED' && reasonCode !== 'CORRECTION_REQUIRED'}
                data-testid="admin-kyb-decide-reject"
                onClick={() => { setDecision('REJECTED'); setReasonCode('DOCUMENT_ILLEGIBLE'); }}
              >
                Reject
              </button>
            </div>
            {decision === 'REJECTED' && (
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="admin-kyb-reason">Reason (required)</label>
                <select
                  id="admin-kyb-reason"
                  className="fs-input"
                  data-testid="admin-kyb-reason"
                  value={reasonCode}
                  onChange={(e) => setReasonCode(e.target.value)}
                >
                  {KYB_REJECTION_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            )}
            {decision && (
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="admin-kyb-note">
                  {decision === 'REJECTED' && reasonCode === 'CORRECTION_REQUIRED'
                    ? 'What must the organization correct? (required)'
                    : 'Note (optional)'}
                </label>
                <input id="admin-kyb-note" name="note" className="fs-input" data-testid="admin-kyb-note" />
              </div>
            )}
            <button type="submit" className="fs-btn" disabled={busy || !decision} data-testid="admin-kyb-submit-decision">
              Record decision
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
