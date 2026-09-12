import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Clarification, declineRfq, getRfq, intendToQuote, listClarifications, listMyQuotes,
  listUnits, markRfqViewed, postClarification, QuoteSummary, reviseQuote, RfqDetail,
  submitQuote, UnitOfMeasure
} from '../lib/api/demand';

interface LineInput { quotedQty: string; uomId: string; price: string; deviationNote: string }

// Supplier quote builder. Original qty/UOM are submitted as-is (OD-08); the server
// records normalization metadata separately for the buyer's comparison view.
export function SupplierRfqPage(): JSX.Element {
  const { id = '' } = useParams();
  const [rfq, setRfq] = useState<RfqDetail | null>(null);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [myQuote, setMyQuote] = useState<QuoteSummary | null>(null);
  const [lines, setLines] = useState<Record<string, LineInput>>({});
  const [validTo, setValidTo] = useState('');
  const [notes, setNotes] = useState('');
  const [revisionReason, setRevisionReason] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [question, setQuestion] = useState('');
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const detail = await getRfq(id);
    setRfq(detail);
    const quotes = await listMyQuotes().catch(() => ({ items: [] }));
    setMyQuote(quotes.items.find((q) => q.rfq_ref === detail.ref) ?? null);
    setClarifications((await listClarifications(id).catch(() => ({ items: [] }))).items);
  }, [id]);

  useEffect(() => {
    void load().catch(() => setError('RFQ not found'));
    void markRfqViewed(id).catch(() => undefined);
    listUnits().then((r) => setUnits(r.items)).catch(() => undefined);
  }, [id, load]);

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

  if (!rfq) {
    return <main className="app-shell" data-testid="supplier-rfq-loading"><p className="hint">Loading…</p></main>;
  }

  const declined = rfq.invitationStatus === 'DECLINED';
  const lineInput = (lineId: string): LineInput =>
    lines[lineId] ?? { quotedQty: '', uomId: rfq.lines.find((l) => l.requirement_line_id === lineId)?.uom_id ?? '', price: '', deviationNote: '' };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!validTo) {
      setError('Quote validity date is required.');
      return;
    }
    const body = {
      validTo: new Date(validTo).toISOString(),
      supplierNotes: notes || undefined,
      ...(myQuote ? { revisionReason } : {}),
      lines: rfq.lines.map((l) => {
        const input = lineInput(l.requirement_line_id);
        return {
          requirementLineId: l.requirement_line_id,
          quotedQty: Number(input.quotedQty),
          quotedUomId: input.uomId,
          unitPriceMinor: Math.round(Number(input.price) * 100),
          deviationNote: input.deviationNote || undefined
        };
      })
    };
    if (body.lines.some((l) => !l.quotedQty || !l.quotedUomId || Number.isNaN(l.unitPriceMinor))) {
      setError('Every line needs a quantity, unit and unit price (₹).');
      return;
    }
    await run(async () => {
      if (myQuote) {
        await reviseQuote(myQuote.id, body, crypto.randomUUID());
      } else {
        await submitQuote(id, body, crypto.randomUUID());
      }
    }, myQuote ? 'Revision submitted.' : 'Quotation submitted to the buyer.');
  };

  return (
    <main className="app-shell" data-testid="supplier-rfq">
      <header className="shell-header">
        <h1>{rfq.title}</h1>
        <span className="state-chip frozen" data-testid="supplier-invitation-status">{rfq.invitationStatus}</span>
      </header>
      <p className="hint">{rfq.ref}
        {rfq.quote_deadline ? ` · quote by ${new Date(rfq.quote_deadline).toLocaleString()}` : ''}</p>
      {rfq.commercial_instructions && <p className="hint">Terms: {rfq.commercial_instructions}</p>}
      {error && <p className="form-error" data-testid="supplier-rfq-error">{error}</p>}
      {notice && <p className="form-ok" data-testid="supplier-rfq-notice">{notice}</p>}

      {!declined && (
        <div className="inline-form" style={{ marginBottom: 20 }} data-testid="invitation-actions">
          <button className="ghost-btn" data-testid="intend-btn" disabled={busy}
            onClick={() => void run(() => intendToQuote(id), 'Marked as intending to quote.')}>
            Intend to quote
          </button>
          <input data-testid="decline-reason" placeholder="Decline reason" value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)} />
          <button className="ghost-btn" data-testid="decline-btn" disabled={busy || !declineReason.trim()}
            onClick={() => void run(() => declineRfq(id, declineReason), 'Invitation declined.')}>
            Decline
          </button>
        </div>
      )}

      {!declined && (
        <form className="panel" onSubmit={submit} data-testid="quote-builder">
          <h2>{myQuote ? `Revise quotation ${myQuote.ref} (v${myQuote.current_version_no})` : 'Build quotation'}</h2>
          {rfq.lines.map((l) => {
            const input = lineInput(l.requirement_line_id);
            const set = (patch: Partial<LineInput>): void =>
              setLines({ ...lines, [l.requirement_line_id]: { ...input, ...patch } });
            return (
              <div key={l.id} className="panel" data-testid={`quote-line-${l.requirement_line_id}`}>
                <h3 className="sub-h">
                  {l.master_snapshot.commodity?.name ?? 'Line'} — requested {l.quantity ?? l.req_qty} · {l.delivery_destination ?? ''}
                </h3>
                <div className="inline-form">
                  <input data-testid={`quote-qty-${l.requirement_line_id}`} type="number" min="0" step="any"
                    placeholder="Qty" value={input.quotedQty} onChange={(e) => set({ quotedQty: e.target.value })} />
                  <select data-testid={`quote-uom-${l.requirement_line_id}`} value={input.uomId}
                    onChange={(e) => set({ uomId: e.target.value })}>
                    <option value="">Unit…</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                  </select>
                  <input data-testid={`quote-price-${l.requirement_line_id}`} type="number" min="0" step="any"
                    placeholder="Unit price ₹" value={input.price} onChange={(e) => set({ price: e.target.value })} />
                  <input data-testid={`quote-deviation-${l.requirement_line_id}`} placeholder="Deviation note (optional)"
                    value={input.deviationNote} onChange={(e) => set({ deviationNote: e.target.value })} />
                </div>
              </div>
            );
          })}
          <label>
            Quote valid until
            <input data-testid="quote-valid-to" type="datetime-local" value={validTo}
              onChange={(e) => setValidTo(e.target.value)} />
          </label>
          <label>
            Notes (delivery, terms)
            <input data-testid="quote-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {myQuote && (
            <label>
              Revision reason
              <input data-testid="quote-revision-reason" value={revisionReason}
                onChange={(e) => setRevisionReason(e.target.value)} />
            </label>
          )}
          <button type="submit" disabled={busy || (myQuote !== null && !revisionReason.trim())} data-testid="quote-submit-btn">
            {busy ? 'Submitting…' : myQuote ? 'Submit revision' : 'Submit quotation'}
          </button>
        </form>
      )}

      <section className="panel" data-testid="supplier-clarifications">
        <h2>Clarifications</h2>
        <ul className="plain-list">
          {clarifications.map((c) => (
            <li key={c.id} data-testid={`clarification-${c.id}`}>
              <span>{c.question}</span>
              <span className="state-chip">{c.status}</span>
              {c.response && <span className="hint">{c.response}</span>}
            </li>
          ))}
        </ul>
        {!declined && (
          <form className="inline-form" data-testid="clarification-form" onSubmit={(e) => {
            e.preventDefault();
            void run(() => postClarification(id, question), 'Question sent to the buyer.');
            setQuestion('');
          }}>
            <input data-testid="clarification-question" placeholder="Ask the buyer…" value={question}
              onChange={(e) => setQuestion(e.target.value)} />
            <button type="submit" data-testid="clarification-btn" disabled={!question.trim()}>Ask</button>
          </form>
        )}
      </section>
    </main>
  );
}
