import { FormEvent, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../lib/api/client';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';

interface Capability {
  id: string;
  variety_id: string;
  variety: string;
  commodity: string;
  status: string;
  notes: string | null;
}
interface ProductSummary { id: string; name: string; commercial_name: string | null }
interface ProductDetail { varieties: { id: string; name: string; colour: string | null }[] }

// Supplier product capabilities (Phase 8: design-system rebuild — the raw variety-UUID
// input is replaced by product → variety pickers; functionality unchanged).
export function CapabilitiesPage(): JSX.Element {
  const [items, setItems] = useState<Capability[] | null>(null);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [varieties, setVarieties] = useState<ProductDetail['varieties']>([]);
  const [productId, setProductId] = useState('');
  const [varietyId, setVarietyId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    setItems((await apiGet<{ items: Capability[] }>('/catalog/capabilities')).items);
  };
  useEffect(() => {
    void load().catch(() => setError("We couldn't load your capabilities."));
    apiGet<{ items: ProductSummary[] }>('/catalog/products')
      .then((r) => setProducts(r.items))
      .catch(() => setProducts([]));
  }, []);

  useEffect(() => {
    setVarietyId('');
    setVarieties([]);
    if (!productId) {
      return;
    }
    apiGet<ProductDetail>(`/catalog/products/${productId}`)
      .then((d) => setVarieties(d.varieties))
      .catch(() => setVarieties([]));
  }, [productId]);

  const add = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      await apiPost('/catalog/capabilities', { varietyId, notes: notes || undefined });
      setProductId(''); setVarietyId(''); setNotes('');
      setNotice('Capability added.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the capability.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="capabilities-page">
      <PageHeader overline="Your supply" title="Products we handle" testId="capabilities-header" />
      {error && <InlineAlert variant="error" testId="capability-error">{error}</InlineAlert>}
      {notice && <InlineAlert variant="success" testId="capability-notice">{notice}</InlineAlert>}
      {items === null && !error && <SkeletonLoader variant="card" count={3} testId="capabilities-loading" />}
      {items !== null && items.length === 0 && (
        <EmptyState
          title="No capabilities recorded yet"
          hint="Tell buyers which flowers you can supply by adding your first product below."
          testId="capabilities-empty"
        />
      )}
      <div className="fs-md-stack" data-testid="capabilities-list">
        {(items ?? []).map((c) => (
          <div key={c.id} className="fs-card fs-md-card" data-testid={`capability-${c.id}`}>
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{c.commodity} — {c.variety}</span>
              <StatusPill status={c.status} />
            </div>
            {c.notes && <p className="fs-body" style={{ margin: 0 }}>{c.notes}</p>}
          </div>
        ))}
      </div>
      <div className="fs-card fs-md-card">
        <div className="fs-md-card__field-label">Add a product you handle</div>
        <form className="fs-md-stack" onSubmit={(e) => void add(e)} data-testid="capability-form">
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="capability-product">Product</label>
            <select
              id="capability-product"
              className="fs-input"
              data-testid="capability-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              required
            >
              <option value="">Choose product…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.commercial_name ? ` (${p.commercial_name})` : ''}</option>)}
            </select>
          </div>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="capability-variety">Variety</label>
            <select
              id="capability-variety"
              className="fs-input"
              data-testid="capability-variety"
              value={varietyId}
              onChange={(e) => setVarietyId(e.target.value)}
              required
              disabled={!productId}
            >
              <option value="">{productId ? 'Choose variety…' : 'Choose a product first'}</option>
              {varieties.map((v) => <option key={v.id} value={v.id}>{v.name}{v.colour ? ` · ${v.colour}` : ''}</option>)}
            </select>
          </div>
          <div className="fs-field">
            <label className="fs-field__label" htmlFor="capability-notes">Notes (optional)</label>
            <input
              id="capability-notes"
              className="fs-input"
              data-testid="capability-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <button type="submit" className="fs-btn" disabled={busy || !varietyId} data-testid="capability-add">
            Add capability
          </button>
        </form>
      </div>
    </div>
  );
}
