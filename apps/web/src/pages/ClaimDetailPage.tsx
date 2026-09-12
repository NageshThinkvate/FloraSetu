import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { inr } from '../lib/api/demand';
import {
  addClaimEvidence, CLAIM_NEXT, ClaimDetail, fmtDate, getClaim, respondClaim,
  submitClaim, transitionClaim, uploadMedia
} from '../lib/api/fulfilment';

// Claim workspace: buyer drafts/submits with evidence, supplier responds, ops drives
// the lifecycle. Approved financial adjustments land as immutable adjustment records.
export function ClaimDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [claim, setClaim] = useState<ClaimDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [transitionTo, setTransitionTo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    if (!id) return;
    setClaim(await getClaim(id));
  };
  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Claim unavailable'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError(''); setNotice(''); setBusy(true);
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  const respond = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) return;
    const response = String(new FormData(e.target as HTMLFormElement).get('response') ?? '');
    await act(() => respondClaim(id, response), 'Response recorded.');
  };

  const evidence = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    await act(async () => {
      const stored = await uploadMedia(file);
      await addClaimEvidence(id, { mediaObjectId: stored.id, note: file.name });
    }, 'Evidence attached.');
    e.target.value = '';
  };

  const transition = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id || !transitionTo) return;
    const fd = new FormData(e.target as HTMLFormElement);
    await act(
      () => transitionClaim(id, {
        to: transitionTo,
        resolutionNote: String(fd.get('resolutionNote') ?? '') || undefined,
        adjustmentMinor: fd.get('adjustment') ? Math.round(Number(fd.get('adjustment')) * 100) : undefined
      }),
      `Claim → ${transitionTo}.`
    );
    setTransitionTo('');
  };

  if (error && !claim) {
    return (
      <main className="app-shell" data-testid="claim-denied">
        <header className="shell-header"><h1>Claim</h1></header>
        <p className="form-error" data-testid="claim-error">{error}</p>
      </main>
    );
  }
  if (!claim) {
    return <main className="app-shell" data-testid="claim-loading"><p className="hint">Loading…</p></main>;
  }

  const next = CLAIM_NEXT[claim.status] ?? [];

  return (
    <main className="app-shell" data-testid="claim-detail-page">
      <header className="shell-header">
        <h1>Claim <code data-testid="claim-ref">{claim.ref}</code></h1>
        <span className="state-chip" data-testid="claim-status">{claim.status}</span>
      </header>
      <p className="hint">
        {claim.category} · order <Link to={`/orders/${claim.order_id}`} data-testid="claim-order-link">open</Link>
        {claim.disputed_qty ? ` · disputed qty ${claim.disputed_qty}` : ''} · {fmtDate(claim.created_at)}
      </p>
      {error && <p className="form-error" data-testid="claim-error-inline">{error}</p>}
      {notice && <p className="form-ok" data-testid="claim-notice">{notice}</p>}

      {claim.counterparty_response && (
        <section className="panel" data-testid="claim-response-panel">
          <h2>Counterparty response</h2>
          <p>{claim.counterparty_response}</p>
        </section>
      )}
      {claim.resolution_note && (
        <section className="panel" data-testid="claim-resolution-panel">
          <h2>Resolution note</h2>
          <p>{claim.resolution_note}</p>
        </section>
      )}

      <section className="panel" data-testid="claim-evidence-panel">
        <h2>Evidence ({claim.evidences.length})</h2>
        <ul className="plain-list">
          {claim.evidences.map((ev) => (
            <li key={ev.id} data-testid={`claim-evidence-${ev.id}`}>
              <span className="hint">{ev.note ?? ev.media_object_id.slice(0, 8)}</span>
              <span className="hint">{fmtDate(ev.created_at)}</span>
            </li>
          ))}
        </ul>
        {!['CLOSED', 'REJECTED'].includes(claim.status) && (
          <div className="inline-form">
            <input type="file" accept="image/*" data-testid="claim-evidence-input" disabled={busy}
              onChange={(e) => void evidence(e)} />
          </div>
        )}
      </section>

      <section className="panel" data-testid="claim-decisions-panel">
        <h2>Decisions ({claim.decisions.length})</h2>
        <ul className="plain-list">
          {claim.decisions.map((d) => (
            <li key={d.id} data-testid={`claim-decision-${d.id}`}>
              <span className="state-chip">{d.outcome}</span>
              {d.adjustment_minor && <span>{inr(d.adjustment_minor)}</span>}
              <span className="hint">{fmtDate(d.created_at)}</span>
            </li>
          ))}
        </ul>
      </section>

      {claim.status === 'DRAFT' && (
        <button disabled={busy} data-testid="claim-submit-btn"
          onClick={() => void act(() => submitClaim(claim.id), 'Claim submitted.')}>Submit claim</button>
      )}

      {['SUBMITTED', 'EVIDENCE_VALIDATION'].includes(claim.status) && (
        <section className="panel" data-testid="claim-respond-panel">
          <h2>Supplier response</h2>
          <form onSubmit={respond} className="inline-form" data-testid="claim-respond-form">
            <input name="response" data-testid="claim-response-input" placeholder="Response to buyer" required />
            <button type="submit" disabled={busy} data-testid="claim-respond-btn">Respond</button>
          </form>
        </section>
      )}

      {next.length > 0 && (
        <section className="panel" data-testid="claim-transition-panel">
          <h2>Operations transition</h2>
          <form onSubmit={transition} className="inline-form" data-testid="claim-transition-form">
            <select data-testid="claim-transition-to" value={transitionTo}
              onChange={(e) => setTransitionTo(e.target.value)} required>
              <option value="">Next status…</option>
              {next.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input name="resolutionNote" data-testid="claim-resolution-note" placeholder="Resolution note" />
            {transitionTo === 'FINANCIAL_ADJUSTMENT' && (
              <input name="adjustment" data-testid="claim-adjustment" type="number" min="0.01" step="any" placeholder="Adjustment ₹" required />
            )}
            <button type="submit" disabled={busy || !transitionTo} data-testid="claim-transition-btn">Apply</button>
          </form>
        </section>
      )}

      <p><Link to="/claims" data-testid="claim-back">← Back to claims</Link></p>
    </main>
  );
}
