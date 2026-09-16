import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  compareQuotes, Comparison, createAward, inr, QuoteLine
} from '../lib/api/demand';
import { MOBILE_MAX_QUERY } from '../design/breakpoints';
import { useMediaQuery } from '../design/useMediaQuery';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';

// Offer comparison (Phase 3 §3–§5). Buyer-controlled sorting, no ranking/"best" labels.
// Landed cost shown per explicit transaction UoM only when every commercial component
// is known; otherwise the pending state is explicit (§4).
type SortKey = 'price' | 'delivery' | 'coverage' | 'spec' | 'validity';

interface OfferRow {
  versionId: string;
  ref: string;
  supplierName: string;
  verified: boolean;
  versionNo: number;
  validTo: string;
  leadTimeDays: number | null;
  deliveryCommitment: string | null;
  landedCostComplete: boolean;
  line: QuoteLine;
  neededQty: number;
}

const SORTS: [SortKey, string][] = [
  ['price', 'Price'], ['delivery', 'Delivery'], ['coverage', 'Quantity coverage'],
  ['spec', 'Specification match'], ['validity', 'Validity']
];

function freightOf(line: QuoteLine): { label: string; amount?: number } {
  const f = (line.components ?? {}).FREIGHT;
  if (!f) {
    return { label: 'Freight pending' };
  }
  if (f.state === 'SUPPLIER_ARRANGED' || (f.state === 'KNOWN' && (f.amount_minor ?? 0) === 0)) {
    return { label: 'Freight included' };
  }
  if (f.state === 'KNOWN') {
    return { label: `Freight extra ${inr(f.amount_minor ?? 0)}`, amount: f.amount_minor };
  }
  if (f.state === 'BUYER_ARRANGED') {
    return { label: 'Freight arranged by you' };
  }
  return { label: 'Freight pending' };
}

function landedPerUom(row: OfferRow): { value: number; breakdown: string[] } | null {
  if (!row.landedCostComplete) {
    return null;
  }
  const qty = Number(row.line.quoted_qty) || 1;
  const known = Object.entries(row.line.components ?? {})
    .filter(([, c]) => (c.state === 'KNOWN' || c.state === 'SUPPLIER_ARRANGED') && c.amount_minor !== undefined);
  const extras = known.reduce((s, [, c]) => s + (c.amount_minor ?? 0), 0);
  const per = Number(row.line.unit_price_minor) + extras / qty;
  const breakdown = [
    `Goods ${inr(row.line.unit_price_minor)} / unit`,
    ...known.map(([k, c]) => `${k.toLowerCase()} ${inr(c.amount_minor ?? 0)} total`)
  ];
  return { value: per, breakdown };
}

