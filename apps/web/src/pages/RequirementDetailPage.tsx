import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  cancelRequirement, consentRequirement, evaluateRequirement, getRequirement,
  listMyRfqs, publishRfq, RequirementDetail, RequirementLine,
  reviseRequirement, submitRequirement
} from '../lib/api/demand';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';

const REVISABLE = ['SUBMITTED', 'SOURCING', 'QUOTING', 'CLARIFICATION', 'EVALUATION'];
const TERMINAL = ['CANCELLED', 'CLOSED', 'CONVERTED'];
const fmtDateTime = (v: string): string =>
  new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Buyer requirement workspace (Phase 8: design-system rebuild). The raw supplier-UUID
// field is removed — publishing uses managed sourcing (ops matches suppliers); a directed
// supplier picker is documented as post-pilot. Deadline input is future-constrained and
// converted to authoritative UTC on submit.
export function RequirementDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const [req, setReq] = useState<RequirementDetail | null>(null);
  const [rfqId, setRfqId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviseQty, setReviseQty] = useState<Record<string, string>>({});
  const [changeReason, setChangeReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [quoteDeadline, setQuoteDeadline] = useState('');

  const load = useCallback(async (): Promise<void> => {
    const detail = await getRequirement(id);
    setReq(detail);
    const rfqs = await listMyRfqs().catch(() => ({ items: [] }));
    const mine = rfqs.items.find((r) => r.requirement_ref === detail.ref && !['CANCELLED'].includes(r.status));
    setRfqId(mine?.id ?? null);
  }, [id]);

  useEffect(() => {
    void load().catch(() => setError('Requirement not found'));
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setBusy(true); setError(''); setNotice('');
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

  if (error && !req) {
    return (
      <div data-testid="requirement-denied">
        <PageHeader overline="Your requests" title="Request" testId="requirement-header" />
        <InlineAlert variant="error" testId="requirement-error">{error}</InlineAlert>
      </div>
    );
  }
  if (!req) {
    return (
      <div data-testid="requirement-loading">
        <PageHeader overline="Your requests" title="Request" testId="requirement-header" />
        <SkeletonLoader variant="card" count={3} testId="requirement-skeleton" />
      </div>
    );
  }

  const publishable = ['SUBMITTED', 'SOURCING'].includes(req.status) && req.mode !== 'QUICK' && !rfqId;
  const evaluatable = ['QUOTING', 'CLARIFICATION'].includes(req.status);
  const minDeadline = new Date(Date.now() + 3600e3).toISOString().slice(0, 16);

  const doRevise = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    await run(async () => {
      await reviseRequirement(req.id, {
        changeReason,
        lines: req.lines.map((l: RequirementLine) => ({
          bomLineId: l.bom_line_id ?? undefined,
          commodityId: l.commodity_id,
          varietyId: l.variety_id ?? undefined,
          gradeProfileId: l.grade_profile_id ?? undefined,
          packDefinitionId: l.pack_definition_id ?? undefined,
          quantity: Number(reviseQty[l.id] ?? l.quantity),
          uomId: l.uom_id,
          neededAt: l.needed_at,
          deliveryDestination: l.delivery_destination,
          substitutionPolicy: l.substitution_policy,
          notes: l.notes ?? undefined
        }))
      });
    }, 'Revision recorded — open quotes now require supplier reconfirmation.');
  };

  return (
    <div data-testid="requirement-detail">
      <PageHeader overline="Your requests" title={req.title} testId="requirement-header" />
      <div className="fs-task-card__top" style={{ marginBottom: 'var(--fs-space-3)' }}>
        <span className="fs-body">{req.ref} · {req.mode.toLowerCase()} request · v{req.current_version_no}{req.event_name ? ` · event ${req.event_name}` : ''}</span>
        <StatusPill status={req.status} />
      </div>
      {rfqId && (
        <p className="fs-body">
          <Link to={`/buyer/offers/${rfqId}`} data-testid="open-linked-rfq">Open the linked RFQ →</Link>
        </p>
      )}
      {error && <InlineAlert variant="error" testId="requirement-error-inline">{error}</InlineAlert>}
      {notice && <InlineAlert variant="success" testId="requirement-notice">{notice}</InlineAlert>}

      <div className="fs-card fs-md-card" data-testid="requirement-lines">
        <div className="fs-md-card__field-label">Lines</div>
        {req.lines.map((l) => (
          <div key={l.id} className="fs-task-card__top" data-testid={`req-line-${l.id}`}>
            <span className="fs-body" style={{ margin: 0 }}>
              {l.master_snapshot.commodity?.name ?? 'Product'}{l.master_snapshot.variety ? ` · ${l.master_snapshot.variety.name}` : ''}
            </span>
            <span className="fs-body" style={{ margin: 0 }}>
              {l.quantity} {l.master_snapshot.uom?.code ?? ''} · by {new Date(l.needed_at).toLocaleDateString('en-IN')} · {l.delivery_destination}
              {Number(req.awardedByLine[l.id] ?? 0) > 0 ? ` · awarded ${req.awardedByLine[l.id]}` : ''}
            </span>
          </div>
        ))}
      </div>

      <div className="fs-card fs-md-card" data-testid="requirement-actions">
        <div className="fs-md-card__field-label">Actions</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--fs-space-2)' }}>
          {req.status === 'DRAFT' && (
            <button
              className="fs-btn"
              disabled={busy}
              data-testid="requirement-submit-btn"
              onClick={() => void run(() => submitRequirement(req.id, crypto.randomUUID()), 'Submitted for sourcing.')}
            >
              Submit for sourcing
            </button>
          )}
          {evaluatable && (
            <button
              className="fs-btn"
              disabled={busy}
              data-testid="requirement-evaluate-btn"
              onClick={() => void run(() => evaluateRequirement(req.id), 'Evaluation started.')}
            >
              Begin evaluation
            </button>
          )}
        </div>
        {!TERMINAL.includes(req.status) && (
          <div className="fs-field" style={{ marginTop: 'var(--fs-space-3)' }}>
            <label className="fs-field__label" htmlFor="requirement-cancel-reason">Cancel reason</label>
            <div style={{ display: 'flex', gap: 'var(--fs-space-2)' }}>
              <input
                id="requirement-cancel-reason"
                className="fs-input"
                data-testid="requirement-cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
              <button
                className="fs-btn fs-btn--sm fs-btn--danger"
                disabled={busy || !cancelReason.trim()}
                data-testid="requirement-cancel-btn"
                onClick={() => void run(() => cancelRequirement(req.id, cancelReason), 'Requirement cancelled.')}
              >
                Cancel request
              </button>
            </div>
          </div>
        )}
        {publishable && (
          <form
            className="fs-md-stack"
            style={{ marginTop: 'var(--fs-space-3)' }}
            data-testid="publish-rfq-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => publishRfq(req.id, {
                quoteDeadline: quoteDeadline ? new Date(quoteDeadline).toISOString() : undefined
              }, crypto.randomUUID()), 'RFQ published to matched suppliers.');
            }}
          >
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="publish-deadline">Quote deadline (your local time)</label>
              <input
                id="publish-deadline"
                className="fs-input"
                data-testid="publish-deadline"
                type="datetime-local"
                min={minDeadline}
                value={quoteDeadline}
                onChange={(e) => setQuoteDeadline(e.target.value)}
              />
            </div>
            <button type="submit" className="fs-btn fs-btn--sm" disabled={busy} data-testid="publish-rfq-btn">
              Publish RFQ
            </button>
            <p className="fs-body" style={{ margin: 0 }}>
              FloraSetu sourcing matches verified suppliers for you. The deadline is stored in UTC and shown to suppliers in their local time.
            </p>
          </form>
        )}
        {req.mode === 'QUICK' && req.status !== 'DRAFT' && !rfqId && (
          <p className="fs-body" style={{ margin: 0 }}>Quick requests are published automatically by the sourcing desk.</p>
        )}
      </div>

      {REVISABLE.includes(req.status) && (
        <form className="fs-card fs-md-card" data-testid="requirement-revise-form" onSubmit={(e) => void doRevise(e)}>
          <div className="fs-md-card__field-label">Revise quantities</div>
          {req.lines.map((l) => (
            <div className="fs-field" key={l.id}>
              <label className="fs-field__label" htmlFor={`revise-qty-${l.id}`}>
                {l.master_snapshot.commodity?.name ?? 'Line'} (current {l.quantity} {l.master_snapshot.uom?.code})
              </label>
              <input
                id={`revise-qty-${l.id}`}
                className="fs-input"
                data-testid={`revise-qty-${l.id}`}
                type="number"
                min="1"
                step="any"
                value={reviseQty[l.id] ?? l.quantity}
                onChange={(e) => setReviseQty({ ...reviseQty, [l.id]: e.target.value })}
              />
            </div>
          ))}
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="revise-reason">Change reason</label>
            <input
              id="revise-reason"
              className="fs-input"
              data-testid="revise-reason"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
            />
          </div>
          <button type="submit" className="fs-btn fs-btn--sm" disabled={busy || !changeReason.trim()} data-testid="revise-submit-btn">
            Record revision
          </button>
        </form>
      )}

      <div className="fs-card fs-md-card" data-testid="requirement-versions">
        <div className="fs-md-card__field-label">Version history</div>
        {req.versions.map((v) => (
          <div key={v.id} className="fs-task-card__top" data-testid={`version-${v.version_no}`}>
            <span className="fs-body" style={{ margin: 0 }}>
              v{v.version_no} · {v.change_reason ?? 'initial'} · {fmtDateTime(v.created_at)}
            </span>
            {v.consent_required && !v.consented_at && (
              <button
                className="fs-btn fs-btn--sm fs-btn--secondary"
                data-testid={`consent-v${v.version_no}`}
                disabled={busy}
                onClick={() => void run(() => consentRequirement(req.id, v.version_no), 'Consent recorded.')}
              >
                Consent to change
              </button>
            )}
            {v.consented_at && <StatusPill status="consented" label="Consented" />}
          </div>
        ))}
      </div>
    </div>
  );
}
