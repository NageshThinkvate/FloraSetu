import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  createRequirement, getRequirement, listProducts, listUnits, ProductSummary,
  submitRequirement, UnitOfMeasure
} from '../lib/api/demand';
import { uploadMedia } from '../lib/api/fulfilment';
import { useAuth } from '../lib/api/auth';
import { useWorkspace } from '../lib/workspace-context';
import { clearDraft, DirtyForms, loadDraft, saveDraft } from '../lib/drafts';
import { PageHeader } from '../components/PageHeader';
import { SearchableSelect } from '../components/SearchableSelect';
import { InlineAlert } from '../components/InlineAlert';
import { StickyMobileActionBar } from '../components/StickyMobileActionBar';

const BLOOM_STAGES: [string, string][] = [
  ['TIGHT_BUD', 'Tight bud'], ['BUD', 'Bud'], ['HALF_OPEN', 'Half open'], ['OPEN', 'Open'], ['FULL_BLOOM', 'Full bloom']
];
const SUBSTITUTIONS: [string, string][] = [
  ['exact', 'Exact flower only'], ['variety', 'Alternate variety OK'], ['colour', 'Alternate colour OK']
];

interface Draft {
  quantity: string; uomId: string; neededAt: string; destination: string;
  colour: string; stemMin: string; stemMax: string; bloomStage: string; notes: string;
}

