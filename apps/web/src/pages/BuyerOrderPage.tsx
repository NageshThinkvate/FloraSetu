import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  acceptDelivery, BuyerOrderDetail, ClaimRow, createClaim, EvidencePack, fmtDate, getEvidencePack,
  getOrder, listMyClaims, submitClaim, uploadMedia, addReceiptEvidence
} from '../lib/api/fulfilment';
import { resolveStatus } from '../design/status';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';

// Buyer order page (Phase 3 §6–§9): timeline-first, evidence pack, delivery acceptance
// and an evidence-first report-an-issue flow. No operational state-transition buttons.
const STAGE_RANK = ['PENDING_CONFIRMATION', 'SUPPLY_CONFIRMED', 'ALLOCATING', 'QC_PACK', 'READY_FOR_DISPATCH',
  'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'CLOSED'];

const ISSUE_CATEGORIES: [string, string][] = [
  ['Wrong flower', 'WRONG_PRODUCT'], ['Wrong variety', 'WRONG_PRODUCT'], ['Wrong colour', 'WRONG_PRODUCT'],
  ['Specification mismatch', 'QUALITY_MISMATCH'], ['Damaged flowers', 'DAMAGED'],
  ['Wilted / poor condition', 'QUALITY_MISMATCH'], ['Short quantity', 'SHORT_QUANTITY'],
  ['Packing issue', 'OTHER'], ['Late delivery', 'LATE_DELIVERY'], ['Other', 'OTHER']
];

interface Step { key: string; label: string; owner: string; done: boolean; when?: string | null }

function rank(status: string): number {
  return STAGE_RANK.indexOf(status === 'CLAIM_OPEN' ? 'ACCEPTANCE_PENDING' : status);
}

function Media({ m }: { m: { id: string; url: string; contentType: string } }): JSX.Element {
  if (m.contentType.startsWith('video/')) {
    return <video key={m.id} src={m.url} controls preload="none" style={{ maxWidth: 220, borderRadius: 8, display: 'block' }} />;
  }
  return (
    <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
      <img src={m.url} alt="Evidence" loading="lazy" style={{ maxWidth: 140, borderRadius: 8, display: 'block' }} />
    </a>
  );
}

export function BuyerOrderPage(): JSX.Element {
  const { id = '' } = useParams();
  const [order, setOrder] = useState<BuyerOrderDetail | null>(null);
  const [pack, setPack] = useState<EvidencePack | null>(null);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [notBuyer, setNotBuyer] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [acceptedQty, setAcceptedQty] = useState('');
  const [disputedQty, setDisputedQty] = useState('0');
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueCategory, setIssueCategory] = useState('');
  const [issueQty, setIssueQty] = useState('');
  const [issueText, setIssueText] = useState('');
  const [issueMedia, setIssueMedia] = useState<string[]>([]);

  const load = useCallback(async (): Promise<void> => {
    const o = await getOrder(id);
    if ('allocation' in o) {
      setNotBuyer(true);
      return;
    }
    setOrder(o as BuyerOrderDetail);
    try {
      setPack(await getEvidencePack(id));
    } catch {
      setPack(null);
    }
    setClaims((await listMyClaims()).items.filter((c) => c.order_id === id));
  }, [id]);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Order unavailable'));
  }, [load]);

  const deliveredQty = useMemo(
    () => (pack?.shipments ?? []).flatMap((s) => s.pods).reduce((sum, p) => sum + p.deliveredQty, 0),
    [pack]
  );
  useEffect(() => {
    if (deliveredQty > 0 && !acceptedQty) {
      setAcceptedQty(String(deliveredQty));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveredQty]);

  if (notBuyer) {
    return (
      <InlineAlert variant="info" testId="buyer-order-not-buyer">
        This order belongs to your supplier workspace. <Link to="/supplier/orders">Open supplier orders</Link>
      </InlineAlert>
    );
  }
  if (error && !order) {
    return <InlineAlert variant="error" testId="buyer-order-error">{error}</InlineAlert>;
  }
  if (!order) {
    return <SkeletonLoader variant="card" count={3} testId="buyer-order-loading" />;
  }

  const r = rank(order.status);
  const shipments = pack?.shipments ?? [];
  const lots = pack?.lots ?? [];
  const eta = shipments.find((s) => s.eta)?.eta ?? null;
  const steps: Step[] = [
    { key: 'offer-selected', label: 'Offer selected', owner: 'You', done: true, when: fmtDate(order.created_at) },
    { key: 'supplier-confirmed', label: 'Supplier confirmed', owner: 'Supplier', done: r >= rank('SUPPLY_CONFIRMED') },
    {
      key: 'lot-evidence', label: 'Lot evidence submitted', owner: 'Supplier',
      done: lots.some((l) => l.declaredAt) || r >= rank('QC_PACK'),
      when: lots.find((l) => l.declaredAt)?.declaredAt ?? null
    },
    { key: 'packed', label: 'Packed', owner: 'Supplier', done: (pack?.packs.length ?? 0) > 0 || r >= rank('READY_FOR_DISPATCH') },
    {
      key: 'pickup', label: 'Logistics pickup', owner: 'Logistics partner',
      done: shipments.some((s) => s.pickupAt) || r >= rank('DELIVERED'),
      when: shipments.find((s) => s.pickupAt)?.pickupAt ?? null
    },
    {
      key: 'on-the-way', label: 'On the way', owner: 'Logistics partner',
      done: shipments.some((s) => ['IN_TRANSIT', 'DELIVERED'].includes(s.status)) || r >= rank('DELIVERED'),
      when: shipments.find((s) => s.dispatchedAt)?.dispatchedAt ?? null
    },
    {
      key: 'delivered', label: 'Delivered', owner: 'Logistics partner', done: r >= rank('DELIVERED'),
      when: shipments.find((s) => s.pods.length > 0)?.pods[0]?.receivedAt ?? null
    },
    {
      key: 'buyer-review', label: 'Buyer review', owner: 'You', done: r >= rank('ACCEPTED'),
      when: order.accepted_at ?? null
    },
    { key: 'completed', label: 'Completed', owner: '—', done: ['ACCEPTED', 'CLOSED'].includes(order.status) }
  ];
  const current = steps.find((s) => !s.done);
  const orderedQty = order.lines.reduce((sum, l) => sum + Number(l.qty), 0);
  const declaredQty = lots.reduce((sum, l) => sum + (l.declaredQty ?? 0), 0);
  const canReview = ['DELIVERED', 'ACCEPTANCE_PENDING'].includes(order.status);

  const accept = async (withIssue: boolean): Promise<void> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await acceptDelivery(id, {
        acceptedQty: Number(acceptedQty),
        disputedQty: Number(disputedQty),
        reason: withIssue ? 'Accepted with reported issue' : undefined
      });
      setNotice(withIssue ? 'Delivery accepted with issue — we opened a claim review.' : 'Delivery accepted. Thank you!');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Acceptance failed');
    } finally {
      setBusy(false);
    }
  };

  const uploadIssueMedia = async (file: File | undefined): Promise<void> => {
    if (!file) {
      return;
    }
    setError('');
    try {
      const stored = await uploadMedia(file);
      setIssueMedia((m) => [...m, stored.id]);
    } catch {
      setError('Upload failed — try again.');
    }
  };

  const reportIssue = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!issueCategory) {
      setError('Choose what went wrong.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const claim = await createClaim({
        orderId: id,
        category: issueCategory,
        description: issueText.trim() || 'Issue reported with evidence',
        disputedQty: issueQty ? Number(issueQty) : undefined,
        mediaObjectIds: issueMedia,
        lotId: lots[0]?.id,
        podId: shipments.flatMap((s) => s.pods)[0]?.id
      });
      await submitClaim(claim.id);
      setIssueOpen(false);
      setNotice('Issue reported — FloraSetu operations has been notified with your evidence.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not report the issue');
    } finally {
      setBusy(false);
    }
  };

  const addReceiptPhoto = async (file: File | undefined): Promise<void> => {
    if (!file) {
      return;
    }
    setError('');
    try {
      const stored = await uploadMedia(file);
      await addReceiptEvidence(id, { mediaObjectId: stored.id, purpose: 'RECEIPT_EVIDENCE' });
      setNotice('Receipt photo added to this order.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  };

  return (
    <div data-testid="buyer-order-page">
      <PageHeader overline="Order" title={order.ref} testId="buyer-order-header" />
      <div className="fs-task-card__top">
        <StatusPill status={order.status} testId="buyer-order-status" />
        <span className="fs-caption fs-text-secondary">{order.delivery_destination}</span>
      </div>
      {notice && <InlineAlert variant="success" testId="buyer-order-notice">{notice}</InlineAlert>}
      {error && <InlineAlert variant="error" testId="buyer-order-error-inline">{error}</InlineAlert>}

      <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="order-timeline">
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--fs-space-2)' }}>
          {steps.map((s) => {
            const isCurrent = current?.key === s.key;
            return (
              <li key={s.key} data-testid={`timeline-step-${s.key}`}
                style={{
                  display: 'flex', gap: 'var(--fs-space-3)', alignItems: 'flex-start',
                  padding: 'var(--fs-space-2) var(--fs-space-3)', borderRadius: 8,
                  background: isCurrent ? 'var(--fs-color-info-subtle, #eaf2fb)' : 'transparent',
                  borderLeft: isCurrent ? '3px solid var(--fs-color-info, #2563eb)' : '3px solid transparent'
                }}>
                <span aria-hidden style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                  background: s.done ? 'var(--fs-color-success, #1d7a4f)' : isCurrent ? 'var(--fs-color-info, #2563eb)' : '#d6dcd8',
                  color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12
                }}>{s.done ? '✓' : ''}</span>
                <div>
                  <div className="fs-body" style={{ fontWeight: isCurrent ? 700 : 400 }}>{s.label}</div>
                  {s.when && <div className="fs-caption fs-text-secondary">{fmtDate(s.when)}</div>}
                  {isCurrent && (
                    <div className="fs-caption" data-testid="timeline-next" style={{ marginTop: 2 }}>
                      Next: <strong>{s.owner === 'You' ? 'you' : s.owner.toLowerCase()}</strong>
                      {eta && (s.key === 'on-the-way' || s.key === 'pickup') ? ` · expected ${fmtDate(eta)}` : ''}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {canReview && (
        <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="review-delivery">
          <p className="fs-overline">Review delivery</p>
          <div className="fs-md-card__fields" style={{ marginBottom: 'var(--fs-space-4)' }}>
            <div><div className="fs-md-card__field-label">Ordered</div><div className="fs-md-card__field-value">{orderedQty}</div></div>
            <div><div className="fs-md-card__field-label">Supplier-declared</div><div className="fs-md-card__field-value">{declaredQty || '—'}</div></div>
            <div><div className="fs-md-card__field-label">Delivered</div><div className="fs-md-card__field-value">{deliveredQty || '—'}</div></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--fs-space-3)', maxWidth: 360 }}>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="accepted-qty">Accepted quantity</label>
              <input id="accepted-qty" className="fs-input fs-num" data-testid="accept-qty" type="number" min="0" step="any"
                value={acceptedQty} onChange={(e) => setAcceptedQty(e.target.value)} />
            </div>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="disputed-qty">Disputed quantity</label>
              <input id="disputed-qty" className="fs-input fs-num" data-testid="dispute-qty" type="number" min="0" step="any"
                value={disputedQty} onChange={(e) => setDisputedQty(e.target.value)} />
            </div>
          </div>
          <div className="fs-md-stack" style={{ marginTop: 'var(--fs-space-3)' }}>
            <button className="fs-btn" data-testid="accept-delivery-btn" disabled={busy || !acceptedQty}
              onClick={() => void accept(false)}>Accept delivery</button>
            <button className="fs-btn fs-btn--ghost" data-testid="accept-with-issue-btn" disabled={busy || !acceptedQty || Number(disputedQty) <= 0}
              onClick={() => void accept(true)}>Accept with issue</button>
            <button className="fs-btn fs-btn--danger fs-btn--ghost" data-testid="report-issue-btn" disabled={busy}
              onClick={() => setIssueOpen((v) => !v)}>Report an issue</button>
          </div>
        </section>
      )}

      {issueOpen && (
        <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="issue-form">
          <p className="fs-overline">Report an issue</p>
          <form onSubmit={reportIssue}>
            <div className="fs-field">
              <span className="fs-field__label">Photos / video of the issue</span>
              <div style={{ display: 'flex', gap: 'var(--fs-space-3)', flexWrap: 'wrap' }}>
                <input type="file" accept="image/*" capture="environment" data-testid="issue-photo-input"
                  onChange={(e) => void uploadIssueMedia(e.target.files?.[0])} />
                <input type="file" accept="video/*" data-testid="issue-video-input"
                  onChange={(e) => void uploadIssueMedia(e.target.files?.[0])} />
              </div>
              <span className="fs-caption fs-text-secondary" data-testid="issue-media-count">{issueMedia.length} file{issueMedia.length === 1 ? '' : 's'} attached — order, lot and delivery records are linked automatically.</span>
            </div>
            <div className="fs-field">
              <span className="fs-field__label">What went wrong?</span>
              <div style={{ display: 'flex', gap: 'var(--fs-space-2)', flexWrap: 'wrap' }} role="radiogroup" aria-label="Issue category">
                {ISSUE_CATEGORIES.map(([label, value]) => (
                  <button key={value} type="button"
                    className={`fs-btn fs-btn--sm ${issueCategory === value ? '' : 'fs-btn--ghost'}`}
                    data-testid={`issue-cat-${value}`}
                    aria-pressed={issueCategory === value}
                    onClick={() => setIssueCategory(value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--fs-space-3)' }}>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="issue-qty">Affected quantity</label>
                <input id="issue-qty" className="fs-input fs-num" data-testid="issue-qty" type="number" min="0" step="any"
                  value={issueQty} onChange={(e) => setIssueQty(e.target.value)} />
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="issue-text">Description</label>
                <input id="issue-text" className="fs-input" data-testid="issue-text" value={issueText}
                  onChange={(e) => setIssueText(e.target.value)} placeholder="Tell us what you see" />
              </div>
            </div>
            <button type="submit" className="fs-btn" data-testid="issue-submit" disabled={busy || !issueCategory}>
              {busy ? 'Reporting…' : 'Report issue with evidence'}
            </button>
          </form>
        </section>
      )}

      {pack && (
        <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="evidence-pack">
          <p className="fs-overline">Order evidence</p>
          <h2 className="fs-h3" style={{ margin: '0 0 var(--fs-space-4)' }}>Supply &amp; delivery evidence</h2>

          {lots.map((lot) => (
            <div key={lot.id} style={{ marginBottom: 'var(--fs-space-4)' }} data-testid={`evidence-lot-${lot.ref}`}>
              <h3 className="fs-h4">Supplier declaration — lot {lot.ref}</h3>
              <div className="fs-md-card__fields">
                {lot.batchRef && <div><div className="fs-md-card__field-label">Batch</div><div className="fs-md-card__field-value">{lot.batchRef}</div></div>}
                {lot.declaredQty !== null && <div><div className="fs-md-card__field-label">Declared quantity</div><div className="fs-md-card__field-value">{lot.declaredQty}</div></div>}
                {lot.declaredStemLengthCm !== null && <div><div className="fs-md-card__field-label">Stem length</div><div className="fs-md-card__field-value">{lot.declaredStemLengthCm} cm</div></div>}
                {lot.bloomStage && <div><div className="fs-md-card__field-label">Bloom stage</div><div className="fs-md-card__field-value">{lot.bloomStage.toLowerCase().replace(/_/g, ' ')}</div></div>}
                {(lot.harvestAt ?? lot.receivedAt) && (
                  <div><div className="fs-md-card__field-label">{lot.harvestAt ? 'Harvested' : 'Received'}</div>
                    <div className="fs-md-card__field-value">{fmtDate(lot.harvestAt ?? lot.receivedAt ?? null)}</div></div>
                )}
                {lot.declaredAt && <div><div className="fs-md-card__field-label">Declared at</div><div className="fs-md-card__field-value">{fmtDate(lot.declaredAt)}</div></div>}
              </div>
              <p className="fs-caption fs-text-secondary" style={{ margin: 'var(--fs-space-2) 0' }}>Supplier-submitted evidence</p>
              <div style={{ display: 'flex', gap: 'var(--fs-space-3)', flexWrap: 'wrap' }}>
                {lot.media.filter((m) => ['LOT_ACTUAL', 'LOT_PHOTO', 'LOT_VIDEO'].includes(m.purpose)).map((m) => <Media key={m.id} m={m} />)}
              </div>
              {lot.media.some((m) => ['PACKING', 'PACKED_LOT'].includes(m.purpose)) && (
                <>
                  <h4 className="fs-h4" style={{ marginTop: 'var(--fs-space-3)' }}>Packing</h4>
                  <div style={{ display: 'flex', gap: 'var(--fs-space-3)', flexWrap: 'wrap' }}>
                    {lot.media.filter((m) => ['PACKING', 'PACKED_LOT'].includes(m.purpose)).map((m) => <Media key={m.id} m={m} />)}
                  </div>
                </>
              )}
            </div>
          ))}

          {(pack.packs.length > 0) && (
            <div data-testid="evidence-packing">
              <h3 className="fs-h4">Packing / dispatch</h3>
              {pack.packs.map((p) => (
                <p key={p.id} className="fs-body">
                  Packed {p.packedQty}{p.cartonCount !== null ? ` · ${p.cartonCount} carton${p.cartonCount === 1 ? '' : 's'}` : ''}{p.packType ? ` · ${p.packType}` : ''} · {fmtDate(p.packedAt)}
                </p>
              ))}
            </div>
          )}

          {shipments.map((s) => (
            <div key={s.id} style={{ marginTop: 'var(--fs-space-4)' }} data-testid={`evidence-shipment-${s.ref}`}>
              <h3 className="fs-h4">Logistics</h3>
              <div className="fs-md-card__fields">
                <div><div className="fs-md-card__field-label">Transport</div><div className="fs-md-card__field-value">{resolveStatus(s.mode).label}{s.carrierName ? ` · ${s.carrierName}` : ''}</div></div>
                {(s.parcelAwbRef ?? s.transportRef) && <div><div className="fs-md-card__field-label">Reference</div><div className="fs-md-card__field-value">{s.parcelAwbRef ?? s.transportRef}</div></div>}
                {s.pickupAt && <div><div className="fs-md-card__field-label">Picked up</div><div className="fs-md-card__field-value">{fmtDate(s.pickupAt)}</div></div>}
                <div><div className="fs-md-card__field-label">Status</div><div className="fs-md-card__field-value">{resolveStatus(s.status).label}</div></div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--fs-space-3)', flexWrap: 'wrap', marginTop: 'var(--fs-space-2)' }}>
                {s.media.map((m) => <Media key={m.id} m={m} />)}
              </div>
              {s.pods.length > 0 && (
                <div style={{ marginTop: 'var(--fs-space-3)' }} data-testid="evidence-pod">
                  <h4 className="fs-h4">Delivery / proof of delivery</h4>
                  {s.pods.map((p) => (
                    <p key={p.id} className="fs-body">
                      Delivered {p.deliveredQty}{p.receiverName ? ` · received by ${p.receiverName}` : ''} · {fmtDate(p.receivedAt)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div style={{ marginTop: 'var(--fs-space-4)' }} data-testid="evidence-receipt">
            <h3 className="fs-h4">Your receipt</h3>
            <div style={{ display: 'flex', gap: 'var(--fs-space-3)', flexWrap: 'wrap' }}>
              {pack.receipt.items.map((m) => <Media key={m.id} m={m} />)}
            </div>
            <label className="fs-btn fs-btn--ghost fs-btn--sm" style={{ marginTop: 'var(--fs-space-2)', display: 'inline-block' }}>
              Add receipt photo/video
              <input type="file" accept="image/*,video/*" capture="environment" data-testid="receipt-upload" hidden
                onChange={(e) => void addReceiptPhoto(e.target.files?.[0])} />
            </label>
          </div>
        </section>
      )}

      {claims.length > 0 && (
        <section className="fs-md-stack" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="order-claims">
          <p className="fs-overline">Issues on this order</p>
          {claims.map((c) => (
            <Link key={c.id} to={`/buyer/issues/${c.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <article className="fs-card fs-md-card" data-testid={`order-claim-${c.ref}`}>
                <div className="fs-task-card__top">
                  <span className="fs-md-card__primary">{c.ref} · {c.category.replace(/_/g, ' ').toLowerCase()}</span>
                  <StatusPill status={c.status} testId={`order-claim-status-${c.ref}`} />
                </div>
              </article>
            </Link>
          ))}
        </section>
      )}

      <p style={{ marginTop: 'var(--fs-space-5)' }}><Link to="/buyer/orders" data-testid="buyer-order-back">← All orders</Link></p>
    </div>
  );
}
