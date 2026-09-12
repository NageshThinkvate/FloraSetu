import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  cancelRfq, compareQuotes, Comparison, createAward, getRfq, inr,
  listAwards, listClarifications, Award, Clarification, respondClarification, RfqDetail
} from '../lib/api/demand';

// Buyer RFQ workspace: invitations, quote comparison (original quoted values shown
// alongside normalized metadata — OD-08), evaluation and guarded award.
export function RfqDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const [rfq, setRfq] = useState<RfqDetail | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [awards, setAwards] = useState<Award[]>([]);
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [answer, setAnswer] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const detail = await getRfq(id);
    setRfq(detail);
    setComparison(await compareQuotes(id).catch(() => null));
    setAwards((await listAwards(id).catch(() => ({ items: [] }))).items);
    setClarifications((await listClarifications(id).catch(() => ({ items: [] }))).items);
  }, [id]);

  useEffect(() => {
    void load().catch(() => setError('RFQ not found'));
  }, [load]);

  const hasDeviations = useMemo(
    () => (comparison?.offers ?? []).some((o) => o.lines.some((l) => l.deviation_note || l.proposes_substitution)),
    [comparison]
  );

  const award = async (): Promise<void> => {
    setBusy(true); setError(''); setNotice('');
    try {
      const lines = Object.entries(pick)
        .filter(([, versionId]) => versionId)
        .map(([requirementLineId, versionId]) => ({
          requirementLineId,
          quotationVersionId: versionId,
          awardedQty: Number(qty[requirementLineId] ?? 0),
          uomId: comparison?.requirementLines.find((l) => l.id === requirementLineId)?.uom_id
        }));
      if (lines.length === 0 || lines.some((l) => !l.awardedQty || l.awardedQty <= 0)) {
        setError('Pick an offer and a positive quantity for at least one line.');
        return;
      }
      const res = await createAward(id, { lines, consentAcceptedDeviations: consent || undefined }, crypto.randomUUID());
      setNotice(`Award ${res.ref} created — ${res.fullyAwarded ? 'fully' : 'partially'} awarded.`);
      setPick({}); setQty({}); setConsent(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Award failed');
    } finally {
      setBusy(false);
    }
  };

  if (!rfq) {
    return <main className="app-shell" data-testid="rfq-loading"><p className="hint">Loading…</p></main>;
  }

  const open = ['PUBLISHED', 'PARTIALLY_AWARDED'].includes(rfq.status);

  return (
    <main className="app-shell" data-testid="rfq-detail">
      <header className="shell-header">
        <h1>{rfq.title}</h1>
        <span className="state-chip frozen" data-testid="rfq-status">{rfq.status}</span>
      </header>
      <p className="hint">{rfq.ref} · requirement {rfq.requirement_ref} · {rfq.mode}
        {rfq.quote_deadline ? ` · quotes by ${new Date(rfq.quote_deadline).toLocaleString()}` : ''}</p>
      {error && <p className="form-error" data-testid="rfq-error">{error}</p>}
      {notice && <p className="form-ok" data-testid="rfq-notice">{notice}</p>}

      {rfq.invitations && (
        <section className="panel" data-testid="rfq-invitations">
          <h2>Invitations ({rfq.invitations.length})</h2>
          <ul className="plain-list">
            {rfq.invitations.map((i) => (
              <li key={i.supplier_org_id} data-testid={`invitation-${i.supplier_org_id}`}>
                <code>{i.supplier_org_id.slice(0, 8)}…</code>
                <span className="state-chip">{i.status}</span>
                {i.decline_reason && <span className="hint">{i.decline_reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {comparison && comparison.offers.length > 0 && (
        <section className="panel" data-testid="quote-comparison">
          <h2>Quote comparison</h2>
          <p className="hint">Original quoted values are shown as submitted; normalized values are indicative only.</p>
          {comparison.requirementLines.map((rl) => (
            <div key={rl.id} style={{ marginBottom: 20 }} data-testid={`compare-line-${rl.id}`}>
              <h3 className="sub-h">
                {rl.master_snapshot.commodity?.name ?? 'Line'} — need {rl.quantity}
              </h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>Offer</th><th>Quoted</th><th>Normalized</th><th>Unit price</th><th>Flags</th><th>Award qty</th></tr>
                  </thead>
                  <tbody>
                    {comparison.offers.map((o) => {
                      const line = o.lines.find((l) => l.requirement_line_id === rl.id);
                      if (!line) {
                        return null;
                      }
                      return (
                        <tr key={o.version_id} data-testid={`offer-${o.version_id}-${rl.id}`}>
                          <td><code>{o.ref}</code> v{o.version_no} <span className="state-chip">{o.version_status}</span></td>
                          <td>{line.quoted_qty} (original)</td>
                          <td>{line.normalized_qty ? `${line.normalized_qty} (${line.normalization_status})` : '—'}</td>
                          <td>{inr(line.unit_price_minor)} / unit</td>
                          <td>
                            {line.deviation_note && <span className="state-chip frozen">deviation</span>}
                            {line.proposes_substitution && <span className="state-chip frozen">substitution</span>}
                          </td>
                          <td className="inline-form">
                            <input type="radio" name={`pick-${rl.id}`} data-testid={`pick-${rl.id}-${o.version_id}`}
                              checked={pick[rl.id] === o.version_id}
                              onChange={() => setPick({ ...pick, [rl.id]: o.version_id })} />
                            {pick[rl.id] === o.version_id && (
                              <input data-testid={`award-qty-${rl.id}`} type="number" min="0" step="any"
                                placeholder={`max ${rl.quantity}`} value={qty[rl.id] ?? ''}
                                onChange={(e) => setQty({ ...qty, [rl.id]: e.target.value })} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {open && (
            <div data-testid="award-panel">
              {hasDeviations && (
                <label style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" data-testid="award-consent" checked={consent}
                    onChange={(e) => setConsent(e.target.checked)} />
                  I accept the flagged deviations / substitution proposals
                </label>
              )}
              <button disabled={busy} data-testid="award-submit-btn" onClick={() => void award()}>
                {busy ? 'Creating…' : 'Create award'}
              </button>
            </div>
          )}
        </section>
      )}

      {awards.length > 0 && (
        <section className="panel" data-testid="award-list">
          <h2>Awards</h2>
          <ul className="plain-list">
            {awards.map((a) => (
              <li key={a.id} data-testid={`award-${a.id}`}>
                <code>{a.ref}</code>
                <span className="state-chip">{a.status}</span>
                {(a.lines ?? []).map((l, i) => (
                  <span key={i} className="hint">{l.awarded_qty} @ {inr(l.unit_price_minor)}</span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {clarifications.length > 0 && (
        <section className="panel" data-testid="rfq-clarifications">
          <h2>Clarifications</h2>
          <ul className="plain-list">
            {clarifications.map((c) => (
              <li key={c.id} data-testid={`clarification-${c.id}`}>
                <span>{c.question}</span>
                <span className="state-chip">{c.status}</span>
                {c.response
                  ? <span className="hint">{c.response} ({c.visibility})</span>
                  : (
                    <span className="inline-form">
                      <input data-testid={`answer-${c.id}`} placeholder="Answer…" value={answer[c.id] ?? ''}
                        onChange={(e) => setAnswer({ ...answer, [c.id]: e.target.value })} />
                      <button className="ghost-btn" data-testid={`answer-btn-${c.id}`}
                        onClick={() => void run(respondClarification(c.id, answer[c.id], 'PUBLIC'), 'Answered publicly.')}>
                        Answer
                      </button>
                    </span>
                  )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {open && (
        <section className="panel" data-testid="rfq-cancel-panel">
          <div className="inline-form">
            <input data-testid="rfq-cancel-reason" placeholder="Cancel reason" value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)} />
            <button className="ghost-btn" disabled={!cancelReason.trim()} data-testid="rfq-cancel-btn"
              onClick={() => void run(cancelRfq(id, cancelReason), 'RFQ cancelled.')}>
              Cancel RFQ
            </button>
          </div>
        </section>
      )}
    </main>
  );

  async function run(promise: Promise<unknown>, ok: string): Promise<void> {
    setError(''); setNotice('');
    try {
      await promise;
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }
}