// Get Flowers (Phase 3 §2): a simple request in ~60 seconds. UoM stays visible and
// user-confirmable (OD-07); RFQ mechanics are never exposed. Supports ?copy=<requirementId>
// for Buy Again (§11) — everything prefilled except a fresh required date.
export function GetFlowersPage(): JSX.Element {
  const [params] = useSearchParams();
  const copyId = params.get('copy');
  const { activeOrgId } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const draftOrg = activeOrgId ?? 'none';
  const draftWs = activeWorkspace ?? 'buyer';

  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('');
  const [uomId, setUomId] = useState('');
  const [neededAt, setNeededAt] = useState('');
  const [destination, setDestination] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [colour, setColour] = useState('');
  const [stemMin, setStemMin] = useState('');
  const [stemMax, setStemMax] = useState('');
  const [bloomStage, setBloomStage] = useState('');
  const [substitution, setSubstitution] = useState('exact');
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    listProducts().then((r) => setProducts(r.items)).catch(() => undefined);
    listUnits().then((r) => {
      setUnits(r.items);
      // OD-07: UoM may be PRESELECTED but stays visible + user-confirmable.
      const stem = r.items.find((u) => u.code === 'STEM');
      if (stem) {
        setUomId((cur) => cur || stem.id);
      }
    }).catch(() => undefined);
    const d = loadDraft<Draft>(draftOrg, draftWs, 'quick-request');
    if (d && !copyId) {
      setQuantity(d.quantity ?? ''); setUomId(d.uomId ?? ''); setNeededAt(d.neededAt ?? '');
      setDestination(d.destination ?? ''); setColour(d.colour ?? ''); setStemMin(d.stemMin ?? '');
      setStemMax(d.stemMax ?? ''); setBloomStage(d.bloomStage ?? ''); setNotes(d.notes ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // §11 Buy Again: reuse flower/spec/qty/UoM/address — required date stays fresh.
  useEffect(() => {
    if (!copyId) {
      return;
    }
    getRequirement(copyId).then((r) => {
      const line = r.lines[0];
      if (!line) {
        return;
      }
      setProductId(line.commodity_id);
      setQuantity(String(line.quantity));
      setUomId(line.uom_id);
      setDestination(line.delivery_destination);
      setNotes(line.notes ?? '');
      setCopied(true);
      setShowAdvanced(Boolean(line.notes));
    }).catch(() => setError('We could not load that earlier request.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyId]);

  const dirty = Boolean(productId || quantity || neededAt || destination || notes);
  useEffect(() => {
    if (dirty && !done) {
      DirtyForms.register('quick-request');
      saveDraft(draftOrg, draftWs, 'quick-request', { quantity, uomId, neededAt, destination, colour, stemMin, stemMax, bloomStage, notes });
    } else {
      DirtyForms.unregister('quick-request');
    }
  }, [dirty, done, quantity, uomId, neededAt, destination, colour, stemMin, stemMax, bloomStage, notes, draftOrg, draftWs]);

  const product = useMemo(() => products.find((p) => p.id === productId) ?? null, [products, productId]);
  const uom = units.find((u) => u.id === uomId);
  const valid = Boolean(product && Number(quantity) > 0 && uomId && neededAt && destination.trim());

  const onAttachment = async (file: File | undefined): Promise<void> => {
    if (!file) {
      return;
    }
    setError('');
    try {
      const stored = await uploadMedia(file);
      setAttachments((a) => [...a, stored.id]);
    } catch {
      setError('Attachment upload failed — try again.');
    }
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!valid || !product) {
      setError('Flower, quantity, unit, required date/time and delivery location are all required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const req = await createRequirement({
        mode: 'QUICK',
        title: `${product.name} — ${quantity} ${uom?.code ?? ''} for ${destination.trim()}`,
        lines: [{
          commodityId: product.id,
          quantity: Number(quantity),
          uomId,
          neededAt: new Date(neededAt).toISOString(),
          deliveryDestination: destination.trim(),
          colourCode: colour.trim() || undefined,
          stemLengthCmMin: stemMin ? Number(stemMin) : undefined,
          stemLengthCmMax: stemMax ? Number(stemMax) : undefined,
          bloomStage: bloomStage || undefined,
          substitutionPolicy: {
            exactProductOnly: substitution === 'exact',
            allowAlternateVariety: substitution === 'variety',
            allowAlternateColour: substitution === 'colour'
          },
          notes: notes.trim() || undefined,
          attachments: attachments.length ? attachments : undefined
        }]
      });
      await submitRequirement(req.id, crypto.randomUUID());
      clearDraft(draftOrg, draftWs, 'quick-request');
      DirtyForms.unregister('quick-request');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      setReviewing(false);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div data-testid="get-flowers-success">
        <PageHeader overline="Get flowers" title="Request sent" testId="get-flowers-success-header" />
        <div className="fs-card fs-md-card" style={{ textAlign: 'center', padding: 'var(--fs-space-10)' }}>
          <p className="fs-body-l" data-testid="get-flowers-success-copy">
            We&apos;re finding suitable suppliers. We&apos;ll notify you when offers arrive.
          </p>
          <div className="fs-md-stack" style={{ maxWidth: 320, margin: 'var(--fs-space-6) auto 0' }}>
            <Link to="/buyer/offers" className="fs-btn" data-testid="get-flowers-success-offers">View offers</Link>
            <Link to="/buyer/home" className="fs-btn fs-btn--ghost" data-testid="get-flowers-success-home">Back to home</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="get-flowers-page">
      <PageHeader
        overline="Get flowers"
        title={copied ? 'Repeat your request' : 'What do you need?'}
        testId="get-flowers-header"
      />
      {copied && (
        <InlineAlert variant="info" testId="get-flowers-copied">
          We copied your earlier request — set a fresh required date and adjust anything before sending.
        </InlineAlert>
      )}
      {error && <InlineAlert variant="error" testId="get-flowers-error">{error}</InlineAlert>}

      <form onSubmit={submit} data-testid="get-flowers-form">
        <SearchableSelect
          label="Flower"
          options={products.map((p) => ({ value: p.id, label: p.name, hint: p.commercial_name ?? p.ref }))}
          value={productId}
          onChange={setProductId}
          placeholder="Search flowers (e.g. rose, carnation)"
          testId="get-flowers-flower"
        />
        <div className="fs-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--fs-space-4)' }}>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="gf-qty">Quantity</label>
            <input id="gf-qty" className="fs-input fs-num" data-testid="get-flowers-qty" type="number" min="0.01" step="any"
              value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 500" />
          </div>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="gf-uom">Unit</label>
            <select id="gf-uom" className="fs-select" data-testid="get-flowers-uom" value={uomId}
              onChange={(e) => setUomId(e.target.value)}>
              <option value="">Select unit…</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
            </select>
          </div>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="gf-needed">Required date &amp; time</label>
            <input id="gf-needed" className="fs-input" data-testid="get-flowers-needed" type="datetime-local"
              value={neededAt} onChange={(e) => setNeededAt(e.target.value)} />
          </div>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="gf-dest">Delivery location</label>
            <input id="gf-dest" className="fs-input" data-testid="get-flowers-destination" value={destination}
              onChange={(e) => setDestination(e.target.value)} placeholder="City / venue / address" />
          </div>
        </div>

        <button type="button" className="fs-btn fs-btn--ghost fs-btn--sm" style={{ marginTop: 'var(--fs-space-4)' }}
          data-testid="get-flowers-advanced-toggle" aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? 'Hide specifications' : 'More specifications'}
        </button>
        {showAdvanced && (
          <div className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-3)' }} data-testid="get-flowers-advanced">
            <div className="fs-form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--fs-space-4)' }}>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="gf-colour">Colour</label>
                <input id="gf-colour" className="fs-input" data-testid="get-flowers-colour" value={colour}
                  onChange={(e) => setColour(e.target.value)} placeholder="e.g. deep red" />
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="gf-stem-min">Stem length (cm, min)</label>
                <input id="gf-stem-min" className="fs-input fs-num" data-testid="get-flowers-stem-min" type="number" min="0"
                  value={stemMin} onChange={(e) => setStemMin(e.target.value)} />
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="gf-stem-max">Stem length (cm, max)</label>
                <input id="gf-stem-max" className="fs-input fs-num" data-testid="get-flowers-stem-max" type="number" min="0"
                  value={stemMax} onChange={(e) => setStemMax(e.target.value)} />
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="gf-bloom">Bloom stage</label>
                <select id="gf-bloom" className="fs-select" data-testid="get-flowers-bloom" value={bloomStage}
                  onChange={(e) => setBloomStage(e.target.value)}>
                  <option value="">Any stage…</option>
                  {BLOOM_STAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="gf-subs">Substitution preference</label>
                <select id="gf-subs" className="fs-select" data-testid="get-flowers-substitution" value={substitution}
                  onChange={(e) => setSubstitution(e.target.value)}>
                  {SUBSTITUTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="gf-notes">Notes</label>
                <input id="gf-notes" className="fs-input" data-testid="get-flowers-notes" value={notes}
                  onChange={(e) => setNotes(e.target.value)} placeholder="Variety, grade/spec, pack — anything specific" />
              </div>
            </div>
            <div className="fs-field" style={{ marginTop: 'var(--fs-space-3)' }}>
              <label className="fs-field__label" htmlFor="gf-attach">Attachments ({attachments.length})</label>
              <input id="gf-attach" className="fs-input" data-testid="get-flowers-attachments" type="file"
                onChange={(e) => void onAttachment(e.target.files?.[0])} />
            </div>
          </div>
        )}

        {reviewing && product && (
          <div className="fs-card fs-md-card" style={{ marginTop: 'var(--fs-space-4)' }} data-testid="get-flowers-review">
            <p className="fs-overline">Review your request</p>
            <div className="fs-md-card__fields">
              <div><div className="fs-md-card__field-label">Flower</div><div className="fs-md-card__field-value">{product.name}</div></div>
              <div><div className="fs-md-card__field-label">Quantity</div><div className="fs-md-card__field-value">{quantity} {uom?.code ?? ''}</div></div>
              <div><div className="fs-md-card__field-label">Required by</div><div className="fs-md-card__field-value">{neededAt ? new Date(neededAt).toLocaleString('en-IN') : '—'}</div></div>
              <div><div className="fs-md-card__field-label">Delivery to</div><div className="fs-md-card__field-value">{destination}</div></div>
            </div>
          </div>
        )}

        <StickyMobileActionBar>
          {!reviewing ? (
            <button type="button" className="fs-btn" style={{ width: '100%' }} disabled={!valid}
              data-testid="get-flowers-review-btn" onClick={() => setReviewing(true)}>
              Review request
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--fs-space-3)', width: '100%' }}>
              <button type="button" className="fs-btn fs-btn--ghost" data-testid="get-flowers-edit-btn"
                onClick={() => setReviewing(false)}>Edit</button>
              <button type="submit" className="fs-btn" style={{ flex: 1 }} disabled={busy} data-testid="get-flowers-submit">
                {busy ? 'Sending…' : 'Get offers'}
              </button>
            </div>
          )}
        </StickyMobileActionBar>
      </form>
    </div>
  );
}
