import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  cancelRequirement, consentRequirement, evaluateRequirement, getRequirement,
  listMyRfqs, publishRfq, RequirementDetail, RequirementLine,
  reviseRequirement, submitRequirement
} from '../lib/api/demand';

const REVISABLE = ['SUBMITTED', 'SOURCING', 'QUOTING', 'CLARIFICATION', 'EVALUATION'];
const TERMINAL = ['CANCELLED', 'CLOSED', 'CONVERTED'];

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
  const [supplierIds, setSupplierIds] = useState('');
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

  if (!req) {
    return <main className="app-shell" data-testid="requirement-loading"><p className="hint">Loading…</p></main>;
  }

  const publishable = ['SUBMITTED', 'SOURCING'].includes(req.status) && req.mode !== 'QUICK' && !rfqId;
  const evaluatable = ['QUOTING', 'CLARIFICATION'].includes(req.status);

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
    <main className="app-shell" data-testid="requirement-detail">
      <header className="shell-header">
        <h1>{req.title}</h1>
        <span className="state-chip frozen" data-testid="requirement-status">{req.status}</span>
      </header>
      <p className="hint">{req.ref} · {req.mode} · v{req.current_version_no}{req.event_name ? ` · event ${req.event_name}` : ''}</p>
      {rfqId && (
        <p><Link to={`/demand/rfqs/${rfqId}`} data-testid="open-linked-rfq"><button className="ghost-btn">Open linked RFQ</button></Link></p>
      )}
      {error && <p className="form-error" data-testid="requirement-error">{error}</p>}
      {notice && <p className="form-ok" data-testid="requirement-notice">{notice}</p>}

      <section className="panel" data-testid="requirement-lines">
        <h2>Lines</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Product</th><th>Qty</th><th>Unit</th><th>Needed by</th><th>Destination</th><th>Awarded</th></tr>
            </thead>
            <tbody>
              {req.lines.map((l) => (
                <tr key={l.id} data-testid={`req-line-${l.id}`}>
                  <td>{l.master_snapshot.commodity?.name ?? l.commodity_id}{l.master_snapshot.variety ? ` · ${l.master_snapshot.variety.name}` : ''}</td>
                  <td>{l.quantity}</td>
                  <td>{l.master_snapshot.uom?.code ?? ''}</td>
                  <td>{new Date(l.needed_at).toLocaleDateString()}</td>
                  <td>{l.delivery_destination}</td>
                  <td>{req.awardedByLine[l.id] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" data-testid="requirement-actions">
        <h2>Actions</h2>
        <div className="inline-form">
          {req.status === 'DRAFT' && (
            <button disabled={busy} data-testid="requirement-submit-btn"
              onClick={() => void run(() => submitRequirement(req.id, crypto.randomUUID()), 'Submitted for sourcing.')}>
              Submit
            </button>
          )}
          {evaluatable && (
            <button disabled={busy} data-testid="requirement-evaluate-btn"
              onClick={() => void run(() => evaluateRequirement(req.id), 'Evaluation started.')}>
              Begin evaluation
            </button>
          )}
          {!TERMINAL.includes(req.status) && (
            <>
              <input data-testid="requirement-cancel-reason" placeholder="Cancel reason" value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)} />
              <button className="ghost-btn" disabled={busy || !cancelReason.trim()} data-testid="requirement-cancel-btn"
                onClick={() => void run(() => cancelRequirement(req.id, cancelReason), 'Requirement cancelled.')}>
                Cancel
              </button>
            </>
          )}
        </div>
        {publishable && (
          <form className="inline-form" data-testid="publish-rfq-form" onSubmit={(e) => {
            e.preventDefault();
            void run(() => publishRfq(req.id, {
              supplierOrgIds: supplierIds.trim() ? supplierIds.split(',').map((s) => s.trim()) : undefined,
              quoteDeadline: quoteDeadline ? new Date(quoteDeadline).toISOString() : undefined
            }, crypto.randomUUID()), 'RFQ published.');
          }}>
            <input data-testid="publish-supplier-ids" placeholder="Supplier org IDs (comma separated, blank = managed match)"
              value={supplierIds} onChange={(e) => setSupplierIds(e.target.value)} />
            <input data-testid="publish-deadline" type="datetime-local" value={quoteDeadline}
              onChange={(e) => setQuoteDeadline(e.target.value)} />
            <button type="submit" disabled={busy} data-testid="publish-rfq-btn">Publish RFQ</button>
          </form>
        )}
        {req.mode === 'QUICK' && req.status !== 'DRAFT' && !rfqId && (
          <p className="hint">Quick requests are published automatically by the sourcing desk.</p>
        )}
      </section>

      {REVISABLE.includes(req.status) && (
        <form className="panel" data-testid="requirement-revise-form" onSubmit={doRevise}>
          <h2>Revise quantities</h2>
          {req.lines.map((l) => (
            <label key={l.id}>
              {l.master_snapshot.commodity?.name ?? 'Line'} (current {l.quantity} {l.master_snapshot.uom?.code})
              <input data-testid={`revise-qty-${l.id}`} type="number" min="1" step="any"
                value={reviseQty[l.id] ?? l.quantity}
                onChange={(e) => setReviseQty({ ...reviseQty, [l.id]: e.target.value })} />
            </label>
          ))}
          <label>
            Change reason
            <input data-testid="revise-reason" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />
          </label>
          <button type="submit" disabled={busy || !changeReason.trim()} data-testid="revise-submit-btn">Record revision</button>
        </form>
      )}

      <section className="panel" data-testid="requirement-versions">
        <h2>Version history</h2>
        <ul className="plain-list">
          {req.versions.map((v) => (
            <li key={v.id} data-testid={`version-${v.version_no}`}>
              <span>v{v.version_no}</span>
              <span className="hint">{v.change_reason ?? 'initial'} · {new Date(v.created_at).toLocaleString()}</span>
              {v.consent_required && !v.consented_at && (
                <button className="ghost-btn" data-testid={`consent-v${v.version_no}`}
                  onClick={() => void run(() => consentRequirement(req.id, v.version_no), 'Consent recorded.')}>
                  Consent to ops change
                </button>
              )}
              {v.consented_at && <span className="state-chip frozen">consented</span>}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
