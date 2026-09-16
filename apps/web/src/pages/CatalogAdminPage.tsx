import { FormEvent, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../lib/api/client';
import { PageHeader } from '../components/PageHeader';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { InlineAlert } from '../components/InlineAlert';

interface Masters {
  qualityAttributes: { id: string; code: string; name: string; status: string }[];
  defectTypes: { id: string; code: string; name: string; defect_class: string; status: string }[];
  units: { id: string; code: string; name: string; status: string; validation_status: string }[];
  colours: { id: string; code: string; name: string; status: string }[];
}

interface Category { id: string; code: string; name: string; status: string; validation_status: string }
interface ProductRow {
  id: string; ref: string; name: string; status: string;
  validation_status: string; launch_enabled: boolean; launch_cities: string[];
}

type VersionRow = Record<string, string | number | boolean | null>;
const VERSIONED_ENTITIES: [string, string][] = [
  ['grade_profiles', 'Grade profiles'],
  ['pack_definitions', 'Pack definitions'],
  ['unit_conversions', 'Unit conversions'],
  ['handling_profiles', 'Handling profiles']
];

const validationLabel = (v: string): string => (v === 'VALIDATED' ? 'Validated' : 'Demo');
const fmtDate = (v: string | number | boolean | null): string =>
  v ? new Date(String(v)).toLocaleDateString('en-IN') : '—';

// Human one-line summary for a versioned-master row (replaces the legacy raw JSON dump).
const versionSummary = (v: VersionRow): string => {
  const parts: string[] = [];
  if (v.code || v.grade_code) { parts.push(String(v.code ?? v.grade_code)); }
  if (v.name) { parts.push(String(v.name)); }
  if (v.version_no) { parts.push(`v${v.version_no}`); }
  if (v.factor) { parts.push(`factor ${v.factor}`); }
  if (v.temp_min_c || v.temp_max_c) { parts.push(`${v.temp_min_c ?? '—'}…${v.temp_max_c ?? '—'} °C`); }
  if (v.status) { parts.push(String(v.status).toLowerCase()); }
  if (v.effective_from) { parts.push(`from ${fmtDate(v.effective_from)}`); }
  return parts.join(' · ') || 'Version row';
};

// Catalog & standards governance (Phase 8: design-system rebuild — functionality
// unchanged; version history renders human summaries instead of raw JSON).
export function CatalogAdminPage(): JSX.Element {
  const [masters, setMasters] = useState<Masters | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionEntity, setVersionEntity] = useState<string>('grade_profiles');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const [categoryForm, setCategoryForm] = useState({ code: '', name: '' });
  const [productForm, setProductForm] = useState({ categoryId: '', name: '', commercialName: '', botanicalName: '' });
  const [aliasForm, setAliasForm] = useState({ commodityId: '', alias: '', aliasType: 'COMMERCIAL' });
  const [uomForm, setUomForm] = useState({ code: '', name: '' });
  const [attrForm, setAttrForm] = useState({ code: '', name: '', dataType: 'NUMERIC' });
  const [defectForm, setDefectForm] = useState({ code: '', name: '', defectClass: '' });
  const [conversionForm, setConversionForm] = useState({ fromUomId: '', toUomId: '', factor: '' });
  const [handlingForm, setHandlingForm] = useState({ code: '', tempMinC: '', tempMaxC: '', changeReason: '' });
  const [gradeForm, setGradeForm] = useState({ commodityId: '', gradeCode: '', minStemLength: '' });

  const load = async (): Promise<void> => {
    const [m, c, p] = await Promise.all([
      apiGet<Masters>('/catalog/admin/masters'),
      apiGet<{ items: Category[] }>('/catalog/categories'),
      apiGet<{ items: ProductRow[] }>('/catalog/products')
    ]);
    setMasters(m);
    setCategories(c.items);
    setProducts(p.items);
    setLoading(false);
  };

  useEffect(() => {
    void load().catch(() => { setError("We couldn't load catalog administration."); setLoading(false); });
  }, []);

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError(''); setNotice('');
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const field = (id: string, label: string, value: string, onChange: (v: string) => void, opts?: { required?: boolean; upper?: boolean; inputMode?: 'decimal' | 'numeric' }): JSX.Element => (
    <div className="fs-field">
      <label className="fs-field__label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="fs-input"
        data-testid={id}
        value={value}
        inputMode={opts?.inputMode}
        required={opts?.required ?? true}
        onChange={(e) => onChange(opts?.upper ? e.target.value.toUpperCase() : e.target.value)}
      />
    </div>
  );

  return (
    <div data-testid="catalog-admin-page">
      <PageHeader overline="Admin Control Plane" title="Catalog & standards" testId="catalog-admin-header" />
      <p className="fs-body">
        New standards are created as Demo until validated. Writes auto-increment the version;
        committed transactions keep the version they used.
      </p>
      {notice && <InlineAlert variant="success" testId="catalog-admin-notice">{notice}</InlineAlert>}
      {error && <InlineAlert variant="error" testId="catalog-admin-error">{error}</InlineAlert>}
      {loading && <SkeletonLoader variant="card" count={3} testId="catalog-admin-loading" />}

      {!loading && (
        <>
          <div className="fs-card fs-md-card" data-testid="admin-categories">
            <div className="fs-md-card__field-label">Categories</div>
            {categories.map((c) => (
              <p key={c.id} className="fs-body" style={{ margin: 0 }}>
                {c.code} — {c.name} · {c.status.toLowerCase()} · {validationLabel(c.validation_status).toLowerCase()}
              </p>
            ))}
            <form className="fs-md-stack" data-testid="category-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => apiPost('/catalog/admin/categories', categoryForm), 'Category created'); }}>
              {field('category-code', 'Code', categoryForm.code, (v) => setCategoryForm({ ...categoryForm, code: v }), { upper: true })}
              {field('category-name', 'Name', categoryForm.name, (v) => setCategoryForm({ ...categoryForm, name: v }))}
              <button type="submit" className="fs-btn fs-btn--sm" data-testid="category-create">Create category</button>
            </form>
          </div>

          <div className="fs-card fs-md-card" data-testid="admin-products">
            <div className="fs-md-card__field-label">Products</div>
            {products.map((p) => (
              <div key={p.id} className="fs-task-card__top" data-testid={`admin-product-${p.id}`}>
                <span className="fs-body" style={{ margin: 0 }}>
                  {p.ref} — {p.name} · {p.status.toLowerCase()} · {validationLabel(p.validation_status).toLowerCase()}
                  {p.launch_enabled && ` · available in ${p.launch_cities.join(', ')}`}
                </span>
                <button
                  className="fs-btn fs-btn--ghost fs-btn--sm"
                  data-testid={`launch-toggle-${p.id}`}
                  onClick={() => void run(() =>
                    apiPatch(`/catalog/admin/products/${p.id}/launch-flags`,
                      { launchEnabled: !p.launch_enabled, launchCities: p.launch_enabled ? [] : ['Bengaluru'] }),
                    'Launch availability updated')}
                >
                  {p.launch_enabled ? 'Disable launch' : 'Launch in Bengaluru'}
                </button>
              </div>
            ))}
            <form className="fs-md-stack" data-testid="product-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => apiPost('/catalog/admin/products', productForm), 'Product created (Demo until validated)'); }}>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="product-category">Category</label>
                <select id="product-category" className="fs-input" data-testid="product-category" value={productForm.categoryId} onChange={(e) => setProductForm({ ...productForm, categoryId: e.target.value })} required>
                  <option value="">Choose category…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {field('product-name', 'Product name', productForm.name, (v) => setProductForm({ ...productForm, name: v }))}
              {field('product-commercial', 'Commercial name (optional)', productForm.commercialName, (v) => setProductForm({ ...productForm, commercialName: v }), { required: false })}
              {field('product-botanical', 'Botanical name (optional)', productForm.botanicalName, (v) => setProductForm({ ...productForm, botanicalName: v }), { required: false })}
              <button type="submit" className="fs-btn fs-btn--sm" data-testid="product-create">Create product</button>
            </form>
            <form className="fs-md-stack" data-testid="alias-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => apiPost('/catalog/admin/aliases', aliasForm), 'Alias added'); }}>
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="alias-product">Product</label>
                <select id="alias-product" className="fs-input" data-testid="alias-product" value={aliasForm.commodityId} onChange={(e) => setAliasForm({ ...aliasForm, commodityId: e.target.value })} required>
                  <option value="">Choose product…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {field('alias-value', 'Alias / synonym', aliasForm.alias, (v) => setAliasForm({ ...aliasForm, alias: v }))}
              <div className="fs-field">
                <label className="fs-field__label" htmlFor="alias-type">Alias type</label>
                <select id="alias-type" className="fs-input" data-testid="alias-type" value={aliasForm.aliasType} onChange={(e) => setAliasForm({ ...aliasForm, aliasType: e.target.value })}>
                  <option value="COMMERCIAL">Commercial</option><option value="COMMON">Common</option>
                  <option value="BOTANICAL">Botanical</option><option value="SYNONYM">Synonym</option>
                </select>
              </div>
              <button type="submit" className="fs-btn fs-btn--sm" data-testid="alias-create">Add alias</button>
            </form>
          </div>

          {masters && (
            <div className="fs-card fs-md-card" data-testid="admin-masters">
              <div className="fs-md-card__field-label">Units · attributes · defects</div>
              <p className="fs-body" style={{ margin: 0 }}>Units: {masters.units.map((u) => `${u.code} (${validationLabel(u.validation_status).toLowerCase()})`).join(', ')}</p>
              <p className="fs-body" style={{ margin: 0 }}>Attributes: {masters.qualityAttributes.map((a) => a.code).join(', ') || '—'}</p>
              <p className="fs-body" style={{ margin: 0 }}>Defects: {masters.defectTypes.map((d) => d.code).join(', ') || '—'}</p>
              <form className="fs-md-stack" data-testid="uom-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => apiPost('/catalog/admin/units', uomForm), 'Unit created'); }}>
                {field('uom-code', 'Unit code', uomForm.code, (v) => setUomForm({ ...uomForm, code: v }), { upper: true })}
                {field('uom-name', 'Unit name', uomForm.name, (v) => setUomForm({ ...uomForm, name: v }))}
                <button type="submit" className="fs-btn fs-btn--sm" data-testid="uom-create">Add unit</button>
              </form>
              <form className="fs-md-stack" data-testid="attr-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => apiPost('/catalog/admin/quality-attributes', attrForm), 'Attribute created'); }}>
                {field('attr-code', 'Attribute code', attrForm.code, (v) => setAttrForm({ ...attrForm, code: v }))}
                {field('attr-name', 'Attribute name', attrForm.name, (v) => setAttrForm({ ...attrForm, name: v }))}
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor="attr-type">Data type</label>
                  <select id="attr-type" className="fs-input" data-testid="attr-type" value={attrForm.dataType} onChange={(e) => setAttrForm({ ...attrForm, dataType: e.target.value })}>
                    <option>NUMERIC</option><option>INTEGER</option><option>ENUM</option><option>BOOLEAN</option><option>TEXT</option>
                  </select>
                </div>
                <button type="submit" className="fs-btn fs-btn--sm" data-testid="attr-create">Add attribute</button>
              </form>
              <form className="fs-md-stack" data-testid="defect-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => apiPost('/catalog/admin/defect-types', defectForm), 'Defect type created'); }}>
                {field('defect-code', 'Defect code', defectForm.code, (v) => setDefectForm({ ...defectForm, code: v }))}
                {field('defect-name', 'Defect name', defectForm.name, (v) => setDefectForm({ ...defectForm, name: v }))}
                {field('defect-class', 'Class (e.g. PHYSICAL)', defectForm.defectClass, (v) => setDefectForm({ ...defectForm, defectClass: v }), { upper: true })}
                <button type="submit" className="fs-btn fs-btn--sm" data-testid="defect-create">Add defect</button>
              </form>
            </div>
          )}

          {masters && (
            <div className="fs-card fs-md-card" data-testid="admin-versioned">
              <div className="fs-md-card__field-label">Conversions · grades · handling</div>
              <form className="fs-md-stack" data-testid="conversion-form" onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void run(() => apiPost('/catalog/admin/conversions', {
                  fromUomId: conversionForm.fromUomId, toUomId: conversionForm.toUomId,
                  factor: Number(conversionForm.factor), effectiveFrom: new Date().toISOString(),
                  activate: true, changeReason: 'admin-ui'
                }), 'Conversion version created');
              }}>
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor="conv-from">From unit</label>
                  <select id="conv-from" className="fs-input" data-testid="conv-from" value={conversionForm.fromUomId} onChange={(e) => setConversionForm({ ...conversionForm, fromUomId: e.target.value })} required>
                    <option value="">Choose…</option>
                    {masters.units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                  </select>
                </div>
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor="conv-to">To unit</label>
                  <select id="conv-to" className="fs-input" data-testid="conv-to" value={conversionForm.toUomId} onChange={(e) => setConversionForm({ ...conversionForm, toUomId: e.target.value })} required>
                    <option value="">Choose…</option>
                    {masters.units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                  </select>
                </div>
                {field('conv-factor', 'Factor', conversionForm.factor, (v) => setConversionForm({ ...conversionForm, factor: v }), { inputMode: 'decimal' })}
                <button type="submit" className="fs-btn fs-btn--sm" data-testid="conv-create">Add conversion</button>
              </form>
              <form className="fs-md-stack" data-testid="grade-form" onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void run(() => apiPost('/catalog/admin/grade-profiles', {
                  commodityId: gradeForm.commodityId, gradeCode: gradeForm.gradeCode,
                  rules: [{ attribute: 'stem_length_cm', op: 'MIN', min: Number(gradeForm.minStemLength) }],
                  effectiveFrom: new Date().toISOString(), activate: false, validationStatus: 'DEMO'
                }), 'Grade profile version created (draft, Demo)');
              }}>
                <div className="fs-field">
                  <label className="fs-field__label" htmlFor="grade-product">Product</label>
                  <select id="grade-product" className="fs-input" data-testid="grade-product" value={gradeForm.commodityId} onChange={(e) => setGradeForm({ ...gradeForm, commodityId: e.target.value })} required>
                    <option value="">Choose product…</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                {field('grade-code', 'Grade code (A/B…)', gradeForm.gradeCode, (v) => setGradeForm({ ...gradeForm, gradeCode: v }))}
                {field('grade-minstem', 'Minimum stem length (cm)', gradeForm.minStemLength, (v) => setGradeForm({ ...gradeForm, minStemLength: v }), { inputMode: 'numeric' })}
                <button type="submit" className="fs-btn fs-btn--sm" data-testid="grade-create">New grade version</button>
              </form>
              <form className="fs-md-stack" data-testid="handling-form" onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void run(() => apiPost('/catalog/admin/handling-profiles', {
                  code: handlingForm.code, tempMinC: Number(handlingForm.tempMinC), tempMaxC: Number(handlingForm.tempMaxC),
                  effectiveFrom: new Date().toISOString(), activate: false,
                  changeReason: handlingForm.changeReason || 'admin-ui', validationStatus: 'DEMO'
                }), 'Handling profile version created (draft, Demo)');
              }}>
                {field('handling-code', 'Profile code', handlingForm.code, (v) => setHandlingForm({ ...handlingForm, code: v }), { upper: true })}
                {field('handling-tmin', 'Temp min °C', handlingForm.tempMinC, (v) => setHandlingForm({ ...handlingForm, tempMinC: v }), { inputMode: 'decimal' })}
                {field('handling-tmax', 'Temp max °C', handlingForm.tempMaxC, (v) => setHandlingForm({ ...handlingForm, tempMaxC: v }), { inputMode: 'decimal' })}
                {field('handling-reason', 'Change reason (optional)', handlingForm.changeReason, (v) => setHandlingForm({ ...handlingForm, changeReason: v }), { required: false })}
                <button type="submit" className="fs-btn fs-btn--sm" data-testid="handling-create">New handling version</button>
              </form>
            </div>
          )}

          <div className="fs-card fs-md-card" data-testid="admin-versions">
            <div className="fs-md-card__field-label">Version history</div>
            <div style={{ display: 'flex', gap: 'var(--fs-space-2)', alignItems: 'end' }}>
              <div className="fs-field" style={{ flex: 1 }}>
                <label className="fs-field__label" htmlFor="versions-entity">Standard</label>
                <select id="versions-entity" className="fs-input" data-testid="versions-entity" value={versionEntity} onChange={(e) => setVersionEntity(e.target.value)}>
                  {VERSIONED_ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <button
                className="fs-btn fs-btn--sm"
                data-testid="versions-load"
                onClick={() => void run(async () => {
                  setVersions((await apiGet<{ items: VersionRow[] }>(`/catalog/admin/versions/${versionEntity}`)).items);
                }, 'Versions loaded')}
              >
                Load
              </button>
            </div>
            <div className="fs-md-stack" data-testid="versions-list">
              {versions.length === 0 && <p className="fs-body" style={{ margin: 0 }}>Choose a standard and load its versions.</p>}
              {versions.map((v, i) => (
                <p key={i} className="fs-body" style={{ margin: 0 }} data-testid={`version-row-${i}`}>
                  {versionSummary(v)}
                </p>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
