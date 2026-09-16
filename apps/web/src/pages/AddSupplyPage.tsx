import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listProducts, ProductSummary, listUnits, UnitOfMeasure } from '../lib/api/demand';
import {
  addLotMedia, createHarvestLot, createStockLot, submitLotDeclaration, uploadMedia
} from '../lib/api/fulfilment';
import { PageHeader } from '../components/PageHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import { InlineAlert } from '../components/InlineAlert';
import { StickyMobileActionBar } from '../components/StickyMobileActionBar';

// Add Supply (Phase 4): camera-first lot intake. Photos come FIRST, then flower, quantity,
// batch reference, supplier-declared specification, harvest/received time, optional video,
// review, submit. Minimum evidence: 2 actual current lot photos (server-enforced,
// admin-configurable via LOT_EVIDENCE_MIN_PHOTOS). This is supplier declaration — not
// FloraSetu QC (ADR-011).
const STEPS = ['Photos', 'Flower', 'Quantity', 'Batch & spec', 'Timing', 'Video', 'Review'] as const;
const BLOOM_STAGES: [string, string][] = [
  ['TIGHT_BUD', 'Tight bud'], ['BUD', 'Bud'], ['HALF_OPEN', 'Half open'], ['OPEN', 'Open'], ['FULL_BLOOM', 'Full bloom']
];
const MIN_PHOTOS = 2;

