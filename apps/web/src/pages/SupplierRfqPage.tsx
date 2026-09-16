import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Clarification, declineRfq, getRfq, inr, intendToQuote, listClarifications, listMyQuotes,
  listUnits, markRfqViewed, postClarification, QuoteSummary, reviseQuote, RfqDetail,
  submitQuote, UnitOfMeasure
} from '../lib/api/demand';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';

// Supplier request + quote builder (Phase 4 §2–§3): the buyer's request in plain
// language (flower, spec, quantity, UoM, required date, destination, offer deadline —
// no internal IDs), actions Quote / Decline / Ask buyer, and a builder with freight
// state, delivery commitment, validity, deviation, notes and a live total. Revision
// requires a reason.
interface LineInput {
  quotedQty: string; uomId: string; price: string;
  freight: 'INCLUDED' | 'EXTRA' | 'PENDING'; freightAmount: string; deviationNote: string;
}

export function SupplierRfqPage(): JSX.Element {
  const { id = '' } = useParams();
  const [rfq, setRfq] = useState<RfqDetail | null>(null);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [myQuote, setMyQuote] = useState<QuoteSummary | null>(null);
  const [lines, setLines] = useState<Record<string, LineInput>>({});
  const [validTo, setValidTo] = useState('');
  const [deliveryCommitment, setDeliveryCommitment] = useState('');
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
    void load().catch(() => setError('Request not found'));
    void markRfqViewed(id).catch(() => undefined);
    listUnits().then((r) => setUnits(r.items)).catch(() => undefined);
  }, [id, load]);

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setBusy(true);
    setError('');
    setNotice('');
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
    return <SkeletonLoader variant="card" count={2} testId="supplier-rfq-loading" />;
  }

  const declined = rfq.invitationStatus === 'DECLINED';
  const lineInput = (lineId: string): LineInput =>
    lines[lineId] ?? {
      quotedQty: '', uomId: rfq.lines.find((l) => l.requirement_line_id === lineId)?.uom_id ?? '',
      price: '', freight: 'PENDING', freightAmount: '', deviationNote: ''
    };

  const lineTotal = (input: LineInput): number => {
    const goods = Number(input.quotedQty) * Number(input.price);
    const freight = input.freight === 'EXTRA' ? Number(input.freightAmount) || 0 : 0;
    return goods + freight;
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!validTo) {
      setError('Set how long your offer is valid.');
      return;
    }
    const body = {
      validTo: new Date(validTo).toISOString(),
      deliveryCommitment: deliveryCommitment || undefined,
      supplierNotes: notes || undefined,
      ...(myQuote ? { revisionReason } : {}),
      lines: rfq.lines.map((l) => {
        const input = lineInput(l.requirement_line_id);
        return {
          requirementLineId: l.requirement_line_id,
          quotedQty: Number(input.quotedQty),
          quotedUomId: input.uomId,
          unitPriceMinor: Math.round(Number(input.price) * 100),
          deviationNote: input.deviationNote || undefined,
          components: {
            FREIGHT: input.freight === 'INCLUDED'
              ? { state: 'SUPPLIER_ARRANGED' }
              : input.freight === 'EXTRA'
                ? { state: 'KNOWN', amountMinor: Math.round(Number(input.freightAmount) * 100) }
                : { state: 'PLATFORM_QUOTE_PENDING' }
          }
        };
      })
    };
    if (body.lines.some((l) => !l.quotedQty || !l.quotedUomId || Number.isNaN(l.unitPriceMinor))) {
      setError('Every line needs a quantity, unit and unit price (₹).');
      return;
    }
    if (body.lines.some((l) => l.components.FREIGHT.state === 'KNOWN' && !(l.components.FREIGHT.amountMinor ?? 0))) {
      setError('Freight marked extra needs an amount (₹).');
      return;
    }
    await run(async () => {
      if (myQuote) {
        await reviseQuote(myQuote.id, body, crypto.randomUUID());
      } else {
        await submitQuote(id, body, crypto.randomUUID());
      }
    }, myQuote ? 'Revision sent to the buyer.' : 'Offer sent to the buyer.');
  };

  return (
    <div data-testid="supplier-rfq">
      <PageHeader overline="Buyer request" title={rfq.title} testId="supplier-rfq-header" />
      <div className="fs-task-card__top">
        <StatusPill status={rfq.invitationStatus ?? 'INVITED'} testId="supplier-invitation-status" />
        {rfq.quote_deadline && (
          <span className="fs-caption fs-text-secondary" data-testid="req-deadline">
            Offer due {new Date(rfq.quote_deadline).toLocaleString('en-IN')}
          </span>
        )}
      </div>
      {error && <InlineAlert variant="error" testId="supplier-rfq-error">{error}</InlineAlert>}
      {notice && <InlineAlert variant="success" testId="supplier-rfq-notice">{notice}</InlineAlert>}

      <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="request-summary">
        <p className="fs-overline">What the buyer needs</p>
        {rfq.lines.map((l) => (
          <div className="fs-md-card__fields" key={l.id} data-testid={`req-line-${l.requirement_line_id.slice(0, 8)}`}>
            <div><div className="fs-md-card__field-label">Flower</div>
              <div className="fs-md-card__field-value" data-testid="req-flower">{l.master_snapshot.commodity?.name ?? 'Flower'}</div></div>
            <div><div className="fs-md-card__field-label">Quantity</div>
              <div className="fs-md-card__field-value" data-testid="req-qty">{l.quantity ?? l.req_qty} {l.master_snapshot.uom?.code ?? ''}</div></div>
            <div><div className="fs-md-card__field-label">Required by</div>
              <div className="fs-md-card__field-value" data-testid="req-needed">
                {l.needed_at ? new Date(l.needed_at).toLocaleString('en-IN') : '—'}
              </div></div>
            <div><div className="fs-md-card__field-label">Deliver to</div>
              <div className="fs-md-card__field-value" data-testid="req-destination">{l.delivery_destination ?? '—'}</div></div>
          </div>
        ))}
        {rfq.commercial_instructions && (
          <p className="fs-caption fs-text-secondary" style={{ marginBottom: 0 }}>Terms from buyer: {rfq.commercial_instructions}</p>
        )}
      </section>

      {!declined && (
        <div style={{ display: 'flex', gap: 'var(--fs-space-2)', marginTop: 'var(--fs-space-4)', flexWrap: 'wrap' }} data-testid="invitation-actions">
          <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="intend-btn" disabled={busy}
            onClick={() => void run(() => intendToQuote(id), 'Marked as intending to quote.')}>
            Intend to quote
          </button>
        </div>
      )}

      {!declined && (
        <form className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} onSubmit={submit} data-testid="quote-builder">
          <p className="fs-overline">{myQuote ? `Revise your offer (v${myQuote.current_version_no})` : 'Build your offer'}</p>
          {rfq.lines.map((l) => {
            const input = lineInput(l.requirement_line_id);
            const set = (patch: Partial<LineInput>): void =>
              setLines({ ...lines, [l.requirement_line_id]: { ...input, ...patch } });
            return (
              <div key={l.id} style={{ marginBottom: 'var(--fs-space-4)' }} data-testid={`quote-line-${l.requirement_line_id}`}>
                <p className="fs-h4" style={{ margin: '0 0 var(--fs-space-2)' }}>
                  {l.master_snapshot.commodity?.name ?? 'Line'} — requested {l.quantity ?? l.req_qty} {l.master_snapshot.uom?.code ?? ''}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--fs-space-3)' }}>
                  <div className="fs-field">
                    <label className="fs-field__label" htmlFor={`qq-${l.requirement_line_id}`}>Quantity</label>
                    <input id={`qq-${l.requirement_line_id}`} className="fs-input fs-num" data-testid={`quote-qty-${l.requirement_line_id}`}
                      type="number" min="0" step="any" value={input.quotedQty} onChange={(e) => set({ quotedQty: e.target.value })} />
                  </div>
                  <div className="fs-field">
                    <label className="fs-field__label" htmlFor={`qu-${l.requirement_line_id}`}>Unit</label>
                    <select id={`qu-${l.requirement_line_id}`} className="fs-select" data-testid={`quote-uom-${l.requirement_line_id}`}
                      value={input.uomId} onChange={(e) => set({ uomId: e.target.value })}>
                      <option value="">Unit…</option>
                      {units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                    </select>
                  </div>
                  <div className="fs-field">
                    <label className="fs-field__label" htmlFor={`qp-${l.requirement_line_id}`}>Unit price (₹)</label>
                    <input id={`qp-${l.requirement_line_id}`} className="fs-input fs-num" data-testid={`quote-price-${l.requirement_line_id}`}
                      type="number" min="0" step="any" value={input.price} onChange={(e) => set({ price: e.target.value })} />
                  </div>
                  <div className="fs-field">
                    <label className="fs-field__label" htmlFor={`qf-${l.requirement_line_id}`}>Freight</label>
                    <select id={`qf-${l.requirement_line_id}`} className="fs-select" data-testid={`quote-freight-${l.requirement_line_id}`}
                      value={input.freight} onChange={(e) => set({ freight: e.target.value as LineInput['freight'] })}>
                      <option value="INCLUDED">Included in price</option>
                      <option value="EXTRA">Extra (amount)</option>
                      <option value="PENDING">Pending — confirm later</option>
                    </select>
                  </div>
                  {input.freight === 'EXTRA' && (
                    <div className="fs-field">
                      <label className="fs-field__label" htmlFor={`qfa-${l.requirement_line_id}`}>Freight amount (₹)</label>
                      <input id={`qfa-${l.requirement_line_id}`} className="fs-input fs-num" data-testid={`quote-freight-amount-${l.requirement_line_id}`}
                        type="number" min="0" step="any" value={input.freightAmount} onChange={(e) => set({ freightAmount: e.target.value })} />
                    </div>
                  )}
                  <div className="fs-field" style={{ gridColumn: '1 / -1' }}>
                    <label className="fs-field__label" htmlFor={`qd-${l.requirement_line_id}`}>Deviation (optional)</label>
                    <input id={`qd-${l.requirement_line_id}`} className="fs-input" data-testid={`quote-deviation-${l.requirement_line_id}`}
                      placeholder="e.g. 50cm stems instead of 55cm" value={input.deviationNote}
                      onChange={(e) => set({ deviationNote: e.target.value })} />
                  </div>
                </div>
                <p className="fs-body" style={{ margin: 'var(--fs-space-2) 0 0' }} data-testid={`quote-total-${l.requirement_line_id}`}>
                  Live total: <strong>{inr(Math.round(lineTotal(input) * 100))}</strong>
                  {input.freight === 'EXTRA' && input.freightAmount ? ' (incl. freight)' : ''}
                  {input.freight === 'PENDING' ? ' (freight pending)' : ''}
                </p>
              </div>
            );
          })}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--fs-space-3)' }}>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="quote-valid">Offer valid until</label>
              <input id="quote-valid" className="fs-input" data-testid="quote-valid-to" type="datetime-local" value={validTo}
                onChange={(e) => setValidTo(e.target.value)} />
            </div>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="quote-delivery">Delivery commitment</label>
              <input id="quote-delivery" className="fs-input" data-testid="quote-delivery" value={deliveryCommitment}
                onChange={(e) => setDeliveryCommitment(e.target.value)} placeholder="e.g. dispatch within 24h of confirmation" />
            </div>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="quote-notes">Notes</label>
              <input id="quote-notes" className="fs-input" data-testid="quote-notes" value={notes}
                onChange={(e) => setNotes(e.target.value)} placeholder="Terms, packing, anything the buyer should know" />
            </div>
            {myQuote && (
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="quote-reason">Revision reason (required)</label>
                <input id="quote-reason" className="fs-input" data-testid="quote-revision-reason" value={revisionReason}
                  onChange={(e) => setRevisionReason(e.target.value)} placeholder="Why is this offer changing?" />
              </div>
            )}
          </div>
          <button type="submit" className="fs-btn" style={{ marginTop: 'var(--fs-space-4)' }}
            disabled={busy || (myQuote !== null && !revisionReason.trim())} data-testid="quote-submit-btn">
            {busy ? 'Sending…' : myQuote ? 'Send revision' : 'Send offer'}
          </button>
        </form>
      )}

      <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="supplier-clarifications">
        <p className="fs-overline">Ask the buyer</p>
        <ul style={{ listStyle: 'none', margin: '0 0 var(--fs-space-3)', padding: 0, display: 'grid', gap: 'var(--fs-space-2)' }}>
          {clarifications.map((c) => (
            <li key={c.id} data-testid={`clarification-${c.id}`}>
              <span className="fs-body">{c.question}</span>{' '}
              <StatusPill status={c.status} testId={`clarification-status-${c.id}`} />
              {c.response && <div className="fs-caption fs-text-secondary">{c.response}</div>}
            </li>
          ))}
        </ul>
        {!declined && (
          <form style={{ display: 'flex', gap: 'var(--fs-space-2)' }} data-testid="clarification-form" onSubmit={(e) => {
            e.preventDefault();
            void run(() => postClarification(id, question), 'Question sent to the buyer.');
            setQuestion('');
          }}>
            <input className="fs-input" style={{ flex: 1 }} data-testid="clarification-question" placeholder="Ask the buyer…" value={question}
              onChange={(e) => setQuestion(e.target.value)} />
            <button type="submit" className="fs-btn fs-btn--sm" data-testid="clarification-btn" disabled={!question.trim()}>Ask</button>
          </form>
        )}
        {!declined && (
          <div style={{ display: 'flex', gap: 'var(--fs-space-2)', marginTop: 'var(--fs-space-4)' }}>
            <input className="fs-input" style={{ flex: 1 }} data-testid="decline-reason" placeholder="Reason (if you can't take this)" value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)} />
            <button className="fs-btn fs-btn--ghost fs-btn--sm" data-testid="decline-btn" disabled={busy || !declineReason.trim()}
              onClick={() => void run(() => declineRfq(id, declineReason), 'Declined — the buyer is notified.')}>
              Decline
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
