import { FormEvent, useEffect, useState } from 'react';
import { apiGet } from '../lib/api/client';
import { PageHeader } from '../components/PageHeader';
import { StatusPill } from '../components/StatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { EmptyState } from '../components/EmptyState';
import { InlineAlert } from '../components/InlineAlert';
import { SideSheet } from '../components/SideSheet';

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

const validationLabel = (v: string): string => (v === 'VALIDATED' ? 'Validated' : 'Demo — not for production buying');

// Canonical catalog browsing (Phase 8: design-system rebuild — functionality unchanged;
// human validation labels replace raw status vocabulary).
export function CatalogPage(): JSX.Element {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ProductSummary[] | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [error, setError] = useState('');

  const loadAll = async (): Promise<void> => {
    setItems((await apiGet<{ items: ProductSummary[] }>('/catalog/products')).items);
  };
  useEffect(() => {
    void loadAll().catch(() => setError("We couldn't load the catalog. Try again."));
  }, []);

  const search = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      setItems(q.trim()
        ? (await apiGet<{ items: ProductSummary[] }>(`/catalog/search?q=${encodeURIComponent(q)}`)).items
        : (await apiGet<{ items: ProductSummary[] }>('/catalog/products')).items);
    } catch {
      setError('Search failed. Try again.');
    }
  };

  const open = async (id: string): Promise<void> => {
    setDetail(await apiGet<ProductDetail>(`/catalog/products/${id}`));
  };

  return (
    <div data-testid="catalog-page">
      <PageHeader overline="Catalog" title="Flowers & standards" testId="catalog-header" />
      <form className="fs-field" style={{ maxWidth: 420 }} onSubmit={(e) => void search(e)} data-testid="catalog-search-form">
        <label className="fs-field__label" htmlFor="catalog-search-input">Search product, commercial name, alias or variety</label>
        <div style={{ display: 'flex', gap: 'var(--fs-space-2)' }}>
          <input
            id="catalog-search-input"
            className="fs-input"
            data-testid="catalog-search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="fs-btn fs-btn--sm" data-testid="catalog-search-btn">Search</button>
        </div>
      </form>
      {error && <InlineAlert variant="error" testId="catalog-error">{error}</InlineAlert>}
      {items === null && !error && <SkeletonLoader variant="card" count={4} testId="catalog-loading" />}
      {items !== null && items.length === 0 && (
        <EmptyState title="No products found" hint="Try a different name or alias." testId="catalog-empty" />
      )}
      <div className="fs-md-stack" data-testid="catalog-results">
        {(items ?? []).map((p) => (
          <button
            key={p.id}
            type="button"
            className="fs-card fs-md-card"
            style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
            data-testid={`catalog-product-${p.id}`}
            onClick={() => void open(p.id)}
          >
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{p.name}</span>
              <StatusPill status={p.validation_status} label={validationLabel(p.validation_status)} />
            </div>
            <div className="fs-md-card__fields">
              {p.commercial_name && (
                <div>
                  <div className="fs-md-card__field-label">Also known as</div>
                  <div className="fs-md-card__field-value">{p.commercial_name}</div>
                </div>
              )}
              {p.matched_alias && (
                <div>
                  <div className="fs-md-card__field-label">Matched alias</div>
                  <div className="fs-md-card__field-value">{p.matched_alias}</div>
                </div>
              )}
              {p.launch_enabled && (
                <div>
                  <div className="fs-md-card__field-label">Available in</div>
                  <div className="fs-md-card__field-value">{p.launch_cities.join(', ')}</div>
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      <SideSheet
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? detail.name : ''}
        testId="catalog-detail"
      >
        {detail && (
          <div className="fs-md-stack" data-testid="catalog-detail-body">
            <div className="fs-task-card__top">
              <span className="fs-md-card__primary">{detail.ref}</span>
              <StatusPill status={detail.validation_status} label={validationLabel(detail.validation_status)} />
            </div>
            <div className="fs-md-card__fields">
              {detail.botanical_name && <div><div className="fs-md-card__field-label">Botanical</div><div className="fs-md-card__field-value"><em>{detail.botanical_name}</em></div></div>}
              {detail.common_name && <div><div className="fs-md-card__field-label">Common name</div><div className="fs-md-card__field-value">{detail.common_name}</div></div>}
              <div><div className="fs-md-card__field-label">Aliases</div><div className="fs-md-card__field-value">{detail.aliases.map((a) => a.alias).join(', ') || '—'}</div></div>
            </div>
            <div className="fs-md-card__field-label">Varieties</div>
            {detail.varieties.map((v) => (
              <p key={v.id} className="fs-body" style={{ margin: 0 }} data-testid={`detail-variety-${v.id}`}>
                {v.name}{v.colour ? ` · ${v.colour}` : ''} · {v.status.toLowerCase()} · {validationLabel(v.validation_status).toLowerCase()}
              </p>
            ))}
            <div className="fs-md-card__field-label">Grade profiles</div>
            {detail.gradeProfiles.length === 0 && <p className="fs-body" style={{ margin: 0 }}>None defined.</p>}
            {detail.gradeProfiles.map((g) => (
              <p key={g.id} className="fs-body" style={{ margin: 0 }}>
                Grade {g.grade_code} v{g.version_no} — {g.status.toLowerCase()} (from {new Date(g.effective_from).toLocaleDateString('en-IN')}) · {validationLabel(g.validation_status).toLowerCase()}
              </p>
            ))}
            <div className="fs-md-card__field-label">Packs & conversions</div>
            {detail.packDefinitions.map((p) => (
              <p key={p.id} className="fs-body" style={{ margin: 0 }}>
                {p.name} ({p.level.toLowerCase()}) — {p.contains_qty} {p.uom} · v{p.version_no} · {p.status.toLowerCase()}
              </p>
            ))}
            {detail.unitConversions.map((c) => (
              <p key={c.id} className="fs-body" style={{ margin: 0 }}>
                1 {c.from_uom} = {c.factor} {c.to_uom} · v{c.version_no} · {c.status.toLowerCase()}
              </p>
            ))}
            <div className="fs-md-card__field-label">Handling</div>
            {detail.handlingProfiles.length === 0 && <p className="fs-body" style={{ margin: 0 }}>No handling profile.</p>}
            {detail.handlingProfiles.map((h) => (
              <p key={h.id} className="fs-body" style={{ margin: 0 }}>
                {h.code} v{h.version_no} — {h.temp_min_c ?? '—'}…{h.temp_max_c ?? '—'} °C · {h.status.toLowerCase()} · {validationLabel(h.validation_status).toLowerCase()}
              </p>
            ))}
            <button className="fs-btn fs-btn--ghost" data-testid="catalog-detail-close" onClick={() => setDetail(null)}>Close</button>
          </div>
        )}
      </SideSheet>
    </div>
  );
}
