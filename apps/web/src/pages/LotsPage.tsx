import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listUnits, ProductSummary, searchProducts, UnitOfMeasure } from '../lib/api/demand';
import {
  createHarvestLot, createStockLot, fmtDate, listMyLots, LotSummary, ORIGIN_TYPES
} from '../lib/api/fulfilment';

// Supplier supply desk: physical lot intake (harvest / stock receipt), supplier-declared
// quality with actual-lot evidence (ADR-011), and live quantity balances.
export function LotsPage(): JSX.Element {
  const [lots, setLots] = useState<LotSummary[] | null>(null);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [flow, setFlow] = useState<'harvest' | 'stock' | null>(null);
  const [q, setQ] = useState('');
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [product, setProduct] = useState<ProductSummary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => setLots((await listMyLots()).items);
  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : 'Lots unavailable'));
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

  const create = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(''); setNotice('');
    const fd = new FormData(e.target as HTMLFormElement);
    if (!product) {
      setError('Select a commodity first.');
      return;
    }
    const body: Record<string, unknown> = {
      commodityId: product.id,
      declaredQty: Number(fd.get('declaredQty')),
      uomId: String(fd.get('uomId')),
      originType: String(fd.get('originType')),
      originDetail: String(fd.get('originDetail') ?? '') || undefined,
      colourCode: String(fd.get('colourCode') ?? '') || undefined,
      varietyId: String(fd.get('varietyId') ?? '') || undefined,
      gradeProfileId: String(fd.get('gradeProfileId') ?? '') || undefined
    };
    setBusy(true);
    try {
      if (flow === 'harvest') {
        const res = await createHarvestLot({
          ...body,
          harvestedAt: new Date(String(fd.get('at'))).toISOString(),
          farmName: String(fd.get('farmName') ?? '') || undefined,
          farmBlock: String(fd.get('farmBlock') ?? '') || undefined,
          notes: String(fd.get('notes') ?? '') || undefined
        });
        setNotice(`Harvest lot ${res.ref} created.`);
      } else {
        const res = await createStockLot({ ...body, receivedAt: new Date(String(fd.get('at'))).toISOString() });
        setNotice(`Stock lot ${res.ref} created.`);
      }
      setFlow(null); setProduct(null); setProducts([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lot creation failed');
    } finally {
      setBusy(false);
    }
  };


  if (error && !lots) {
    return (
      <main className="app-shell" data-testid="lots-denied">
        <header className="shell-header"><h1>My supply lots</h1></header>
        <p className="form-error" data-testid="lots-error">{error}</p>
      </main>
    );
  }

  return (
    <main className="app-shell" data-testid="lots-page">
      <header className="shell-header"><h1>My supply lots</h1></header>
      {error && <p className="form-error" data-testid="lots-error-inline">{error}</p>}
      {notice && <p className="form-ok" data-testid="lots-notice">{notice}</p>}

      <div className="inline-form" data-testid="lots-create-chooser">
        <button className="ghost-btn" data-testid="lots-new-harvest" onClick={() => setFlow('harvest')}>New harvest lot</button>
        <button className="ghost-btn" data-testid="lots-new-stock" onClick={() => setFlow('stock')}>New stock receipt</button>
      </div>

      {flow && (
        <section className="panel" data-testid="lots-create-panel">
          <h2>{flow === 'harvest' ? 'Harvest lot' : 'Stock receipt'}</h2>
          {!product && (
            <>
              <form onSubmit={search} className="inline-form" data-testid="lots-search-form">
                <input data-testid="lots-search-input" placeholder="Search commodity (e.g. rose)" value={q}
                  onChange={(e) => setQ(e.target.value)} />
                <button type="submit" data-testid="lots-search-btn">Find</button>
              </form>
              <ul className="plain-list">
                {products.map((p) => (
                  <li key={p.id} data-testid={`lots-product-${p.id}`}>
                    <span>{p.name}</span>
                    <span className="hint">{p.commercial_name ?? p.ref}</span>
                    <button className="ghost-btn" data-testid={`lots-pick-${p.id}`} onClick={() => setProduct(p)}>Select</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {product && (
            <form onSubmit={create} data-testid="lots-create-form">
              <p><strong>{product.name}</strong> <span className="state-chip">{product.ref}</span></p>
              <label>Declared quantity
                <input name="declaredQty" data-testid="lots-qty" type="number" min="0.01" step="any" required />
              </label>
              <label>Unit
                <select name="uomId" data-testid="lots-uom" required>
                  <option value="">Select unit…</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                </select>
              </label>
              <label>Origin type
                <select name="originType" data-testid="lots-origin" required>
                  {ORIGIN_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label>{flow === 'harvest' ? 'Harvested at' : 'Received at'}
                <input name="at" data-testid="lots-at" type="datetime-local" required />
              </label>
              <label>Origin detail (optional)
                <input name="originDetail" data-testid="lots-origin-detail" />
              </label>
              <label>Colour code (optional)
                <input name="colourCode" data-testid="lots-colour" />
              </label>
              <label>Variety ID (optional UUID)
                <input name="varietyId" data-testid="lots-variety" />
              </label>
              <label>Grade profile ID (optional UUID)
                <input name="gradeProfileId" data-testid="lots-grade-profile" />
              </label>
              {flow === 'harvest' && (
                <>
                  <label>Farm name (optional)<input name="farmName" data-testid="lots-farm" /></label>
                  <label>Farm block (optional)<input name="farmBlock" data-testid="lots-block" /></label>
                  <label>Notes (optional)<input name="notes" data-testid="lots-notes" /></label>
                </>
              )}
              <div className="inline-form">
                <button type="submit" disabled={busy} data-testid="lots-create-btn">{busy ? 'Saving…' : 'Create lot'}</button>
                <button type="button" className="ghost-btn" data-testid="lots-cancel" onClick={() => { setFlow(null); setProduct(null); }}>Cancel</button>
              </div>
            </form>
          )}
        </section>
      )}

      <section className="panel" data-testid="lots-list-panel">
        <h2>Lots ({lots?.length ?? 0})</h2>
        <ul className="plain-list">
          {(lots ?? []).map((l) => (
            <li key={l.id} data-testid={`lot-row-${l.id}`}>
              <span className="state-chip">{l.status}</span>
              <span>{l.source_flow === 'HARVEST_FLOW' ? 'Harvest' : 'Stock'} · declared {l.declared_qty}</span>
              <span className="hint">
                avail {l.available_qty} · alloc {l.allocated_qty} · packed {l.packed_qty} · delivered {l.delivered_qty}
                {Number(l.qc_held_qty ?? 0) > 0 ? ` · on hold ${l.qc_held_qty}` : ''}
              </span>
              <span className="hint">{fmtDate(l.created_at)}</span>
              {['STOCK_RECEIVED', 'HARVESTED'].includes(l.status) && (
                <Link to={`/supply/lots/${l.id}`} data-testid={`lot-declare-${l.id}`}><button className="ghost-btn">Add photos &amp; declare</button></Link>
              )}
              <Link to={`/supply/lots/${l.id}`} data-testid={`lot-open-${l.id}`}><button className="ghost-btn">Open</button></Link>
            </li>
          ))}
        </ul>
        {(lots ?? []).length === 0 && <p className="hint" data-testid="lots-empty">No lots yet — record a harvest or stock receipt.</p>}
      </section>
    </main>
  );
}