export function AddSupplyPage(): JSX.Element {
  const [step, setStep] = useState(0);
  const [photos, setPhotos] = useState<{ id: string; preview: string }[]>([]);
  const [video, setVideo] = useState<{ id: string; preview: string } | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [uomId, setUomId] = useState('');
  const [batchRef, setBatchRef] = useState('');
  const [stemLength, setStemLength] = useState('');
  const [bloomStage, setBloomStage] = useState('');
  const [colour, setColour] = useState('');
  const [flow, setFlow] = useState<'harvest' | 'stock'>('harvest');
  const [when, setWhen] = useState('');
  const [originDetail, setOriginDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [doneLot, setDoneLot] = useState<string | null>(null);

  useEffect(() => {
    listProducts().then((r) => setProducts(r.items)).catch(() => undefined);
    listUnits().then((r) => {
      setUnits(r.items);
      const stem = r.items.find((u) => u.code === 'STEM');
      if (stem) {
        setUomId((cur) => cur || stem.id);
      }
    }).catch(() => undefined);
  }, []);

  const product = useMemo(() => products.find((p) => p.id === productId) ?? null, [products, productId]);
  const uom = units.find((u) => u.id === uomId);

  const addPhotos = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) {
      return;
    }
    setUploading(true);
    setError('');
    try {
      for (const file of Array.from(files)) {
        const stored = await uploadMedia(file);
        setPhotos((p) => [...p, { id: stored.id, preview: URL.createObjectURL(file) }]);
      }
    } catch {
      setError('Photo upload failed — try again.');
    } finally {
      setUploading(false);
    }
  };

  const addVideo = async (file: File | undefined): Promise<void> => {
    if (!file) {
      return;
    }
    setUploading(true);
    setError('');
    try {
      const stored = await uploadMedia(file);
      setVideo({ id: stored.id, preview: URL.createObjectURL(file) });
    } catch {
      setError('Video upload failed — try again.');
    } finally {
      setUploading(false);
    }
  };

  const canNext = [
    photos.length >= MIN_PHOTOS,
    productId !== null,
    Number(qty) > 0 && uomId !== '',
    true,
    when !== '',
    true,
    true
  ][step];

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const body = {
        commodityId: productId,
        declaredQty: Number(qty),
        uomId,
        // Backend ORIGIN_TYPES enum (supply-inventory dto) — keep in sync.
        originType: flow === 'harvest' ? 'OWN_FARM' : 'MARKET_PURCHASE',
        originDetail: originDetail || undefined,
        colourCode: colour || undefined
      };
      const res = flow === 'harvest'
        ? await createHarvestLot({ ...body, harvestedAt: new Date(when).toISOString() })
        : await createStockLot({ ...body, receivedAt: new Date(when).toISOString() });
      const lotId = (res as { id: string }).id;
      for (const p of photos) {
        await addLotMedia(lotId, { mediaObjectId: p.id, purpose: 'LOT_ACTUAL' });
      }
      if (video) {
        await addLotMedia(lotId, { mediaObjectId: video.id, purpose: 'LOT_VIDEO' });
      }
      await submitLotDeclaration(lotId, {
        declaredStemLengthCm: stemLength ? Number(stemLength) : undefined,
        bloomStage: bloomStage || undefined,
        batchRef: batchRef || undefined
      });
      setDoneLot(lotId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the lot');
    } finally {
      setBusy(false);
    }
  };

  if (doneLot) {
    return (
      <div data-testid="supply-success">
        <PageHeader overline="Add supply" title="Evidence submitted" testId="supply-success-header" />
        <div className="fs-card fs-md-card" style={{ textAlign: 'center', padding: 'var(--fs-space-10)' }}>
          <p className="fs-body-l">Your lot is declared and listed as available. Buyers see your photos and declaration.</p>
          <div className="fs-md-stack" style={{ maxWidth: 320, margin: 'var(--fs-space-6) auto 0' }}>
            <Link to={`/supplier/supply/${doneLot}`} className="fs-btn" data-testid="supply-success-open">Open lot</Link>
            <Link to="/supplier/supply" className="fs-btn fs-btn--ghost" data-testid="supply-success-list">All supply</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="supply-wizard">
      <PageHeader overline="Add supply" title={STEPS[step]} testId="supply-wizard-header" />
      <p className="fs-caption fs-text-secondary" style={{ marginTop: 'calc(-1 * var(--fs-space-3))' }}>Step {step + 1} of {STEPS.length}</p>
      <div className="fs-caption fs-text-secondary" style={{ marginBottom: 'var(--fs-space-4)' }} data-testid="supply-wizard-progress">
        {STEPS.map((s, i) => (
          <span key={s} style={{ fontWeight: i === step ? 700 : 400, color: i <= step ? 'inherit' : undefined }}>
            {i > 0 ? ' → ' : ''}{s}
          </span>
        ))}
      </div>
      {error && <InlineAlert variant="error" testId="supply-wizard-error">{error}</InlineAlert>}

      {step === 0 && (
        <section className="fs-card fs-md-card" data-testid="supply-step-photos">
          <p className="fs-body-l" style={{ marginTop: 0 }}>Take {MIN_PHOTOS}+ current photos of the actual flowers</p>
          <p className="fs-caption fs-text-secondary">
            Buyers see these exact photos with your declaration. FloraSetu does not inspect lots — your photos are the evidence.
          </p>
          <label className="fs-btn" style={{ display: 'block', textAlign: 'center' }}>
            {uploading ? 'Uploading…' : 'Take / add photos'}
            <input type="file" accept="image/*" capture="environment" multiple hidden
              data-testid="supply-photo-input" disabled={uploading}
              onChange={(e) => void addPhotos(e.target.files)} />
          </label>
          <p className="fs-caption" data-testid="supply-photo-count" style={{ marginTop: 'var(--fs-space-3)' }}>
            {photos.length} of {MIN_PHOTOS} required photos added
          </p>
          <div style={{ display: 'flex', gap: 'var(--fs-space-2)', flexWrap: 'wrap' }}>
            {photos.map((p) => (
              <img key={p.id} src={p.preview} alt="Lot" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8 }} />
            ))}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="fs-card fs-md-card" data-testid="supply-step-flower">
          <SearchableSelect
            label="Flower"
            options={products.map((p) => ({ value: p.id, label: p.name, hint: p.commercial_name ?? p.ref }))}
            value={productId}
            onChange={setProductId}
            placeholder="Search flowers (e.g. rose)"
            testId="supply-flower"
          />
        </section>
      )}

      {step === 2 && (
        <section className="fs-card fs-md-card" data-testid="supply-step-quantity">
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="supply-qty">Quantity</label>
            <input id="supply-qty" className="fs-input fs-num" data-testid="supply-qty" type="number" min="0.01" step="any"
              value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 500" />
          </div>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="supply-uom">Unit</label>
            <select id="supply-uom" className="fs-select" data-testid="supply-uom" value={uomId}
              onChange={(e) => setUomId(e.target.value)}>
              <option value="">Select unit…</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
            </select>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="fs-card fs-md-card" data-testid="supply-step-batch">
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="supply-batch">Lot / batch reference</label>
            <input id="supply-batch" className="fs-input" data-testid="supply-batch" value={batchRef}
              onChange={(e) => setBatchRef(e.target.value)} placeholder="Your own reference, e.g. FIELD-3-CUT-2" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--fs-space-3)' }}>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="supply-stem">Declared stem length (cm)</label>
              <input id="supply-stem" className="fs-input fs-num" data-testid="supply-stem" type="number" min="0" step="any"
                value={stemLength} onChange={(e) => setStemLength(e.target.value)} />
            </div>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="supply-bloom">Bloom stage</label>
              <select id="supply-bloom" className="fs-select" data-testid="supply-bloom" value={bloomStage}
                onChange={(e) => setBloomStage(e.target.value)}>
                <option value="">Select…</option>
                {BLOOM_STAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="fs-field">
              <label className="fs-field__label" htmlFor="supply-colour">Colour</label>
              <input id="supply-colour" className="fs-input" data-testid="supply-colour" value={colour}
                onChange={(e) => setColour(e.target.value)} placeholder="e.g. deep red" />
            </div>
          </div>
          <p className="fs-caption fs-text-secondary">You declare this specification. Buyers rely on it plus your photos.</p>
        </section>
      )}

      {step === 4 && (
        <section className="fs-card fs-md-card" data-testid="supply-step-timing">
          <div className="fs-field">
            <span className="fs-field__label">This lot is</span>
            <div style={{ display: 'flex', gap: 'var(--fs-space-2)' }} role="radiogroup" aria-label="Lot source">
              <button type="button" className={`fs-btn fs-btn--sm ${flow === 'harvest' ? '' : 'fs-btn--ghost'}`}
                data-testid="supply-flow-harvest" aria-pressed={flow === 'harvest'} onClick={() => setFlow('harvest')}>Fresh harvest</button>
              <button type="button" className={`fs-btn fs-btn--sm ${flow === 'stock' ? '' : 'fs-btn--ghost'}`}
                data-testid="supply-flow-stock" aria-pressed={flow === 'stock'} onClick={() => setFlow('stock')}>Stock received</button>
            </div>
          </div>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="supply-when">{flow === 'harvest' ? 'Harvested at' : 'Received at'}</label>
            <input id="supply-when" className="fs-input" data-testid="supply-when" type="datetime-local" value={when}
              onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="supply-origin">Origin detail (optional)</label>
            <input id="supply-origin" className="fs-input" data-testid="supply-origin" value={originDetail}
              onChange={(e) => setOriginDetail(e.target.value)} placeholder="Farm / market / location" />
          </div>
        </section>
      )}

      {step === 5 && (
        <section className="fs-card fs-md-card" data-testid="supply-step-video">
          <p className="fs-body-l" style={{ marginTop: 0 }}>Optional short video</p>
          <p className="fs-caption fs-text-secondary">A 10–30 second walk-around video builds buyer confidence. Optional.</p>
          <label className="fs-btn fs-btn--ghost" style={{ display: 'block', textAlign: 'center' }}>
            {uploading ? 'Uploading…' : video ? 'Replace video' : 'Add video'}
            <input type="file" accept="video/*" hidden data-testid="supply-video-input" disabled={uploading}
              onChange={(e) => void addVideo(e.target.files?.[0])} />
          </label>
          {video && <video src={video.preview} controls preload="none" style={{ maxWidth: 240, marginTop: 'var(--fs-space-3)', borderRadius: 8 }} data-testid="supply-video-preview" />}
        </section>
      )}

      {step === 6 && (
        <section className="fs-card fs-md-card" data-testid="supply-step-review">
          <p className="fs-overline">Review &amp; submit</p>
          <div className="fs-md-card__fields">
            <div><div className="fs-md-card__field-label">Photos</div><div className="fs-md-card__field-value">{photos.length}{video ? ' + video' : ''}</div></div>
            <div><div className="fs-md-card__field-label">Flower</div><div className="fs-md-card__field-value">{product?.name ?? '—'}</div></div>
            <div><div className="fs-md-card__field-label">Quantity</div><div className="fs-md-card__field-value">{qty} {uom?.code ?? ''}</div></div>
            <div><div className="fs-md-card__field-label">Batch</div><div className="fs-md-card__field-value">{batchRef || '—'}</div></div>
            <div><div className="fs-md-card__field-label">Declared spec</div>
              <div className="fs-md-card__field-value">
                {[stemLength ? `${stemLength} cm` : '', bloomStage ? bloomStage.toLowerCase().replace(/_/g, ' ') : '', colour]
                  .filter(Boolean).join(' · ') || '—'}
              </div></div>
            <div><div className="fs-md-card__field-label">{flow === 'harvest' ? 'Harvested' : 'Received'}</div>
              <div className="fs-md-card__field-value">{when ? new Date(when).toLocaleString('en-IN') : '—'}</div></div>
          </div>
          <p className="fs-caption fs-text-secondary" style={{ marginTop: 'var(--fs-space-3)' }}>
            Submitting lists this lot as available with your declaration and evidence. Buyers will see exactly this.
          </p>
        </section>
      )}

      <StickyMobileActionBar>
        <div style={{ display: 'flex', gap: 'var(--fs-space-3)', width: '100%' }}>
          {step > 0 && (
            <button type="button" className="fs-btn fs-btn--ghost" data-testid="supply-back"
              onClick={() => setStep((s) => s - 1)}>Back</button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className="fs-btn" style={{ flex: 1 }} disabled={!canNext || uploading}
              data-testid="supply-next" onClick={() => setStep((s) => s + 1)}>
              {step === 0 && photos.length < MIN_PHOTOS ? `Add ${MIN_PHOTOS - photos.length} more photo${MIN_PHOTOS - photos.length === 1 ? '' : 's'}` : 'Next'}
            </button>
          ) : (
            <button type="button" className="fs-btn" style={{ flex: 1 }} disabled={busy}
              data-testid="supply-submit" onClick={() => void submit()}>
              {busy ? 'Submitting…' : 'Submit evidence'}
            </button>
          )}
        </div>
      </StickyMobileActionBar>
      <div className="fs-desktop-only" style={{ gap: 'var(--fs-space-3)', marginTop: 'var(--fs-space-5)' }}>
        {step > 0 && <button type="button" className="fs-btn fs-btn--ghost" data-testid="supply-back-desktop" onClick={() => setStep((s) => s - 1)}>Back</button>}
        {step < STEPS.length - 1 ? (
          <button type="button" className="fs-btn" disabled={!canNext || uploading} data-testid="supply-next-desktop" onClick={() => setStep((s) => s + 1)}>Next</button>
        ) : (
          <button type="button" className="fs-btn" disabled={busy} data-testid="supply-submit-desktop" onClick={() => void submit()}>
            {busy ? 'Submitting…' : 'Submit evidence'}
          </button>
        )}
      </div>
      <p style={{ marginTop: 'var(--fs-space-5)' }}><Link to="/supplier/supply" data-testid="supply-cancel">← Cancel</Link></p>
    </div>
  );
}