export function OfferComparisonPage(): JSX.Element {
  const { id = '' } = useParams();
  const isMobile = useMediaQuery(MOBILE_MAX_QUERY);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sort, setSort] = useState<SortKey>('price');
  const [dialog, setDialog] = useState<{ row: OfferRow; lineId: string; uomId: string; uomCode: string; needed: number } | null>(null);
  const [awardQty, setAwardQty] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setComparison(await compareQuotes(id));
  }, [id]);
  useEffect(() => {
    void load().catch(() => setError('Offers unavailable'));
  }, [load]);

  const rowsByLine = useMemo(() => {
    if (!comparison) {
      return [];
    }
    return comparison.requirementLines.map((rl) => {
      const rows: OfferRow[] = comparison.offers
        .map((o) => {
          const line = o.lines.find((l) => l.requirement_line_id === rl.id);
          if (!line) {
            return null;
          }
          return {
            versionId: o.version_id, ref: o.ref,
            supplierName: o.supplier_org_name ?? 'Supplier',
            verified: o.supplier_kyb_status === 'VERIFIED',
            versionNo: o.version_no, validTo: o.valid_to,
            leadTimeDays: o.lead_time_days, deliveryCommitment: o.delivery_commitment ?? null,
            landedCostComplete: o.landedCostComplete, line, neededQty: Number(rl.quantity)
          } as OfferRow;
        })
        .filter((r): r is OfferRow => r !== null);
      const val = {
        price: (r: OfferRow) => Number(r.line.unit_price_minor),
        delivery: (r: OfferRow) => r.leadTimeDays ?? 9999,
        coverage: (r: OfferRow) => -Number(r.line.quoted_qty) / (r.neededQty || 1),
        spec: (r: OfferRow) => (r.line.deviation_note || r.line.proposes_substitution ? 1 : 0),
        validity: (r: OfferRow) => -new Date(r.validTo).getTime()
      }[sort];
      rows.sort((a, b) => val(a) - val(b));
      return { rl, rows };
    });
  }, [comparison, sort]);

  const openDialog = (row: OfferRow, lineId: string, uomId: string, uomCode: string, needed: number): void => {
    setDialog({ row, lineId, uomId, uomCode, needed });
    setAwardQty(String(Math.min(Number(row.line.quoted_qty), needed)));
    setConsent(false);
  };

  const confirmAward = async (): Promise<void> => {
    if (!dialog) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await createAward(id, {
        lines: [{
          requirementLineId: dialog.lineId,
          quotationVersionId: dialog.row.versionId,
          awardedQty: Number(awardQty),
          uomId: dialog.uomId
        }],
        consentAcceptedDeviations: consent || undefined
      }, crypto.randomUUID());
      setDialog(null);
      setNotice(`${dialog.row.supplierName} confirmed for this line. Your order is being prepared.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm the supplier');
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  if (error && !comparison) {
    return <InlineAlert variant="error" title="Offers unavailable" testId="offers-error">{error}</InlineAlert>;
  }
  if (!comparison) {
    return <SkeletonLoader variant="card" count={3} testId="offers-loading" />;
  }

  const renderFields = (r: OfferRow): JSX.Element => {
    const freight = freightOf(r.line);
    const landed = landedPerUom(r);
    const coverage = Math.min(100, Math.round((Number(r.line.quoted_qty) / (r.neededQty || 1)) * 100));
    const specClean = !r.line.deviation_note && !r.line.proposes_substitution;
    return (
      <>
        <div><div className="fs-md-card__field-label">Quantity offered</div>
          <div className="fs-md-card__field-value">{r.line.quoted_qty} ({coverage}% of need)</div></div>
        <div><div className="fs-md-card__field-label">Specification</div>
          <div className="fs-md-card__field-value">{specClean ? 'Matches specification' : 'Deviation proposed'}</div></div>
        <div><div className="fs-md-card__field-label">Unit price</div>
          <div className="fs-md-card__field-value">{inr(r.line.unit_price_minor)} {r.line.currency}</div></div>
        <div><div className="fs-md-card__field-label">Estimated total</div>
          <div className="fs-md-card__field-value">{inr(Number(r.line.quoted_qty) * Number(r.line.unit_price_minor))}</div></div>
        <div><div className="fs-md-card__field-label">Freight</div>
          <div className="fs-md-card__field-value">{freight.label}</div></div>
        <div><div className="fs-md-card__field-label">Delivery commitment</div>
          <div className="fs-md-card__field-value">
            {r.deliveryCommitment ?? (r.leadTimeDays !== null ? `${r.leadTimeDays} day${r.leadTimeDays === 1 ? '' : 's'} lead time` : 'To be confirmed')}
          </div></div>
        <div><div className="fs-md-card__field-label">Valid until</div>
          <div className="fs-md-card__field-value">{new Date(r.validTo).toLocaleDateString('en-IN')}</div></div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div className="fs-md-card__field-label">Landed cost</div>
          <div className="fs-md-card__field-value">
            {landed ? (
              <details data-testid={`landed-${r.versionId}`}>
                <summary>≈ {inr(Math.round(landed.value))} / unit (estimated)</summary>
                <p className="fs-caption fs-text-secondary" style={{ margin: 'var(--fs-space-2) 0 0' }}>
                  {landed.breakdown.join(' · ')}. Indicative — verify components before confirming.
                </p>
              </details>
            ) : (
              <span data-testid={`landed-pending-${r.versionId}`}>Landed cost pending — freight not confirmed</span>
            )}
          </div>
        </div>
        {r.line.deviation_note && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="fs-md-card__field-label">Deviation</div>
            <div className="fs-md-card__field-value">{r.line.deviation_note}</div>
          </div>
        )}
      </>
    );
  };

  return (
    <div data-testid="offer-comparison">
      <PageHeader overline="Offers" title="Compare your offers" testId="offers-header" />
      {notice && <InlineAlert variant="success" testId="offers-notice">{notice}</InlineAlert>}
      {error && <InlineAlert variant="error" testId="offers-error-inline">{error}</InlineAlert>}

      <div className="fs-field" style={{ maxWidth: 280 }}>
        <label className="fs-field__label" htmlFor="offers-sort">Sort by</label>
        <select id="offers-sort" className="fs-select" data-testid="offers-sort" value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}>
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {rowsByLine.every(({ rows }) => rows.length === 0) && (
        <EmptyState
          title="No offers yet"
          hint="Suppliers are reviewing your request. We'll notify you when offers arrive."
          testId="offers-empty"
        />
      )}

      {rowsByLine.map(({ rl, rows }) => (
        <section key={rl.id} style={{ marginTop: 'var(--fs-space-6)' }} data-testid={`offer-line-${rl.id}`}>
          <p className="fs-h4" style={{ margin: '0 0 var(--fs-space-3)' }}>
            {rl.master_snapshot.commodity?.name ?? 'Flower'} — need {rl.quantity} {rl.master_snapshot.uom?.code ?? ''}
          </p>
          {isMobile ? (
            <div className="fs-md-stack">
              {rows.map((r) => (
                <article key={r.versionId} className="fs-card fs-md-card" data-testid={`offer-card-${r.versionId}`}>
                  <div className="fs-task-card__top">
                    <span className="fs-md-card__primary">
                      {r.supplierName}
                      {r.verified && <span className="fs-caption" style={{ color: 'var(--fs-color-success, #1d7a4f)', marginLeft: 6 }} data-testid={`offer-verified-${r.versionId}`}>· Verified business</span>}
                    </span>
                    <StatusPill status={r.line.deviation_note || r.line.proposes_substitution ? 'ON_HOLD' : 'VALIDATED'}
                      label={r.line.deviation_note || r.line.proposes_substitution ? 'Deviation' : 'Matches spec'} testId={`offer-spec-${r.versionId}`} />
                  </div>
                  <div className="fs-md-card__fields">{renderFields(r)}</div>
                  <button className="fs-btn fs-btn--sm" style={{ marginTop: 'var(--fs-space-3)' }}
                    data-testid={`offer-select-${r.versionId}`}
                    onClick={() => openDialog(r, rl.id, rl.uom_id, rl.master_snapshot.uom?.code ?? '', Number(rl.quantity))}>
                    Select offer
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="fs-table-wrap">
              <table className="fs-table" data-testid={`offer-table-${rl.id}`}>
                <caption>{rl.master_snapshot.commodity?.name ?? 'Flower'} offers</caption>
                <thead>
                  <tr>
                    <th scope="col">Supplier</th><th scope="col">Quantity</th><th scope="col">Spec</th>
                    <th scope="col" className="fs-table__num">Unit price</th><th scope="col" className="fs-table__num">Est. total</th>
                    <th scope="col">Freight</th><th scope="col">Delivery</th><th scope="col">Valid until</th>
                    <th scope="col">Landed cost</th><th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const freight = freightOf(r.line);
                    const landed = landedPerUom(r);
                    const coverage = Math.min(100, Math.round((Number(r.line.quoted_qty) / (r.neededQty || 1)) * 100));
                    return (
                      <tr key={r.versionId} data-testid={`offer-row-${r.versionId}`}>
                        <td>
                          {r.supplierName}
                          {r.verified && <span className="fs-caption" data-testid={`offer-verified-${r.versionId}`}> · Verified</span>}
                          {r.line.deviation_note && <div className="fs-caption fs-text-secondary">Deviation: {r.line.deviation_note}</div>}
                        </td>
                        <td>{r.line.quoted_qty} ({coverage}%)</td>
                        <td>{r.line.deviation_note || r.line.proposes_substitution ? 'Deviation' : 'Matches'}</td>
                        <td className="fs-table__num">{inr(r.line.unit_price_minor)}</td>
                        <td className="fs-table__num">{inr(Number(r.line.quoted_qty) * Number(r.line.unit_price_minor))}</td>
                        <td>{freight.label}</td>
                        <td>{r.deliveryCommitment ?? (r.leadTimeDays !== null ? `${r.leadTimeDays}d lead` : 'TBC')}</td>
                        <td>{new Date(r.validTo).toLocaleDateString('en-IN')}</td>
                        <td>
                          {landed ? (
                            <details data-testid={`landed-${r.versionId}`}>
                              <summary>≈ {inr(Math.round(landed.value))}/unit</summary>
                              <span className="fs-caption fs-text-secondary">{landed.breakdown.join(' · ')}</span>
                            </details>
                          ) : (
                            <span className="fs-caption" data-testid={`landed-pending-${r.versionId}`}>Pending — freight not confirmed</span>
                          )}
                        </td>
                        <td>
                          <button className="fs-btn fs-btn--sm" data-testid={`offer-select-${r.versionId}`}
                            onClick={() => openDialog(r, rl.id, rl.uom_id, rl.master_snapshot.uom?.code ?? '', Number(rl.quantity))}>
                            Select offer
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      {dialog && (
        <>
          <div className="fs-overlay" onClick={() => setDialog(null)} />
          <div className="fs-dialog" data-testid="select-offer-dialog">
            <div className="fs-dialog__box" role="alertdialog" aria-modal="true" aria-labelledby="select-offer-title">
              <h2 className="fs-dialog__title" id="select-offer-title">Confirm supplier</h2>
              <p className="fs-dialog__consequence" data-testid="select-offer-summary">
                You are confirming <strong>{dialog.row.supplierName}</strong> — {inr(dialog.row.line.unit_price_minor)} {dialog.row.line.currency}/unit,
                {' '}{freightOf(dialog.row.line).label.toLowerCase()},
                {' '}delivery {dialog.row.deliveryCommitment ?? (dialog.row.leadTimeDays !== null ? `${dialog.row.leadTimeDays} day lead time` : 'to be confirmed')}.
                This creates a purchase order and the supplier is notified.
              </p>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="award-qty">Quantity ({dialog.uomCode}, max {dialog.row.line.quoted_qty})</label>
                <input id="award-qty" className="fs-input fs-num" data-testid="select-offer-qty" type="number"
                  min="0.01" max={Number(dialog.row.line.quoted_qty)} step="any" value={awardQty}
                  onChange={(e) => setAwardQty(e.target.value)} />
              </div>
              {(dialog.row.line.deviation_note || dialog.row.line.proposes_substitution) && (
                <label className="fs-body" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 'var(--fs-space-3)' }}>
                  <input type="checkbox" data-testid="select-offer-consent" checked={consent}
                    onChange={(e) => setConsent(e.target.checked)} />
                  I accept the proposed deviation: {dialog.row.line.deviation_note ?? 'substitution'}
                </label>
              )}
              <div className="fs-dialog__actions">
                <button className="fs-btn fs-btn--ghost" data-testid="select-offer-cancel" onClick={() => setDialog(null)}>Cancel</button>
                <button className="fs-btn" data-testid="select-offer-confirm" disabled={busy || !Number(awardQty)}
                  onClick={() => void confirmAward()}>
                  {busy ? 'Confirming…' : 'Confirm supplier'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
