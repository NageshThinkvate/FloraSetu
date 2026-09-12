import { FormEvent, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '../lib/api/client';

interface Masters {
  qualityAttributes: { id: string; code: string; name: string; status: string }[];
  defectTypes: { id: string; code: string; name: string; defect_class: string; status: string }[];
  units: { id: string; code: string; name: string; status: string; validation_status: string }[];
  colours: { id: string; code: string; name: string; status: string }[];
}

interface Category {
  id: string;
  code: string;
  name: string;
  status: string;
  validation_status: string;
}

interface ProductRow {
  id: string;
  ref: string;
  name: string;
  status: string;
  validation_status: string;
  launch_enabled: boolean;
  launch_cities: string[];
}

type VersionRow = Record<string, string | number | boolean | null>;
const VERSIONED_ENTITIES = ['grade_profiles', 'pack_definitions', 'unit_conversions', 'handling_profiles'] as const;

export function CatalogAdminPage(): JSX.Element {
  const [masters, setMasters] = useState<Masters | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionEntity, setVersionEntity] = useState<string>('grade_profiles');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

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
  };

  useEffect(() => {
    void load().catch((err: Error) => setError(err.message));
  }, []);

  const run = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const selectStyle = { minWidth: 140 } as const;

  return (
    <main className="app-shell" data-testid="catalog-admin-page">
      <header className="shell-header"><h1>Catalog administration</h1></header>

      <section className="panel" data-testid="admin-categories">
        <h2>Categories</h2>
        <ul className="plain-list">
          {categories.map((c) => (
            <li key={c.id}>{c.code} — {c.name} · {c.status} · {c.validation_status}</li>
          ))}
        </ul>
        <form className="inline-form" data-testid="category-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => apiPost('/catalog/admin/categories', categoryForm), 'Category created'); }}>
          <input data-testid="category-code" placeholder="CODE" value={categoryForm.code} onChange={(e) => setCategoryForm({ ...categoryForm, code: e.target.value.toUpperCase() })} required />
          <input data-testid="category-name" placeholder="Name" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} required />
          <button type="submit" data-testid="category-create">Create</button>
        </form>
      </section>

      <section className="panel" data-testid="admin-products">
        <h2>Products</h2>
        <ul className="plain-list">
          {products.map((p) => (
            <li key={p.id} data-testid={`admin-product-${p.id}`}>
              {p.ref} — {p.name} · {p.status} · {p.validation_status}
              {p.launch_enabled && ` · launch: ${p.launch_cities.join(', ')}`}
              <button className="ghost-btn" data-testid={`launch-toggle-${p.id}`} onClick={() => void run(() =>
                apiPatch(`/catalog/admin/products/${p.id}/launch-flags`,
                  { launchEnabled: !p.launch_enabled, launchCities: p.launch_enabled ? [] : ['Bengaluru'] }),
                'Launch flags updated')}>
                {p.launch_enabled ? 'Disable launch' : 'Launch in Bengaluru'}
              </button>
            </li>
          ))}
        </ul>
        <form className="inline-form" data-testid="product-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => apiPost('/catalog/admin/products', productForm), 'Product created (DEMO)'); }}>
          <select data-testid="product-category" style={selectStyle} value={productForm.categoryId} onChange={(e) => setProductForm({ ...productForm, categoryId: e.target.value })} required>
            <option value="">Category…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input data-testid="product-name" placeholder="Product name" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} required />
          <input data-testid="product-commercial" placeholder="Commercial name" value={productForm.commercialName} onChange={(e) => setProductForm({ ...productForm, commercialName: e.target.value })} />
          <input data-testid="product-botanical" placeholder="Botanical name" value={productForm.botanicalName} onChange={(e) => setProductForm({ ...productForm, botanicalName: e.target.value })} />
          <button type="submit" data-testid="product-create">Create</button>
        </form>
        <form className="inline-form" data-testid="alias-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => apiPost('/catalog/admin/aliases', aliasForm), 'Alias added'); }}>
          <select data-testid="alias-product" style={selectStyle} value={aliasForm.commodityId} onChange={(e) => setAliasForm({ ...aliasForm, commodityId: e.target.value })} required>
            <option value="">Product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input data-testid="alias-value" placeholder="Alias / synonym" value={aliasForm.alias} onChange={(e) => setAliasForm({ ...aliasForm, alias: e.target.value })} required />
          <select data-testid="alias-type" value={aliasForm.aliasType} onChange={(e) => setAliasForm({ ...aliasForm, aliasType: e.target.value })}>
            <option value="COMMERCIAL">Commercial</option><option value="COMMON">Common</option>
            <option value="BOTANICAL">Botanical</option><option value="SYNONYM">Synonym</option>
          </select>
          <button type="submit" data-testid="alias-create">Add alias</button>
        </form>
      </section>

      {masters && (
        <section className="panel" data-testid="admin-masters">
          <h2>Units · attributes · defects</h2>
          <p className="hint">
            Units: {masters.units.map((u) => `${u.code} (${u.validation_status})`).join(', ')}
          </p>
          <p className="hint">Attributes: {masters.qualityAttributes.map((a) => a.code).join(', ') || '—'}</p>
          <p className="hint">Defects: {masters.defectTypes.map((d) => d.code).join(', ') || '—'}</p>
          <form className="inline-form" data-testid="uom-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => apiPost('/catalog/admin/units', uomForm), 'Unit created'); }}>
            <input data-testid="uom-code" placeholder="CODE" value={uomForm.code} onChange={(e) => setUomForm({ ...uomForm, code: e.target.value.toUpperCase() })} required />
            <input data-testid="uom-name" placeholder="Name" value={uomForm.name} onChange={(e) => setUomForm({ ...uomForm, name: e.target.value })} required />
            <button type="submit" data-testid="uom-create">Add unit</button>
          </form>
          <form className="inline-form" data-testid="attr-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => apiPost('/catalog/admin/quality-attributes', attrForm), 'Attribute created'); }}>
            <input data-testid="attr-code" placeholder="attribute_code" value={attrForm.code} onChange={(e) => setAttrForm({ ...attrForm, code: e.target.value })} required />
            <input data-testid="attr-name" placeholder="Name" value={attrForm.name} onChange={(e) => setAttrForm({ ...attrForm, name: e.target.value })} required />
            <select data-testid="attr-type" value={attrForm.dataType} onChange={(e) => setAttrForm({ ...attrForm, dataType: e.target.value })}>
              <option>NUMERIC</option><option>INTEGER</option><option>ENUM</option><option>BOOLEAN</option><option>TEXT</option>
            </select>
            <button type="submit" data-testid="attr-create">Add attribute</button>
          </form>
          <form className="inline-form" data-testid="defect-form" onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => apiPost('/catalog/admin/defect-types', defectForm), 'Defect type created'); }}>
            <input data-testid="defect-code" placeholder="defect_code" value={defectForm.code} onChange={(e) => setDefectForm({ ...defectForm, code: e.target.value })} required />
            <input data-testid="defect-name" placeholder="Name" value={defectForm.name} onChange={(e) => setDefectForm({ ...defectForm, name: e.target.value })} required />
            <input data-testid="defect-class" placeholder="Class (e.g. PHYSICAL)" value={defectForm.defectClass} onChange={(e) => setDefectForm({ ...defectForm, defectClass: e.target.value.toUpperCase() })} required />
            <button type="submit" data-testid="defect-create">Add defect</button>
          </form>
        </section>
      )}

      {masters && (
        <section className="panel" data-testid="admin-versioned">
          <h2>Conversions · grades · handling</h2>
          <form className="inline-form" data-testid="conversion-form" onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => apiPost('/catalog/admin/conversions', {
              fromUomId: conversionForm.fromUomId, toUomId: conversionForm.toUomId,
              factor: Number(conversionForm.factor), effectiveFrom: new Date().toISOString(),
              activate: true, changeReason: 'admin-ui'
            }), 'Conversion version created');
          }}>
            <select data-testid="conv-from" style={selectStyle} value={conversionForm.fromUomId} onChange={(e) => setConversionForm({ ...conversionForm, fromUomId: e.target.value })} required>
              <option value="">From…</option>
              {masters.units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
            </select>
            <select data-testid="conv-to" style={selectStyle} value={conversionForm.toUomId} onChange={(e) => setConversionForm({ ...conversionForm, toUomId: e.target.value })} required>
              <option value="">To…</option>
              {masters.units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
            </select>
            <input data-testid="conv-factor" placeholder="factor" inputMode="decimal" value={conversionForm.factor} onChange={(e) => setConversionForm({ ...conversionForm, factor: e.target.value })} required />
            <button type="submit" data-testid="conv-create">Add conversion</button>
          </form>
          <form className="inline-form" data-testid="grade-form" onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => apiPost('/catalog/admin/grade-profiles', {
              commodityId: gradeForm.commodityId, gradeCode: gradeForm.gradeCode,
              rules: [{ attribute: 'stem_length_cm', op: 'MIN', min: Number(gradeForm.minStemLength) }],
              effectiveFrom: new Date().toISOString(), activate: false, validationStatus: 'DEMO'
            }), 'Grade profile version created (DRAFT)');
          }}>
            <select data-testid="grade-product" style={selectStyle} value={gradeForm.commodityId} onChange={(e) => setGradeForm({ ...gradeForm, commodityId: e.target.value })} required>
              <option value="">Product…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input data-testid="grade-code" placeholder="Grade code (A/B…)" value={gradeForm.gradeCode} onChange={(e) => setGradeForm({ ...gradeForm, gradeCode: e.target.value })} required />
            <input data-testid="grade-minstem" placeholder="Min stem cm" inputMode="numeric" value={gradeForm.minStemLength} onChange={(e) => setGradeForm({ ...gradeForm, minStemLength: e.target.value })} required />
            <button type="submit" data-testid="grade-create">New grade version</button>
          </form>
          <form className="inline-form" data-testid="handling-form" onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => apiPost('/catalog/admin/handling-profiles', {
              code: handlingForm.code, tempMinC: Number(handlingForm.tempMinC), tempMaxC: Number(handlingForm.tempMaxC),
              effectiveFrom: new Date().toISOString(), activate: false,
              changeReason: handlingForm.changeReason || 'admin-ui', validationStatus: 'DEMO'
            }), 'Handling profile version created (DRAFT, DEMO)');
          }}>
            <input data-testid="handling-code" placeholder="PROFILE_CODE" value={handlingForm.code} onChange={(e) => setHandlingForm({ ...handlingForm, code: e.target.value.toUpperCase() })} required />
            <input data-testid="handling-tmin" placeholder="Temp min °C" inputMode="decimal" value={handlingForm.tempMinC} onChange={(e) => setHandlingForm({ ...handlingForm, tempMinC: e.target.value })} required />
            <input data-testid="handling-tmax" placeholder="Temp max °C" inputMode="decimal" value={handlingForm.tempMaxC} onChange={(e) => setHandlingForm({ ...handlingForm, tempMaxC: e.target.value })} required />
            <input data-testid="handling-reason" placeholder="Change reason" value={handlingForm.changeReason} onChange={(e) => setHandlingForm({ ...handlingForm, changeReason: e.target.value })} />
            <button type="submit" data-testid="handling-create">New handling version</button>
          </form>
          <p className="hint">All admin-created standards are DEMO until validated. New writes auto-increment version_no; overlapping ACTIVE windows are rejected.</p>
        </section>
      )}

      <section className="panel" data-testid="admin-versions">
        <h2>Version history</h2>
        <div className="inline-form">
          <select data-testid="versions-entity" value={versionEntity} onChange={(e) => setVersionEntity(e.target.value)}>
            {VERSIONED_ENTITIES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <button className="ghost-btn" data-testid="versions-load" onClick={() => void run(async () => {
            setVersions((await apiGet<{ items: VersionRow[] }>(`/catalog/admin/versions/${versionEntity}`)).items);
          }, 'Versions loaded')}>Load</button>
        </div>
        <ul className="plain-list" data-testid="versions-list">
          {versions.map((v, i) => (
            <li key={i}><code>{JSON.stringify(v)}</code></li>
          ))}
        </ul>
      </section>

      {notice && <p className="form-ok" data-testid="catalog-admin-notice">{notice}</p>}
      {error && <p className="form-error" data-testid="catalog-admin-error">{error}</p>}
    </main>
  );
}
