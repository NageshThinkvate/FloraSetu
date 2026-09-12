import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createRequirement, listUnits, ProductSummary,
  searchProducts, submitRequirement, UnitOfMeasure
} from '../lib/api/demand';

// Progressive procurement: the mobile-first QUICK flow writes the same canonical
// Requirement model as a Formal RFQ — the backend auto-publishes a managed RFQ.
export function QuickRequestPage(): JSX.Element {
  const [q, setQ] = useState('');
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [product, setProduct] = useState<ProductSummary | null>(null);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [quantity, setQuantity] = useState('');
  const [uomId, setUomId] = useState('');
  const [neededAt, setNeededAt] = useState('');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ id: string; ref: string } | null>(null);

  useEffect(() => {
    listUnits().then((r) => setUnits(r.items)).catch(() => undefined);
  }, []);

  const search = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      setProducts((await searchProducts(q)).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    }
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    if (!product || !quantity || !uomId || !neededAt || !destination.trim()) {
      setError('Product, quantity, unit, needed-by date and destination are all required.');
      return;
    }
    setBusy(true);
    try {
      const req = await createRequirement({
        mode: 'QUICK',
        title: `${product.name} — ${quantity} for ${destination.trim()}`,
        lines: [{
          commodityId: product.id,
          quantity: Number(quantity),
          uomId,
          neededAt: new Date(neededAt).toISOString(),
          deliveryDestination: destination.trim()
        }]
      });
      await submitRequirement(req.id, crypto.randomUUID());
      setDone(req);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <main className="app-shell" data-testid="quick-success">
        <header className="shell-header"><h1>Request submitted</h1></header>
        <section className="panel">
          <p className="form-ok" data-testid="quick-success-ref">Reference {done.ref}</p>
          <p className="hint">
            Our sourcing desk has published this to matched suppliers. You will see quotations as they arrive.
          </p>
          <Link to={`/demand/requirements/${done.id}`} data-testid="quick-success-open">
            <button>Track request</button>
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell" data-testid="quick-request-page">
      <header className="shell-header"><h1>Quick request</h1></header>
      <form onSubmit={search} className="inline-form" data-testid="quick-search-form">
        <input
          data-testid="quick-search-input"
          placeholder="What flowers do you need? (e.g. rose, orchid)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" data-testid="quick-search-btn">Find</button>
      </form>
      {products.length > 0 && !product && (
        <section className="module-grid" style={{ marginTop: 16 }} data-testid="quick-product-results">
          {products.map((p) => (
            <article key={p.id} className="module-tile" data-testid={`quick-product-${p.id}`}>
              <h2>{p.name}</h2>
              <p>{p.commercial_name ?? p.ref}{p.matched_alias ? ` · alias “${p.matched_alias}”` : ''}</p>
              <button className="ghost-btn" data-testid={`quick-pick-${p.id}`} onClick={() => setProduct(p)}>Select</button>
            </article>
          ))}
        </section>
      )}
      {product && (
        <form onSubmit={submit} className="panel" data-testid="quick-details-form">
          <h2>{product.name} <span className="state-chip">{product.ref}</span></h2>
          <label>
            Quantity
            <input data-testid="quick-qty" type="number" min="1" step="any" value={quantity}
              onChange={(e) => setQuantity(e.target.value)} />
          </label>
          <label>
            Unit
            <select data-testid="quick-uom" value={uomId} onChange={(e) => setUomId(e.target.value)}>
              <option value="">Select unit…</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
            </select>
          </label>
          <label>
            Needed by
            <input data-testid="quick-needed-at" type="datetime-local" value={neededAt}
              onChange={(e) => setNeededAt(e.target.value)} />
          </label>
          <label>
            Delivery destination
            <input data-testid="quick-destination" value={destination}
              onChange={(e) => setDestination(e.target.value)} placeholder="City / venue" />
          </label>
          {error && <p className="form-error" data-testid="quick-error">{error}</p>}
          <div className="inline-form">
            <button type="submit" disabled={busy} data-testid="quick-submit-btn">
              {busy ? 'Submitting…' : 'Request quotes'}
            </button>
            <button type="button" className="ghost-btn" data-testid="quick-change-product" onClick={() => setProduct(null)}>
              Change product
            </button>
          </div>
        </form>
      )}
      {error && !product && <p className="form-error" data-testid="quick-error-top">{error}</p>}
    </main>
  );
}
