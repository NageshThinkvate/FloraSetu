import { FormEvent, useEffect, useState } from 'react';
import { apiGet } from '../lib/api/client';

interface ProductSummary {
  id: string;
  ref: string;
  name: string;
  commercial_name: string | null;
  status: string;
  validation_status: 'DEMO' | 'VALIDATED';
  launch_enabled: boolean;
  launch_cities: string[];
  category_code?: string;
  matched_alias?: string | null;
}

interface ProductDetail extends ProductSummary {
  botanical_name: string | null;
  common_name: string | null;
  aliases: { id: string; alias: string; alias_type: string }[];
  varieties: { id: string; name: string; status: string; colour: string | null; validation_status: string }[];
  gradeProfiles: { id: string; grade_code: string; version_no: number; status: string; effective_from: string; validation_status: string }[];
  packDefinitions: { id: string; code: string; name: string; level: string; contains_qty: string; uom: string; version_no: number; status: string }[];
  unitConversions: { id: string; from_uom: string; to_uom: string; factor: string; version_no: number; status: string }[];
  handlingProfiles: { id: string; code: string; version_no: number; temp_min_c: string | null; temp_max_c: string | null; status: string; validation_status: string }[];
}

export function CatalogPage(): JSX.Element {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ProductSummary[]>([]);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [error, setError] = useState('');

  const loadAll = async (): Promise<void> => {
    setItems((await apiGet<{ items: ProductSummary[] }>('/catalog/products')).items);
  };

  useEffect(() => {
    void loadAll().catch(() => setError('Catalog unavailable'));
  }, []);

  const search = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      setItems(q.trim() ? (await apiGet<{ items: ProductSummary[] }>(`/catalog/search?q=${encodeURIComponent(q)}`)).items
        : (await apiGet<{ items: ProductSummary[] }>('/catalog/products')).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    }
  };

  const open = async (id: string): Promise<void> => {
    setDetail(await apiGet<ProductDetail>(`/catalog/products/${id}`));
  };

  return (
    <main className="app-shell" data-testid="catalog-page">
      <header className="shell-header">
        <h1>Catalog</h1>
      </header>
      <form className="inline-form" onSubmit={search} data-testid="catalog-search-form">
        <input
          data-testid="catalog-search-input"
          placeholder="Search product, commercial name, alias, variety…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" data-testid="catalog-search-btn">Search</button>
      </form>
      {error && <p className="form-error" data-testid="catalog-error">{error}</p>}

      <section className="module-grid" data-testid="catalog-results">
        {items.map((p) => (
          <article key={p.id} className="module-tile" data-testid={`catalog-product-${p.id}`}>
            <h2>{p.name}</h2>
            <p>
              {p.category_code ?? ''} {p.commercial_name ? `· ${p.commercial_name}` : ''}
              {p.matched_alias ? ` · matched alias “${p.matched_alias}”` : ''}
            </p>
            <p>
              <span className={`state-chip${p.validation_status === 'DEMO' ? '' : ' frozen'}`}>
                {p.validation_status === 'DEMO' ? 'DEMO — not validated' : 'VALIDATED'}
              </span>{' '}
              {p.launch_enabled && <span className="state-chip frozen">Launch: {p.launch_cities.join(', ')}</span>}
            </p>
            <button className="ghost-btn" data-testid={`catalog-open-${p.id}`} onClick={() => void open(p.id)}>View</button>
          </article>
        ))}
      </section>

      {detail && (
        <section className="panel" data-testid="catalog-detail">
          <h2>{detail.name} <span className="state-chip">{detail.ref}</span></h2>
          <p>
            {detail.botanical_name && <>Botanical: <em>{detail.botanical_name}</em> · </>}
            {detail.common_name && <>Common: {detail.common_name} · </>}
            Aliases: {detail.aliases.map((a) => a.alias).join(', ') || '—'}
          </p>
          <h3 className="sub-h">Varieties</h3>
          <ul className="plain-list">
            {detail.varieties.map((v) => (
              <li key={v.id} data-testid={`detail-variety-${v.id}`}>
                {v.name} {v.colour ? `· ${v.colour}` : ''} · {v.status} · {v.validation_status}
              </li>
            ))}
          </ul>
          <h3 className="sub-h">Grade profiles</h3>
          <ul className="plain-list">
            {detail.gradeProfiles.map((g) => (
              <li key={g.id}>Grade {g.grade_code} v{g.version_no} — {g.status} (from {new Date(g.effective_from).toLocaleDateString()}) · {g.validation_status}</li>
            ))}
          </ul>
          <h3 className="sub-h">Packs & conversions</h3>
          <ul className="plain-list">
            {detail.packDefinitions.map((p) => (
              <li key={p.id}>{p.name} ({p.level}) — {p.contains_qty} {p.uom} · v{p.version_no} · {p.status}</li>
            ))}
            {detail.unitConversions.map((c) => (
              <li key={c.id}>1 {c.from_uom} = {c.factor} {c.to_uom} · v{c.version_no} · {c.status}</li>
            ))}
          </ul>
          <h3 className="sub-h">Handling</h3>
          <ul className="plain-list">
            {detail.handlingProfiles.map((h) => (
              <li key={h.id}>
                {h.code} v{h.version_no} — {h.temp_min_c ?? '—'}…{h.temp_max_c ?? '—'} °C · {h.status} · {h.validation_status}
              </li>
            ))}
          </ul>
          <button className="ghost-btn" data-testid="catalog-detail-close" onClick={() => setDetail(null)}>Close</button>
        </section>
      )}
    </main>
  );
}
