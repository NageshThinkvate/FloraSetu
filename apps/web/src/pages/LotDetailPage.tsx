import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  addLotMedia, CustodyRow, custodyForLot, fmtDate, getLot, getLotMedia, LotDetail,
  LotMediaRow, mediaUrl, recordCustody, resolveLotHold, submitLotDeclaration, uploadMedia
} from '../lib/api/fulfilment';
import { listProducts, ProductSummary } from '../lib/api/demand';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';

// Lot detail (Phase 4 §5): photos, video, supplier declaration, balances, linked orders,
// packing/custody and evidence completeness. Declaration ≠ FloraSetu QC (ADR-011) —
// the word "QC approved" never appears.
const MIN_PHOTOS = 2;

export function LotDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const [lot, setLot] = useState<LotDetail | null>(null);
  const [media, setMedia] = useState<LotMediaRow[]>([]);
  const [custody, setCustody] = useState<CustodyRow[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLot(await getLot(id));
    const m = await getLotMedia(id);
    setMedia(m.items);
    setCustody((await custodyForLot(id).catch(() => ({ items: [] }))).items);
  }, [id]);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Lot unavailable'));
    listProducts().then((r) => setProducts(r.items)).catch(() => undefined);
  }, [load]);

  const upload = async (e: ChangeEvent<HTMLInputElement>, purpose: 'LOT_ACTUAL' | 'LOT_VIDEO'): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file || !id) {
      return;
    }
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const stored = await uploadMedia(file);
      await addLotMedia(id, { mediaObjectId: stored.id, purpose });
      setNotice(purpose === 'LOT_VIDEO' ? 'Video attached to lot.' : 'Photo of the actual lot attached.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  // ADR-011: supplier declaration + actual-lot evidence replaces any FloraSetu inspection.
  const declare = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) {
      return;
    }
    setError('');
    setNotice('');
    const fd = new FormData(e.target as HTMLFormElement);
    try {
      await submitLotDeclaration(id, {
        declaredStemLengthCm: fd.get('stemLength') ? Number(fd.get('stemLength')) : undefined,
        bloomStage: String(fd.get('bloomStage') ?? '') || undefined,
        batchRef: String(fd.get('batchRef') ?? '') || undefined,
        notes: String(fd.get('notes') ?? '') || undefined
      });
      setNotice('Lot declared and listed as available.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Declaration failed');
    }
  };

  const resolveHold = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) {
      return;
    }
    const fd = new FormData(e.target as HTMLFormElement);
    setError('');
    setNotice('');
    try {
      await resolveLotHold(id, {
        toAvailableQty: Number(fd.get('toAvailableQty')),
        toRejectedQty: Number(fd.get('toRejectedQty') ?? 0),
        reason: String(fd.get('reason'))
      });
      setNotice('Hold resolved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resolve failed');
    }
  };

  const record = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!id) {
      return;
    }
    const fd = new FormData(e.target as HTMLFormElement);
    setError('');
    setNotice('');
    try {
      await recordCustody({
        lotId: id,
        eventType: String(fd.get('action')),
        toOrgId: String(fd.get('toOrgId') ?? '') || undefined,
        conditionNote: String(fd.get('note') ?? '') || undefined
      });
      setNotice('Custody event recorded.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Custody failed');
    }
  };

  if (!lot) {
    return error
      ? <InlineAlert variant="error" testId="lot-error">{error}</InlineAlert>
      : <SkeletonLoader variant="card" count={3} testId="lot-loading" />;
  }

  const product = products.find((p) => p.id === lot.commodity_id);
  const photos = media.filter((m) => ['LOT_ACTUAL', 'LOT_PHOTO'].includes(m.purpose));
  const videos = media.filter((m) => m.purpose === 'LOT_VIDEO');
  const declared = Boolean(lot.declared_at);
  const completeness = [
    { label: `${photos.length} of ${MIN_PHOTOS} required photos`, ok: photos.length >= MIN_PHOTOS },
    { label: 'Declaration submitted', ok: declared },
    { label: 'Short video (optional)', ok: videos.length > 0 }
  ];

  return (
    <div data-testid="lot-page">
      <PageHeader overline="Supply lot" title={lot.ref} testId="lot-header" />
      <div className="fs-task-card__top">
        <StatusPill status={lot.status} testId="lot-status" />
        <span className="fs-caption fs-text-secondary" data-testid="lot-quality-basis">
          {lot.quality_basis === 'SUPPLIER_DECLARATION' ? 'Supplier-declared quality' : 'Independent inspection'}
        </span>
      </div>
      {error && <InlineAlert variant="error" testId="lot-error-inline">{error}</InlineAlert>}
      {notice && <InlineAlert variant="success" testId="lot-notice">{notice}</InlineAlert>}

      <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="lot-evidence-completeness">
        <p className="fs-overline">Evidence completeness</p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--fs-space-2)' }}>
          {completeness.map((c) => (
            <li key={c.label} className="fs-body" data-testid={`lot-completeness-${c.ok ? 'ok' : 'todo'}`}>
              <span aria-hidden style={{ color: c.ok ? 'var(--fs-color-success, #1d7a4f)' : 'var(--fs-color-warning, #b45309)', marginRight: 8 }}>
                {c.ok ? '✓' : '○'}
              </span>
              {c.label}
            </li>
          ))}
        </ul>
      </section>

      <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="lot-media-panel">
        <p className="fs-overline">Photos &amp; video of the actual lot</p>
        <div style={{ display: 'flex', gap: 'var(--fs-space-3)', flexWrap: 'wrap' }} data-testid="lot-media-list">
          {media.map((m) => (
            <a key={m.id} href={m.url ?? mediaUrl(m.media_object_id)} target="_blank" rel="noreferrer" data-testid={`lot-media-${m.id.slice(0, 8)}`}>
              {m.purpose === 'LOT_VIDEO' ? (
                <span className="fs-btn fs-btn--ghost fs-btn--sm">▶ video · {fmtDate(m.captured_at)}</span>
              ) : (
                <img src={m.url ?? mediaUrl(m.media_object_id)} alt={`Lot evidence ${m.purpose.toLowerCase().replace(/_/g, ' ')}`}
                  loading="lazy" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8 }} />
              )}
            </a>
          ))}
        </div>
        <div style={{ display: 'grid', gap: 'var(--fs-space-2)', marginTop: 'var(--fs-space-3)' }}>
          <label className="fs-btn fs-btn--ghost fs-btn--sm" style={{ textAlign: 'center' }}>
            Add photo of actual lot
            <input type="file" accept="image/*" capture="environment" data-testid="lot-media-input" hidden
              disabled={busy} onChange={(e) => void upload(e, 'LOT_ACTUAL')} />
          </label>
          <label className="fs-btn fs-btn--ghost fs-btn--sm" style={{ textAlign: 'center' }}>
            Add video
            <input type="file" accept="video/*" data-testid="lot-video-input" hidden
              disabled={busy} onChange={(e) => void upload(e, 'LOT_VIDEO')} />
          </label>
        </div>
      </section>

      {lot.declared_at ? (
        <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="lot-declaration-panel">
          <p className="fs-overline">Your declaration</p>
          <p className="fs-body" data-testid="lot-declaration-summary">
            {lot.batch_ref ? `Batch ${lot.batch_ref} · ` : ''}
            {lot.bloom_stage ? `Bloom ${lot.bloom_stage.toLowerCase().replace(/_/g, ' ')} · ` : ''}
            {lot.declared_stem_length_cm ? `Stem ${lot.declared_stem_length_cm} cm · ` : ''}
            declared {fmtDate(lot.declared_at)}
          </p>
          {lot.declaration_notes && <p className="fs-caption fs-text-secondary">{lot.declaration_notes}</p>}
        </section>
      ) : (
        ['STOCK_RECEIVED', 'HARVESTED'].includes(lot.status) && lot.quality_basis === 'SUPPLIER_DECLARATION' && (
          <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="lot-declare-panel">
            <p className="fs-overline">Declare this lot</p>
            <p className="fs-caption fs-text-secondary" data-testid="lot-evidence-count">
              Actual-lot photos attached: {photos.length} (minimum {MIN_PHOTOS} required).
              Buyers see your photos and this declaration — FloraSetu does not inspect lots.
            </p>
            <form onSubmit={declare} data-testid="lot-declare-form"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--fs-space-3)' }}>
              <input name="stemLength" className="fs-input fs-num" data-testid="lot-declare-stem" type="number" min="0" step="any" placeholder="Stem length (cm)" />
              <select name="bloomStage" className="fs-select" data-testid="lot-declare-bloom" defaultValue="">
                <option value="">Bloom stage…</option>
                <option value="TIGHT_BUD">Tight bud</option>
                <option value="BUD">Bud</option>
                <option value="HALF_OPEN">Half open</option>
                <option value="OPEN">Open</option>
                <option value="FULL_BLOOM">Full bloom</option>
              </select>
              <input name="batchRef" className="fs-input" data-testid="lot-declare-batch" placeholder="Batch reference (optional)" />
              <input name="notes" className="fs-input" data-testid="lot-declare-notes" placeholder="Notes (optional)" />
              <button type="submit" className="fs-btn" data-testid="lot-declare-btn">Declare &amp; list as available</button>
            </form>
          </section>
        )
      )}

      <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="lot-balances">
        <p className="fs-overline">Quantity balances</p>
        <div className="fs-md-card__fields">
          <div><div className="fs-md-card__field-label">Declared</div><div className="fs-md-card__field-value">{lot.declared_qty}</div></div>
          <div><div className="fs-md-card__field-label">Available</div><div className="fs-md-card__field-value">{lot.available_qty}</div></div>
          <div><div className="fs-md-card__field-label">Reserved</div><div className="fs-md-card__field-value">{lot.reserved_qty}</div></div>
          <div><div className="fs-md-card__field-label">Packed</div><div className="fs-md-card__field-value">{lot.packed_qty}</div></div>
          <div><div className="fs-md-card__field-label">Dispatched</div><div className="fs-md-card__field-value">{lot.dispatched_qty}</div></div>
          <div><div className="fs-md-card__field-label">Delivered</div><div className="fs-md-card__field-value">{lot.delivered_qty}</div></div>
        </div>
        <p className="fs-caption fs-text-secondary" style={{ marginBottom: 0 }}>
          {product?.name ?? 'Flower'}
          {lot.harvest_at ? ` · harvested ${fmtDate(lot.harvest_at)}` : ''}
          {lot.received_at ? ` · received ${fmtDate(lot.received_at)}` : ''}
        </p>
      </section>

      <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="lot-orders">
        <p className="fs-overline">Orders linked</p>
        {lot.reservations.length === 0 && <p className="fs-caption fs-text-secondary">Not linked to any order yet.</p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--fs-space-2)' }}>
          {lot.reservations.map((r) => (
            <li key={r.id} data-testid={`lot-order-${r.id.slice(0, 8)}`}>
              <Link to={`/supplier/orders/${r.order_id}`} className="fs-body" data-testid={`lot-order-link-${r.id.slice(0, 8)}`}>
                Order · {r.qty} allocated
              </Link>{' '}
              <StatusPill status={r.status} testId={`lot-order-status-${r.id.slice(0, 8)}`} />
            </li>
          ))}
        </ul>
      </section>

      <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="lot-custody-panel">
        <p className="fs-overline">Custody timeline</p>
        <ol style={{ margin: '0 0 var(--fs-space-3)', paddingLeft: 'var(--fs-space-5)', display: 'grid', gap: 4 }}>
          {custody.map((c) => (
            <li key={c.id} className="fs-caption" data-testid={`custody-${c.id.slice(0, 8)}`}>
              {fmtDate(c.occurred_at)} — {c.event_type}{c.condition_note ? ` · ${c.condition_note}` : ''}
            </li>
          ))}
        </ol>
        <form onSubmit={record} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--fs-space-2)' }}>
          <input name="action" className="fs-input" placeholder="Event (e.g. PACKED, HANDED_OVER)" data-testid="custody-action" required />
          <input name="note" className="fs-input" placeholder="Condition note (optional)" data-testid="custody-note" />
          <button type="submit" className="fs-btn fs-btn--sm" data-testid="custody-submit">Record custody</button>
        </form>
      </section>

      {lot.status === 'HOLD' && (
        <section className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="lot-hold-panel">
          <p className="fs-overline">Resolve hold</p>
          <form onSubmit={resolveHold} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--fs-space-2)' }}>
            <input name="toAvailableQty" className="fs-input fs-num" type="number" min="0" step="any" placeholder="Back to available qty" data-testid="hold-available" required />
            <input name="toRejectedQty" className="fs-input fs-num" type="number" min="0" step="any" placeholder="Rejected qty" data-testid="hold-rejected" defaultValue="0" required />
            <input name="reason" className="fs-input" style={{ flex: 1 }} placeholder="Resolution reason" data-testid="hold-reason" required />
            <button type="submit" className="fs-btn fs-btn--sm" data-testid="hold-resolve">Resolve</button>
          </form>
        </section>
      )}

      <p style={{ marginTop: 'var(--fs-space-5)' }}><Link to="/supplier/supply" data-testid="lot-back">← All supply</Link></p>
    </div>
  );
}
