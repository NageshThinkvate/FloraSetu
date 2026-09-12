// BUILD 2 GATE: Catalog & Standards — canonical model, aliasing, versioning,
// UOM conversions, grade/handling profiles, authz, search, audit, classification.
// Run-unique fixtures keep the suite idempotent regardless of leftover DB state.
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { bootTestApp, TestApp } from './helpers';

const password = 'Sup3rSecret99';
const RUN = randomUUID().slice(0, 8);

describe('GATE Build 2: catalog & standards', () => {
  let t: TestApp;
  let pool: Pool;

  const email = (label: string) => `${label}.${RUN}@test.florasetu.local`;
  const register = async (label: string) => {
    const e = email(label);
    const res = await t.http.post('/api/auth/register').send({ email: e, password, displayName: label });
    expect(res.status).toBe(201);
    return { userId: res.body.userId as string, accessToken: res.body.accessToken as string, email: e };
  };
  const makePlatformUser = async (label: string, role: string) => {
    const u = await register(label);
    await pool.query(
      `INSERT INTO identity.org_memberships (org_id, user_id, status)
       SELECT o.id, $1, 'ACTIVE' FROM identity.organizations o WHERE o.ref = 'TEST-PLATFORM' ON CONFLICT DO NOTHING`,
      [u.userId]
    );
    await pool.query(
      `INSERT INTO identity.user_roles (user_id, role_id, org_id)
       SELECT $1, r.id, o.id FROM identity.roles r, identity.organizations o
       WHERE r.name = $2 AND r.org_id IS NULL AND o.ref = 'TEST-PLATFORM' ON CONFLICT DO NOTHING`,
      [u.userId, role]
    );
    const p = await pool.query<{ id: string }>(`SELECT id FROM identity.organizations WHERE ref = 'TEST-PLATFORM'`);
    return { ...u, platformOrgId: p.rows[0].id };
  };
  const createOrg = async (token: string, name: string, category: string) => {
    const res = await t.http.post('/api/orgs').set('Authorization', `Bearer ${token}`).send({ name, category });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const asOrg = (token: string, orgId: string) => ({ Authorization: `Bearer ${token}`, 'x-org-id': orgId });

  let mgr: { userId: string; accessToken: string; platformOrgId: string };
  let buyer: { userId: string; accessToken: string };
  let grower: { userId: string; accessToken: string };
  let buyerOrgId: string;
  let growerOrgId: string;
  let catId: string;
  let productId: string;
  let lisianthusId: string;
  let varietyId: string;
  let stemUom: string;
  let bunchUom: string;
  let gramUom: string;
  let handlingV1Id: string;
  let handlingV2Id: string;

  const roseName = `Premium Rose ${RUN}`;
  const lisName = `Lisianthus ${RUN}`;
  const roseCommercial = `Dutch Rose ${RUN}`;
  const lisAlias = `Eustoma ${RUN}`;
  const hpCode = `HP_${RUN.replace(/-/g, '').toUpperCase()}`;
  const hpTestCode = `HT_${RUN.replace(/-/g, '').toUpperCase()}`;

  const admin = () => asOrg(mgr.accessToken, mgr.platformOrgId);

  beforeAll(async () => {
    t = await bootTestApp();
    pool = new Pool({ connectionString: t.config.databaseUrl });
    await pool.query(
      `INSERT INTO identity.organizations (ref, name, type) VALUES ('TEST-PLATFORM', 'Test Platform', 'PLATFORM_OPS')
       ON CONFLICT (ref) DO NOTHING`
    );
    mgr = await makePlatformUser('catalogmgr', 'CATALOG_MANAGER');
    buyer = await register('b2buyer');
    grower = await register('b2grower');
    buyerOrgId = await createOrg(buyer.accessToken, `B2 Buyer ${RUN}`, 'BUYER');
    growerOrgId = await createOrg(grower.accessToken, `B2 Grower ${RUN}`, 'GROWER');

    // Shared masters via idempotent SQL upsert (API creation is covered by admin tests).
    for (const code of ['STEM', 'BUNCH', 'GRAM']) {
      await pool.query(`INSERT INTO catalog.units_of_measure (code, name) VALUES ($1, $1) ON CONFLICT (code) DO NOTHING`, [code]);
    }
    for (const [code, type] of [['stem_length_cm', 'NUMERIC'], ['damage_free', 'BOOLEAN']]) {
      await pool.query(
        `INSERT INTO catalog.quality_attributes (code, name, data_type) VALUES ($1, $1, $2) ON CONFLICT (code) DO NOTHING`,
        [code, type]
      );
    }
    const uomId = async (code: string) =>
      (await pool.query<{ id: string }>(`SELECT id FROM catalog.units_of_measure WHERE code = $1`, [code])).rows[0].id;
    stemUom = await uomId('STEM');
    bunchUom = await uomId('BUNCH');
    gramUom = await uomId('GRAM');

    const cat = await t.http.post('/api/catalog/admin/categories').set(admin())
      .send({ code: `FLOWER_${RUN.replace(/-/g, '').toUpperCase()}`, name: `Flower ${RUN}` });
    expect(cat.status).toBe(201);
    catId = cat.body.id;

    const mkProduct = async (name: string, commercialName?: string) => {
      const r = await t.http.post('/api/catalog/admin/products').set(admin())
        .send({ categoryId: catId, name, commercialName, botanicalName: `${name} bot.` });
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    productId = await mkProduct(roseName, roseCommercial);
    lisianthusId = await mkProduct(lisName);
    const alias = await t.http.post('/api/catalog/admin/aliases').set(admin())
      .send({ commodityId: lisianthusId, alias: lisAlias, aliasType: 'BOTANICAL' });
    expect(alias.status).toBe(201);
    const v = await t.http.post('/api/catalog/admin/varieties').set(admin())
      .send({ commodityId: productId, name: `Red Naomi ${RUN}`, stemLengthCmMin: 40, stemLengthCmMax: 80 });
    expect(v.status).toBe(201);
    varietyId = v.body.id;
  });

  afterAll(async () => {
    await pool.end();
    await t.app.close();
  });

  describe('search & canonical alias resolution', () => {
    it('(19) search by commercial synonym finds the product', async () => {
      const res = await t.http.get(`/api/catalog/search?q=${encodeURIComponent(roseCommercial)}`)
        .set(asOrg(buyer.accessToken, buyerOrgId));
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { name: string }) => i.name)).toContain(roseName);
    });

    it('(1,20) alias search resolves to the single canonical product', async () => {
      const res = await t.http.get(`/api/catalog/search?q=${encodeURIComponent(lisAlias)}`)
        .set(asOrg(buyer.accessToken, buyerOrgId));
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe(lisName);
      expect(res.body.items[0].matched_alias).toBe(lisAlias);
    });

    it('(2,18) duplicate alias rejected; aliases never create products', async () => {
      const dup = await t.http.post('/api/catalog/admin/aliases').set(admin())
        .send({ commodityId: productId, alias: lisAlias.toLowerCase(), aliasType: 'SYNONYM' });
      expect(dup.status).toBe(409);
      const products = await t.http.get('/api/catalog/products').set(asOrg(buyer.accessToken, buyerOrgId));
      expect(products.body.items.filter((i: { name: string }) => i.name === lisAlias)).toHaveLength(0);
    });
  });

  describe('catalog reads & authorization', () => {
    it('(12) buyer catalog read succeeds', async () => {
      const res = await t.http.get('/api/catalog/products').set(asOrg(buyer.accessToken, buyerOrgId));
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    });

    it('(13) supplier catalog read succeeds', async () => {
      const res = await t.http.get(`/api/catalog/products/${productId}`).set(asOrg(grower.accessToken, growerOrgId));
      expect(res.status).toBe(200);
      expect(res.body.varieties.length).toBeGreaterThanOrEqual(1);
    });

    it('(11,14) buyer and supplier cannot modify platform masters', async () => {
      const asBuyer = await t.http.post('/api/catalog/admin/products').set(asOrg(buyer.accessToken, buyerOrgId))
        .send({ categoryId: catId, name: 'Hijack' });
      expect(asBuyer.status).toBe(403);
      const asSupplier = await t.http.post('/api/catalog/admin/defect-types').set(asOrg(grower.accessToken, growerOrgId))
        .send({ code: 'x', name: 'x', defectClass: 'x' });
      expect(asSupplier.status).toBe(403);
    });

    it('(23) demo vs validated classification is explicit', async () => {
      const masters = await t.http.get('/api/catalog/admin/masters').set(admin());
      expect(masters.body.units.every((u: { data_classification: string }) => u.data_classification === 'VALIDATED')).toBe(true);
      const product = await t.http.get(`/api/catalog/products/${productId}`).set(asOrg(buyer.accessToken, buyerOrgId));
      expect(product.body.data_classification).toBe('DEMO');
    });
  });

  describe('UOM conversions (versioned, product-scoped)', () => {
    it('(3) valid conversion accepted and visible', async () => {
      const res = await t.http.post('/api/catalog/admin/conversions').set(admin()).send({
        commodityId: productId, fromUomId: bunchUom, toUomId: stemUom, factor: 20,
        effectiveFrom: new Date(Date.now() - 3600e3).toISOString(), activate: true
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('ACTIVE');
      const product = await t.http.get(`/api/catalog/products/${productId}`).set(asOrg(buyer.accessToken, buyerOrgId));
      expect(product.body.unitConversions[0]).toMatchObject({ from_uom: 'BUNCH', to_uom: 'STEM', factor: '20.000000' });
    });

    it('(5) zero/negative conversion factors rejected', async () => {
      for (const factor of [0, -5]) {
        const res = await t.http.post('/api/catalog/admin/conversions').set(admin()).send({
          commodityId: productId, fromUomId: stemUom, toUomId: gramUom, factor,
          effectiveFrom: new Date().toISOString()
        });
        expect(res.status).toBe(400);
      }
    });

    it('(4) invalid conversion rejected: same unit, unknown unit, circular chain', async () => {
      const same = await t.http.post('/api/catalog/admin/conversions').set(admin()).send({
        fromUomId: stemUom, toUomId: stemUom, factor: 1, effectiveFrom: new Date().toISOString()
      });
      expect(same.status).toBe(400);
      const unknown = await t.http.post('/api/catalog/admin/conversions').set(admin()).send({
        fromUomId: randomUUID(), toUomId: stemUom, factor: 2, effectiveFrom: new Date().toISOString()
      });
      expect(unknown.status).toBe(400);
      // circular: STEM→BUNCH when BUNCH→STEM active (same scope)
      const circular = await t.http.post('/api/catalog/admin/conversions').set(admin()).send({
        commodityId: productId, fromUomId: stemUom, toUomId: bunchUom, factor: 1,
        effectiveFrom: new Date().toISOString(), activate: true
      });
      expect(circular.status).toBe(400);
    });

    it('(6) historical conversion version preserved after a new version', async () => {
      const v1 = await pool.query(
        `SELECT id FROM catalog.unit_conversions WHERE commodity_id = $1 AND version_no = 1`, [productId]);
      await pool.query(
        `UPDATE catalog.unit_conversions SET effective_to = now() + interval '1 hour' WHERE id = $1`, [v1.rows[0].id]);
      const v2 = await t.http.post('/api/catalog/admin/conversions').set(admin()).send({
        commodityId: productId, fromUomId: bunchUom, toUomId: stemUom, factor: 25,
        effectiveFrom: new Date(Date.now() + 2 * 3600e3).toISOString(), activate: true, changeReason: 'pack standard update'
      });
      expect(v2.status).toBe(201);
      expect(v2.body.version_no).toBe(2);
      const versions = await t.http.get('/api/catalog/admin/versions/unit_conversions').set(admin());
      const mine = versions.body.items.filter((r: { commodity_id: string }) => r.commodity_id === productId);
      expect(mine.map((r: { version_no: number }) => r.version_no).sort()).toEqual([1, 2]);
      expect(mine.find((r: { version_no: number }) => r.version_no === 1).factor).toBe('20.000000');
    });
  });

  describe('grade profiles (versioned, declarative)', () => {
    it('(7,8) grade versions preserved; future version not yet in force', async () => {
      const v1 = await t.http.post('/api/catalog/admin/grade-profiles').set(admin()).send({
        commodityId: productId, gradeCode: 'A', effectiveFrom: new Date(Date.now() - 3600e3).toISOString(),
        effectiveTo: new Date(Date.now() + 24 * 3600e3).toISOString(),
        rules: [{ attribute: 'stem_length_cm', op: 'MIN', min: 40 }], activate: true
      });
      expect(v1.status).toBe(201);
      expect(v1.body.version_no).toBe(1);
      const overlap = await t.http.post('/api/catalog/admin/grade-profiles').set(admin()).send({
        commodityId: productId, gradeCode: 'A', effectiveFrom: new Date().toISOString(),
        rules: [{ attribute: 'stem_length_cm', op: 'MIN', min: 50 }], activate: true
      });
      expect(overlap.status).toBe(409);
      const v2 = await t.http.post('/api/catalog/admin/grade-profiles').set(admin()).send({
        commodityId: productId, gradeCode: 'A',
        effectiveFrom: new Date(Date.now() + 48 * 3600e3).toISOString(),
        rules: [{ attribute: 'stem_length_cm', op: 'MIN', min: 50 }], activate: true,
        changeReason: 'tightened stem length'
      });
      expect(v2.status).toBe(201);
      expect(v2.body.version_no).toBe(2);
      const product = await t.http.get(`/api/catalog/products/${productId}`).set(asOrg(buyer.accessToken, buyerOrgId));
      const grades = product.body.gradeProfiles;
      expect(grades.map((g: { version_no: number }) => g.version_no).sort()).toEqual([1, 2]);
      const future = grades.find((g: { version_no: number }) => g.version_no === 2);
      expect(new Date(future.effective_from).getTime()).toBeGreaterThan(Date.now());
      const current = grades.find((g: { version_no: number }) => g.version_no === 1);
      expect(new Date(current.effective_from).getTime()).toBeLessThan(Date.now());
    });

    it('grade rules referencing unknown attributes rejected', async () => {
      const res = await t.http.post('/api/catalog/admin/grade-profiles').set(admin()).send({
        commodityId: productId, gradeCode: 'B', effectiveFrom: new Date().toISOString(),
        rules: [{ attribute: 'nonexistent_attr', op: 'MIN', min: 1 }]
      });
      expect(res.status).toBe(400);
    });
  });

  describe('handling profiles (versioned; DEMO never presented as validated)', () => {
    it('(10) invalid ranges rejected', async () => {
      const bad = await t.http.post('/api/catalog/admin/handling-profiles').set(admin()).send({
        code: hpTestCode, tempMinC: 8, tempMaxC: 2, effectiveFrom: new Date().toISOString(), dataClassification: 'DEMO'
      });
      expect(bad.status).toBe(400);
      const badHumidity = await t.http.post('/api/catalog/admin/handling-profiles').set(admin()).send({
        code: hpTestCode, humidityMinPct: 10, humidityMaxPct: 130,
        effectiveFrom: new Date().toISOString(), dataClassification: 'DEMO'
      });
      expect(badHumidity.status).toBe(400);
    });

    it('(9) handling profile versions preserved with change reason; transport metadata only', async () => {
      const v1 = await t.http.post('/api/catalog/admin/handling-profiles').set(admin()).send({
        code: hpCode, commodityId: productId, tempMinC: 1, tempMaxC: 4, maxHoldingHours: 72,
        precoolingRequired: true, effectiveFrom: new Date(Date.now() - 3600e3).toISOString(),
        effectiveTo: new Date(Date.now() + 24 * 3600e3).toISOString(), activate: true, dataClassification: 'DEMO'
      });
      expect(v1.status).toBe(201);
      handlingV1Id = v1.body.id;
      const v2 = await t.http.post('/api/catalog/admin/handling-profiles').set(admin()).send({
        code: hpCode, commodityId: productId, tempMinC: 2, tempMaxC: 5, maxHoldingHours: 48,
        precoolingRequired: true, effectiveFrom: new Date(Date.now() + 48 * 3600e3).toISOString(),
        activate: true, changeReason: 'revised demo holding window', dataClassification: 'DEMO'
      });
      expect(v2.status).toBe(201);
      handlingV2Id = v2.body.id;
      const versions = await t.http.get('/api/catalog/admin/versions/handling_profiles').set(admin());
      const mine = versions.body.items.filter((r: { code: string }) => r.code === hpCode);
      expect(mine).toHaveLength(2);
      const old = mine.find((r: { version_no: number }) => r.version_no === 1);
      expect(Number(old.temp_min_c)).toBe(1);
      const rule = await t.http.post('/api/catalog/admin/transport-rules').set(admin()).send({
        profileAId: handlingV1Id, profileBId: handlingV2Id, compatible: true,
        reason: 'same demo group', effectiveFrom: new Date().toISOString()
      });
      expect(rule.status).toBe(201);
    });
  });

  describe('status lifecycle, capabilities, launch flags, audit', () => {
    it('(16,17) inactive definition rejected for new use but still resolvable historically', async () => {
      const cap = await t.http.post('/api/catalog/capabilities').set(asOrg(grower.accessToken, growerOrgId))
        .send({ varietyId, notes: 'we grow this' });
      expect(cap.status).toBe(201);
      const retire = await t.http.patch(`/api/catalog/admin/varieties/${varietyId}/status`).set(admin())
        .send({ status: 'INACTIVE', reason: 'superseded' });
      expect(retire.status).toBe(200);
      const grower2 = await register('b2grower2');
      const grower2Org = await createOrg(grower2.accessToken, `B2 Grower Two ${RUN}`, 'GROWER');
      const rejected = await t.http.post('/api/catalog/capabilities').set(asOrg(grower2.accessToken, grower2Org))
        .send({ varietyId });
      expect(rejected.status).toBe(400);
      const historical = await t.http.get(`/api/catalog/varieties/${varietyId}`).set(asOrg(buyer.accessToken, buyerOrgId));
      expect(historical.status).toBe(200);
      expect(historical.body.status).toBe('INACTIVE');
    });

    it('(15) supplier capabilities are org-scoped (object authz)', async () => {
      const mine = await t.http.get('/api/catalog/capabilities').set(asOrg(grower.accessToken, growerOrgId));
      expect(mine.status).toBe(200);
      expect(mine.body.items.length).toBe(1);
      const capId = mine.body.items[0].id;
      const foreign = await t.http.delete(`/api/catalog/capabilities/${capId}`).set(asOrg(buyer.accessToken, buyerOrgId));
      expect(foreign.status).toBe(404);
    });

    it('(22) launch flags update audited and visible on read', async () => {
      const res = await t.http.patch(`/api/catalog/admin/products/${productId}/launch-flags`).set(admin())
        .send({ launchEnabled: true, launchCities: ['Bengaluru'] });
      expect(res.status).toBe(200);
      const product = await t.http.get(`/api/catalog/products/${productId}`).set(asOrg(buyer.accessToken, buyerOrgId));
      expect(product.body.launch_enabled).toBe(true);
      expect(product.body.launch_cities).toContain('Bengaluru');
    });

    it('(21) master-data changes generate audit events with trace id', async () => {
      const trace = `cat-${randomUUID()}`;
      await t.http.post('/api/catalog/admin/defect-types').set({ ...admin(), 'x-trace-id': trace })
        .send({ code: `test_defect_${randomUUID().slice(0, 6)}`, name: 'T', defectClass: 'PHYSICAL' });
      const rows = await pool.query(
        `SELECT action, actor_user_id, trace_id FROM core.audit_events WHERE trace_id = $1`, [trace]);
      expect(rows.rowCount).toBe(1);
      expect(rows.rows[0]).toMatchObject({ action: 'catalog.defect_type.create', actor_user_id: mgr.userId, trace_id: trace });
    });

    it('unknown DTO fields rejected (whitelist validation)', async () => {
      const res = await t.http.post('/api/catalog/admin/categories').set(admin())
        .send({ code: `ROK_${RUN.replace(/-/g, '').toUpperCase()}`, name: 'ROK', bogusField: true });
      expect(res.status).toBe(400);
    });
  });
});
