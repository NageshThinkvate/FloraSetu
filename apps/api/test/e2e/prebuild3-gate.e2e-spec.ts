// PRE-BUILD-3 CONTROL GATE: OD-07 (explicit commercial UoM) + OD-08 (validation
// lifecycle with separate reviewer). Tests F-1..F-7 from the control gate.
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { bootTestApp, TestApp } from './helpers';

const password = 'Sup3rSecret99';
const RUN = randomUUID().slice(0, 8);

describe('GATE Pre-Build-3: OD-07 commercial UoM + OD-08 validation lifecycle', () => {
  let t: TestApp;
  let pool: Pool;

  const email = (label: string) => `${label}.${RUN}@test.florasetu.local`;
  const register = async (label: string) => {
    const e = email(label);
    const res = await t.http.post('/api/auth/register').send({ email: e, password, displayName: label });
    expect(res.status).toBe(201);
    return { userId: res.body.userId as string, accessToken: res.body.accessToken as string };
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
  const asOrg = (token: string, orgId: string) => ({ Authorization: `Bearer ${token}`, 'x-org-id': orgId });

  let mgr: { userId: string; accessToken: string; platformOrgId: string };
  let validator: { userId: string; accessToken: string; platformOrgId: string };
  let stemUom: string;
  let bunchUom: string;
  let catId: string;
  let productId: string;
  let conversionId: string;
  let gradeV1Id: string;

  const admin = () => asOrg(mgr.accessToken, mgr.platformOrgId);
  const reviewer = () => asOrg(validator.accessToken, validator.platformOrgId);

  beforeAll(async () => {
    t = await bootTestApp();
    pool = new Pool({ connectionString: t.config.databaseUrl });
    await pool.query(
      `INSERT INTO identity.organizations (ref, name, type) VALUES ('TEST-PLATFORM', 'Test Platform', 'PLATFORM_OPS')
       ON CONFLICT (ref) DO NOTHING`
    );
    mgr = await makePlatformUser('g3mgr', 'CATALOG_MANAGER');
    // mgr also holds the validator role so F6 exercises the service-level
    // self-approval block (not merely the missing-permission guard).
    await pool.query(
      `INSERT INTO identity.user_roles (user_id, role_id, org_id)
       SELECT $1, r.id, o.id FROM identity.roles r, identity.organizations o
       WHERE r.name = 'CATALOG_VALIDATOR' AND r.org_id IS NULL AND o.ref = 'TEST-PLATFORM' ON CONFLICT DO NOTHING`,
      [mgr.userId]
    );
    validator = await makePlatformUser('g3validator', 'CATALOG_VALIDATOR');

    for (const code of ['STEM', 'BUNCH']) {
      await pool.query(`INSERT INTO catalog.units_of_measure (code, name) VALUES ($1, $1) ON CONFLICT (code) DO NOTHING`, [code]);
    }
    await pool.query(
      `INSERT INTO catalog.quality_attributes (code, name, data_type) VALUES ('stem_length_cm', 'stem', 'NUMERIC')
       ON CONFLICT (code) DO NOTHING`
    );
    const uomId = async (code: string) =>
      (await pool.query<{ id: string }>(`SELECT id FROM catalog.units_of_measure WHERE code = $1`, [code])).rows[0].id;
    stemUom = await uomId('STEM');
    bunchUom = await uomId('BUNCH');

    const cat = await t.http.post('/api/catalog/admin/categories').set(admin())
      .send({ code: `G3_${RUN.replace(/-/g, '').toUpperCase()}`, name: `Gate3 ${RUN}` });
    expect(cat.status).toBe(201);
    catId = cat.body.id;

    const product = await t.http.post('/api/catalog/admin/products').set(admin())
      .send({ categoryId: catId, name: `Gate3 Rose ${RUN}`, preferredOrderUomId: bunchUom });
    expect(product.status).toBe(201);
    productId = product.body.id;

    const conv = await t.http.post('/api/catalog/admin/conversions').set(admin()).send({
      commodityId: productId, fromUomId: bunchUom, toUomId: stemUom, factor: 20,
      effectiveFrom: new Date(Date.now() - 3600e3).toISOString(), activate: true
    });
    expect(conv.status).toBe(201);
    conversionId = conv.body.id;

    const grade = await t.http.post('/api/catalog/admin/grade-profiles').set(admin()).send({
      commodityId: productId, gradeCode: 'A', effectiveFrom: new Date(Date.now() - 3600e3).toISOString(),
      rules: [{ attribute: 'stem_length_cm', op: 'MIN', min: 40 }], activate: true, validationStatus: 'DEMO'
    });
    expect(grade.status).toBe(201);
    gradeV1Id = grade.body.id;
  });

  afterAll(async () => {
    await pool.end();
    await t.app.close();
  });

  describe('OD-07: explicit commercial UoM', () => {
    it('(F1) commercial line without explicit uomId is rejected even when a preferred UoM exists', async () => {
      const res = await t.http.post('/api/catalog/commercial-line/validate').set(admin())
        .send({ commodityId: productId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('(F2) preferred UoM is exposed for preselection but never replaces the submitted uomId', async () => {
      const res = await t.http.post('/api/catalog/commercial-line/validate').set(admin())
        .send({ commodityId: productId, uomId: stemUom });
      expect(res.status).toBe(201);
      expect(res.body.valid).toBe(true);
      expect(res.body.submittedUomId).toBe(stemUom);
      expect(res.body.preferredOrderUomId).toBe(bunchUom);
    });

    it('(F3) normalization preserves supplier original qty/uom and records conversion version', async () => {
      const res = await t.http.post('/api/catalog/normalize-preview').set(admin())
        .send({ commodityId: productId, qty: 3, uomId: bunchUom, targetUomId: stemUom });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        originalQty: 3,
        originalUomId: bunchUom,
        conversionVersionId: conversionId,
        conversionVersionNo: 1,
        normalizedQty: 60,
        normalizedUomId: stemUom
      });
      // original commercial quantity is never overwritten — the conversion row is untouched
      const convRow = await pool.query(`SELECT factor FROM catalog.unit_conversions WHERE id = $1`, [conversionId]);
      expect(Number(convRow.rows[0].factor)).toBe(20);
      const noConv = await t.http.post('/api/catalog/normalize-preview').set(admin())
        .send({ commodityId: productId, qty: 3, uomId: stemUom, targetUomId: bunchUom });
      expect(noConv.status).toBe(400);
    });
  });

  describe('OD-08: validation lifecycle (DEMO → PENDING_REVIEW → VALIDATED/REJECTED)', () => {
    it('(F4) DEMO master is rejected by the production commercial-use validator', async () => {
      const res = await t.http.get(`/api/catalog/commercial-check/grade_profiles/${gradeV1Id}`).set(admin());
      expect(res.status).toBe(200);
      expect(res.body.usable).toBe(false);
      expect(res.body.validationStatus).toBe('DEMO');
      expect(res.body.reasons.join(' ')).toContain('DEMO');
    });

    it('(F6) reviewer cannot self-approve (validator ≠ proposer on protected masters)', async () => {
      const req = await t.http.post(`/api/catalog/admin/grade_profiles/${gradeV1Id}/request-validation`).set(admin());
      expect(req.status).toBe(201);
      expect(req.body.validationStatus).toBe('PENDING_REVIEW');
      const selfApprove = await t.http.post(`/api/catalog/admin/grade_profiles/${gradeV1Id}/review-validation`)
        .set(admin()).send({ decision: 'VALIDATED' });
      expect(selfApprove.status).toBe(403);
      expect(selfApprove.body.error.details?.code_detail).toBe('SELF_APPROVAL');
      // and a non-privileged user cannot review at all
      const outsider = await register('g3outsider');
      const outsiderOrg = await t.http.post('/api/orgs').set('Authorization', `Bearer ${outsider.accessToken}`)
        .send({ name: `Outsider ${RUN}`, category: 'BUYER' });
      const denied = await t.http.post(`/api/catalog/admin/grade_profiles/${gradeV1Id}/review-validation`)
        .set(asOrg(outsider.accessToken, outsiderOrg.body.id)).send({ decision: 'VALIDATED' });
      expect(denied.status).toBe(403);
    });

    it('(F5) separate reviewer validates → ACTIVE+VALIDATED master passes commercial check', async () => {
      const review = await t.http.post(`/api/catalog/admin/grade_profiles/${gradeV1Id}/review-validation`)
        .set(reviewer())
        .send({ decision: 'VALIDATED', reference: 'field-report-001', notes: 'ranges verified with growers' });
      expect(review.status).toBe(201);
      expect(review.body.validationStatus).toBe('VALIDATED');
      const check = await t.http.get(`/api/catalog/commercial-check/grade_profiles/${gradeV1Id}`).set(admin());
      expect(check.body.usable).toBe(true);
      // audit trail of the workflow
      const audits = await pool.query(
        `SELECT action FROM core.audit_events WHERE object_id = $1 ORDER BY occurred_at`, [gradeV1Id]);
      expect(audits.rows.map((r) => r.action)).toEqual(expect.arrayContaining([
        'catalog.grade_profiles.validation.request', 'catalog.grade_profiles.validation.review'
      ]));
      const row = await pool.query(
        `SELECT requested_by, reviewed_by, validation_reference FROM catalog.grade_profiles WHERE id = $1`, [gradeV1Id]);
      expect(row.rows[0].requested_by).toBe(mgr.userId);
      expect(row.rows[0].reviewed_by).toBe(validator.userId);
      expect(row.rows[0].validation_reference).toBe('field-report-001');
    });

    it('(F7) retired VALIDATED historical version still resolves but is not commercially usable', async () => {
      const retire = await t.http.patch(`/api/catalog/admin/grade_profiles/${gradeV1Id}/status`).set(admin())
        .send({ status: 'RETIRED', reason: 'superseded by v2' });
      expect(retire.status).toBe(200);
      // historical resolution intact
      const versions = await t.http.get('/api/catalog/admin/versions/grade_profiles').set(admin());
      const mine = versions.body.items.find((r: { id: string }) => r.id === gradeV1Id);
      expect(mine).toMatchObject({ status: 'RETIRED', validation_status: 'VALIDATED' });
      const check = await t.http.get(`/api/catalog/commercial-check/grade_profiles/${gradeV1Id}`).set(admin());
      expect(check.body.usable).toBe(false);
      expect(check.body.reasons.join(' ')).toContain('RETIRED');
    });

    it('rejection requires a reason and returns to REJECTED state', async () => {
      const conv = await t.http.post(`/api/catalog/admin/unit_conversions/${conversionId}/request-validation`).set(admin());
      expect(conv.status).toBe(201);
      const noReason = await t.http.post(`/api/catalog/admin/unit_conversions/${conversionId}/review-validation`)
        .set(reviewer()).send({ decision: 'REJECTED' });
      expect(noReason.status).toBe(400);
      const rejected = await t.http.post(`/api/catalog/admin/unit_conversions/${conversionId}/review-validation`)
        .set(reviewer()).send({ decision: 'REJECTED', rejectionReason: 'unverified pack standard' });
      expect(rejected.status).toBe(201);
      const check = await t.http.get(`/api/catalog/commercial-check/unit_conversions/${conversionId}`).set(admin());
      expect(check.body.usable).toBe(false);
    });
  });
});
