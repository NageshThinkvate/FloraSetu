// PRE-PHASE-3 GATE (ADR-011): supplier-declaration quality model (no fake QC),
// actual-lot photo/video evidence, buyer receipt evidence, claim linkage,
// logistics partner jobs (partner admin + driver + non-driver modes), POD,
// partner exceptions feeding Operations, cross-org isolation, audit retention.
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { bootTestApp, TestApp } from './helpers';

const password = 'Sup3rSecret99';
const RUN = randomUUID().slice(0, 8);
const FUTURE = new Date(Date.now() + 30 * 24 * 3600e3).toISOString();
const PAST = new Date(Date.now() - 3600e3).toISOString();
const idem = (label: string) => `p3-${RUN}-${label}`;
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const MP4_B64 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=';
const expectOk = (status: number): void => { expect([200, 201]).toContain(status); };

interface User { userId: string; accessToken: string; platformOrgId?: string }

describe('GATE Pre-Phase-3: quality basis + logistics partner (ADR-011)', () => {
  let t: TestApp;
  let pool: Pool;

  const email = (label: string) => `${label}.${RUN}@test.florasetu.local`;
  const register = async (label: string): Promise<User> => {
    const res = await t.http.post('/api/auth/register').send({ email: email(label), password, displayName: label });
    expectOk(res.status);
    return { userId: res.body.userId as string, accessToken: res.body.accessToken as string };
  };
  const makePlatformUser = async (label: string, role: string): Promise<User> => {
    const u = await register(label);
    await pool.query(
      `INSERT INTO identity.org_memberships (org_id, user_id, status)
       SELECT o.id, $1, 'ACTIVE' FROM identity.organizations o WHERE o.ref = 'TEST-PLATFORM' ON CONFLICT DO NOTHING`,
      [u.userId]);
    await pool.query(
      `INSERT INTO identity.user_roles (user_id, role_id, org_id)
       SELECT $1, r.id, o.id FROM identity.roles r, identity.organizations o
       WHERE r.name = $2 AND r.org_id IS NULL AND o.ref = 'TEST-PLATFORM' ON CONFLICT DO NOTHING`,
      [u.userId, role]);
    const p = await pool.query<{ id: string }>(`SELECT id FROM identity.organizations WHERE ref = 'TEST-PLATFORM'`);
    return { ...u, platformOrgId: p.rows[0].id };
  };
  const createOrg = async (token: string, name: string, category: string): Promise<string> => {
    const res = await t.http.post('/api/orgs').set('Authorization', `Bearer ${token}`).send({ name, category });
    expectOk(res.status);
    return res.body.id as string;
  };
  const asOrg = (token: string, orgId: string) => ({ Authorization: `Bearer ${token}`, 'x-org-id': orgId });

  let admin: User; let ops: User; let buyer: User; let sup: User; let partner: User; let driver: User; let outsider: User;
  let buyerOrg: string; let supOrg: string; let partnerOrg: string; let outsiderOrg: string;
  let stemUom: string; let productId: string; let varietyId: string;

  const asAdmin = () => asOrg(admin.accessToken, admin.platformOrgId as string);
  const asOps = () => asOrg(ops.accessToken, ops.platformOrgId as string);
  const asBuyer = () => asOrg(buyer.accessToken, buyerOrg);
  const asSup = () => asOrg(sup.accessToken, supOrg);
  const asPartner = () => asOrg(partner.accessToken, partnerOrg);
  const asDriver = () => asOrg(driver.accessToken, partnerOrg);
  const asOutsider = () => asOrg(outsider.accessToken, outsiderOrg);

  const upload = (headers: Record<string, string>, contentType = 'image/png', data = PNG_B64) =>
    t.http.post('/api/media').set(headers).send({ contentType, dataBase64: data, bucket: 'pilot' });

  const makeLot = async (label: string, qty = 50): Promise<string> => {
    const lot = await t.http.post('/api/supply/lots/harvest').set(asSup()).set('Idempotency-Key', idem(`${label}-lot`))
      .send({ commodityId: productId, varietyId, declaredQty: qty, uomId: stemUom, originType: 'OWN_FARM', harvestedAt: PAST, farmName: `Farm ${label}` });
    expectOk(lot.status);
    return lot.body.id as string;
  };
  const attachEvidence = async (lotId: string, purpose: string, contentType = 'image/png', data = PNG_B64): Promise<number> => {
    const up = await upload(asSup(), contentType, data);
    expectOk(up.status);
    const res = await t.http.post(`/api/supply/lots/${lotId}/media`).set(asSup())
      .send({ mediaObjectId: up.body.id, purpose });
    return res.status;
  };

  // Slim award→order chain (mirrors build4 patterns).
  const orderedChain = async (label: string, qty = 40): Promise<{ orderId: string; salLineId: string }> => {
    const req = await t.http.post('/api/demand/requirements').set(asBuyer()).send({
      mode: 'FORMAL', title: `P3 ${label} ${RUN}`,
      lines: [{ commodityId: productId, quantity: qty, uomId: stemUom, neededAt: FUTURE, deliveryDestination: `Dest ${label}` }]
    });
    expectOk(req.status);
    const reqId = req.body.id as string;
    expectOk((await t.http.post(`/api/demand/requirements/${reqId}/submit`).set(asBuyer()).set('Idempotency-Key', idem(`${label}-sub`))).status);
    const pub = await t.http.post(`/api/demand/requirements/${reqId}/publish-rfq`).set(asBuyer())
      .set('Idempotency-Key', idem(`${label}-pub`)).send({ supplierOrgIds: [supOrg], quoteDeadline: FUTURE });
    expectOk(pub.status);
    const rfqId = pub.body.id as string;
    const detail = await t.http.get(`/api/demand/rfqs/${rfqId}`).set(asBuyer());
    const lineId = detail.body.lines[0].requirement_line_id as string;
    const quote = await t.http.post(`/api/demand/rfqs/${rfqId}/quotes`).set(asSup())
      .set('Idempotency-Key', idem(`${label}-q`))
      .send({ validTo: FUTURE, lines: [{ requirementLineId: lineId, quotedQty: qty, quotedUomId: stemUom, unitPriceMinor: 42000 }] });
    expectOk(quote.status);
    const award = await t.http.post(`/api/demand/rfqs/${rfqId}/awards`).set(asBuyer())
      .set('Idempotency-Key', idem(`${label}-aw`))
      .send({ lines: [{ requirementLineId: lineId, quotationVersionId: quote.body.versionId, awardedQty: qty, uomId: stemUom }] });
    expectOk(award.status);
    const conv = await t.http.post('/api/orders/convert-award').set(asBuyer())
      .set('Idempotency-Key', idem(`${label}-conv`)).send({ awardId: award.body.id });
    expectOk(conv.status);
    const orderId = conv.body.id as string;
    const mine = await t.http.get('/api/orders/allocations/mine').set(asSup());
    const alloc = (mine.body.items as { id: string; order_id: string }[]).find((a) => a.order_id === orderId);
    expectOk((await t.http.post(`/api/orders/allocations/${alloc!.id}/confirm`).set(asSup())).status);
    const od = await t.http.get(`/api/orders/${orderId}`).set(asBuyer());
    const salLineId = (od.body.allocationLines as { id: string }[])[0].id;
    return { orderId, salLineId };
  };

  beforeAll(async () => {
    t = await bootTestApp();
    pool = new Pool({ connectionString: t.config.databaseUrl });
    await pool.query(
      `INSERT INTO identity.organizations (ref, name, type) VALUES ('TEST-PLATFORM', 'Test Platform', 'PLATFORM_OPS')
       ON CONFLICT (ref) DO NOTHING`);
    admin = await makePlatformUser('p3admin', 'PLATFORM_ADMIN');
    ops = await makePlatformUser('p3ops', 'PROCUREMENT_OPS');
    buyer = await register('p3buyer');
    sup = await register('p3sup');
    partner = await register('p3partner');
    driver = await register('p3driver');
    outsider = await register('p3out');
    buyerOrg = await createOrg(buyer.accessToken, `P3 Buyer ${RUN}`, 'BUYER');
    supOrg = await createOrg(sup.accessToken, `P3 Grower ${RUN}`, 'GROWER');
    partnerOrg = await createOrg(partner.accessToken, `P3 Logistics ${RUN}`, 'LOGISTICS_PROVIDER');
    outsiderOrg = await createOrg(outsider.accessToken, `P3 Out ${RUN}`, 'BUYER');
    await pool.query(
      `INSERT INTO identity.org_memberships (org_id, user_id, status) VALUES ($1, $2, 'ACTIVE') ON CONFLICT DO NOTHING`,
      [partnerOrg, driver.userId]);

    await pool.query(`INSERT INTO catalog.units_of_measure (code, name) VALUES ('STEM', 'STEM') ON CONFLICT (code) DO NOTHING`);
    stemUom = (await pool.query<{ id: string }>(`SELECT id FROM catalog.units_of_measure WHERE code = 'STEM'`)).rows[0].id;
    const cat = await t.http.post('/api/catalog/admin/categories').set(asAdmin())
      .send({ code: `P3_${RUN.replace(/-/g, '').toUpperCase()}`, name: `PrePhase3 ${RUN}` });
    expectOk(cat.status);
    const product = await t.http.post('/api/catalog/admin/products').set(asAdmin())
      .send({ categoryId: cat.body.id, name: `P3 Rose ${RUN}` });
    expectOk(product.status);
    productId = product.body.id;
    await pool.query(`UPDATE catalog.commodities SET validation_status = 'VALIDATED' WHERE id = $1`, [productId]);
    const variety = await pool.query<{ id: string }>(
      `INSERT INTO catalog.varieties (ref, commodity_id, name, validation_status, status)
       VALUES ($1, $2, $3, 'VALIDATED', 'ACTIVE') RETURNING id`,
      [`VAR-P3-${RUN}`, productId, `P3 Rose Red ${RUN}`]);
    varietyId = variety.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
    await t.app.close();
  });

  it('(Q1) supplier declaration path makes lot AVAILABLE with no inspection at all', async () => {
    const lotId = await makeLot('q1', 50);
    expectOk(await attachEvidence(lotId, 'LOT_ACTUAL'));
    expectOk(await attachEvidence(lotId, 'LOT_ACTUAL'));
    const dec = await t.http.post(`/api/supply/lots/${lotId}/declaration`).set(asSup())
      .send({ declaredStemLengthCm: 55, bloomStage: 'HALF_OPEN', batchRef: `B-${RUN}` });
    expectOk(dec.status);
    expect(dec.body.status).toBe('AVAILABLE');
    expect(dec.body.basis).toBe('SUPPLIER_DECLARATION');
    const inspections = await pool.query(`SELECT id FROM quality.qc_inspections WHERE lot_id = $1`, [lotId]);
    expect(inspections.rowCount).toBe(0);
    const lot = await t.http.get(`/api/supply/lots/${lotId}`).set(asSup());
    expect(lot.body.status).toBe('AVAILABLE');
    expect(Number(lot.body.available_qty)).toBe(50);
    expect(lot.body.quality_basis).toBe('SUPPLIER_DECLARATION');
    expect(lot.body.batch_ref).toBe(`B-${RUN}`);
    expect(lot.body.bloom_stage).toBe('HALF_OPEN');
  });

  it('(Q2) declaration requires minimum actual-lot photos (config, default 2)', async () => {
    const lotId = await makeLot('q2', 20);
    expectOk(await attachEvidence(lotId, 'LOT_ACTUAL'));
    const dec = await t.http.post(`/api/supply/lots/${lotId}/declaration`).set(asSup()).send({});
    expect(dec.status).toBe(400);
    expect(dec.body.error.details.code_detail).toBe('EVIDENCE_REQUIRED');
  });

  it('(Q3) LOT_VIDEO requires a video content type; video itself is accepted', async () => {
    const lotId = await makeLot('q3', 20);
    const bad = await attachEvidence(lotId, 'LOT_VIDEO', 'image/png');
    expect(bad).toBe(400);
    const good = await attachEvidence(lotId, 'LOT_VIDEO', 'video/mp4', MP4_B64);
    expectOk(good);
  });

  it('(Q4) THIRD_PARTY_INSPECTION basis rejects the declaration path (no fake QC)', async () => {
    const lotId = await makeLot('q4', 20);
    await pool.query(`UPDATE supply.supply_lots SET quality_basis = 'THIRD_PARTY_INSPECTION' WHERE id = $1`, [lotId]);
    expectOk(await attachEvidence(lotId, 'LOT_ACTUAL'));
    expectOk(await attachEvidence(lotId, 'LOT_ACTUAL'));
    const dec = await t.http.post(`/api/supply/lots/${lotId}/declaration`).set(asSup()).send({});
    expect(dec.status).toBe(409);
  });

  it('(Q5) declared lot allocates + packs with zero inspection (dispatch readiness)', async () => {
    const fx = await orderedChain('q5', 40);
    const lotId = await makeLot('q5', 50);
    expectOk(await attachEvidence(lotId, 'LOT_ACTUAL'));
    expectOk(await attachEvidence(lotId, 'LOT_ACTUAL'));
    expectOk((await t.http.post(`/api/supply/lots/${lotId}/declaration`).set(asSup()).send({})).status);
    const alloc = await t.http.post('/api/orders/allocate').set(asBuyer()).set('Idempotency-Key', idem('q5-al'))
      .send({ supplierAllocationLineId: fx.salLineId, lotId, qty: 40 });
    expectOk(alloc.status);
    const pack = await t.http.post('/api/logistics/pack').set(asSup()).set('Idempotency-Key', idem('q5-pk'))
      .send({ orderId: fx.orderId, supplierAllocationLineId: fx.salLineId, lotId, packedQty: 40, uomId: stemUom, packType: 'CARTON', cartonCount: 2 });
    expectOk(pack.status);
  });

  it('(Q6) buyer sees supplier declaration + evidence after allocation; outsider denied', async () => {
    const fx = await orderedChain('q6', 10);
    const lotId = await makeLot('q6', 20);
    expectOk(await attachEvidence(lotId, 'LOT_ACTUAL'));
    expectOk(await attachEvidence(lotId, 'LOT_ACTUAL'));
    expectOk((await t.http.post(`/api/supply/lots/${lotId}/declaration`).set(asSup())
      .send({ batchRef: `BUY-${RUN}`, bloomStage: 'OPEN' })).status);
    expectOk((await t.http.post('/api/orders/allocate').set(asBuyer()).set('Idempotency-Key', idem('q6-al'))
      .send({ supplierAllocationLineId: fx.salLineId, lotId, qty: 10 })).status);
    const lot = await t.http.get(`/api/supply/lots/${lotId}`).set(asBuyer());
    expectOk(lot.status);
    expect(lot.body.batch_ref).toBe(`BUY-${RUN}`);
    const media = await t.http.get(`/api/supply/lots/${lotId}/media`).set(asBuyer());
    expectOk(media.status);
    expect((media.body.items as unknown[]).length).toBeGreaterThanOrEqual(2);
    const denied = await t.http.get(`/api/supply/lots/${lotId}/media`).set(asOutsider());
    expect(denied.status).toBe(404);
  });

  it('(Q7) buyer receipt evidence attaches and lists at order level', async () => {
    const fx = await orderedChain('q7', 10);
    const up = await upload(asBuyer());
    expectOk(up.status);
    const attach = await t.http.post(`/api/orders/${fx.orderId}/receipt-evidence`).set(asBuyer())
      .send({ mediaObjectId: up.body.id, purpose: 'RECEIPT_EVIDENCE' });
    expectOk(attach.status);
    const list = await t.http.get(`/api/orders/${fx.orderId}/receipt-evidence`).set(asBuyer());
    expectOk(list.status);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].purpose).toBe('RECEIPT_EVIDENCE');
  });

  it('(Q8) claim links buyer evidence (existing claim media contract)', async () => {
    // Claims open only after delivery — drive a full logistics leg to DELIVERED first.
    const fx = await jobChain('q8', 'REEFER_ROAD', true);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/accept`).set(asDriver())).status);
    const pickupUp = await upload(asDriver());
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/pickup`).set(asDriver())
      .send({ awbRef: `AWB-Q8-${RUN}`, mediaObjectId: pickupUp.body.id })).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/transit`).set(asDriver())).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/deliver`).set(asDriver())
      .send({ deliveredQty: 40, receiverName: 'Front Desk' })).status);
    const up = await upload(asBuyer());
    const claim = await t.http.post('/api/claims').set(asBuyer()).set('Idempotency-Key', idem('q8'))
      .send({ orderId: fx.orderId, category: 'QUALITY_MISMATCH', description: 'wilted on arrival', mediaObjectIds: [up.body.id] });
    expectOk(claim.status);
  });

  // ---------- logistics partner jobs ----------

  const jobChain = async (label: string, mode: string, withDriver: boolean) => {
    const fx = await orderedChain(label, 40);
    const lotId = await makeLot(label, 50);
    expectOk(await attachEvidence(lotId, 'LOT_ACTUAL'));
    expectOk(await attachEvidence(lotId, 'LOT_ACTUAL'));
    expectOk((await t.http.post(`/api/supply/lots/${lotId}/declaration`).set(asSup()).send({})).status);
    expectOk((await t.http.post('/api/orders/allocate').set(asBuyer()).set('Idempotency-Key', idem(`${label}-al`))
      .send({ supplierAllocationLineId: fx.salLineId, lotId, qty: 40 })).status);
    expectOk((await t.http.post('/api/logistics/pack').set(asSup()).set('Idempotency-Key', idem(`${label}-pk`))
      .send({ orderId: fx.orderId, supplierAllocationLineId: fx.salLineId, lotId, packedQty: 40, uomId: stemUom, packType: 'CARTON', cartonCount: 2 })).status);
    expectOk((await t.http.post(`/api/orders/${fx.orderId}/transition`).set(asBuyer()).send({ to: 'QC_PACK' })).status);
    expectOk((await t.http.post(`/api/orders/${fx.orderId}/transition`).set(asBuyer()).send({ to: 'READY_FOR_DISPATCH' })).status);
    const shp = await t.http.post('/api/logistics/shipments').set(asBuyer()).set('Idempotency-Key', idem(`${label}-sh`))
      .send({ orderId: fx.orderId, mode, tempControlled: mode === 'REEFER_ROAD', carrierName: 'Partner Co', packageCount: 2 });
    expectOk(shp.status);
    const shipmentId = shp.body.id as string;
    const assign = await t.http.post(`/api/logistics/shipments/${shipmentId}/assign`).set(asOps())
      .send({ logisticsOrgId: partnerOrg, driverUserId: withDriver ? driver.userId : undefined });
    expectOk(assign.status);
    return { ...fx, lotId, shipmentId };
  };

  it('(L1) ops assigns job; partner admin and driver see their jobs; outsider does not', async () => {
    const fx = await jobChain('l1', 'REEFER_ROAD', true);
    const partnerJobs = await t.http.get('/api/logistics/jobs').set(asPartner());
    expectOk(partnerJobs.status);
    expect((partnerJobs.body.items as { id: string }[]).some((j) => j.id === fx.shipmentId)).toBe(true);
    const driverJobs = await t.http.get('/api/logistics/jobs/mine').set(asDriver());
    expect((driverJobs.body.items as { id: string }[]).some((j) => j.id === fx.shipmentId)).toBe(true);
    const outsiderJobs = await t.http.get('/api/logistics/jobs').set(asOutsider());
    expect((outsiderJobs.body.items as unknown[]).length).toBe(0);
    const denied = await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asOutsider());
    expect(denied.status).toBe(404);
  });

  it('(L2) driver flow: accept → pickup (AWB + evidence) → transit → deliver (POD)', async () => {
    const fx = await jobChain('l2', 'REEFER_ROAD', true);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/accept`).set(asDriver())).status);
    const up = await upload(asDriver());
    const pickup = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/pickup`).set(asDriver())
      .send({ awbRef: `AWB-${RUN}`, mediaObjectId: up.body.id });
    expectOk(pickup.status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/transit`).set(asDriver())).status);
    const deliver = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/deliver`).set(asDriver())
      .send({ deliveredQty: 40, receiverName: 'Front Desk' });
    expectOk(deliver.status);
    const job = await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asPartner());
    expect(job.body.status).toBe('DELIVERED');
    expect(job.body.parcel_awb_ref).toBe(`AWB-${RUN}`);
    expect((job.body.pods as unknown[]).length).toBe(1);
    expect((job.body.media as unknown[]).length).toBeGreaterThanOrEqual(1);
    const order = await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer());
    expect(['DELIVERED', 'ACCEPTANCE_PENDING']).toContain(order.body.status);
  });

  it('(L3) non-driver BUS_PARCEL job works without any driver assignment', async () => {
    const fx = await jobChain('l3', 'BUS_PARCEL', false);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/accept`).set(asPartner())).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/pickup`).set(asPartner())
      .send({ awbRef: `BUS-${RUN}` })).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/transit`).set(asPartner())).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/deliver`).set(asPartner())
      .send({ deliveredQty: 40, receiverName: 'Parcel Desk' })).status);
  });

  it('(L4) partner exception reaches Operations without auto-blocking anything', async () => {
    const fx = await jobChain('l4', 'REEFER_ROAD', true);
    const ex = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/exception`).set(asDriver())
      .send({ type: 'VEHICLE_BREAKDOWN', note: 'flat tyre on NH-44' });
    expectOk(ex.status);
    const asOpsView = await t.http.get(`/api/logistics/shipments/${fx.shipmentId}`).set(asOps());
    const found = (asOpsView.body.exceptions as { id: string; type: string; status: string }[])
      .find((e) => e.id === ex.body.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe('OPEN');
    const row = await pool.query<{ blocks_buyer_acceptance: boolean; blocks_supplier_settlement: boolean }>(
      `SELECT blocks_buyer_acceptance, blocks_supplier_settlement FROM logistics.shipment_exceptions WHERE id = $1`, [ex.body.id]);
    expect(row.rows[0].blocks_buyer_acceptance).toBe(false);
    expect(row.rows[0].blocks_supplier_settlement).toBe(false);
  });

  it('(L5) audit history retained for declaration + assignment', async () => {
    const lotId = await makeLot('l5', 10);
    expectOk(await attachEvidence(lotId, 'LOT_ACTUAL'));
    expectOk(await attachEvidence(lotId, 'LOT_ACTUAL'));
    expectOk((await t.http.post(`/api/supply/lots/${lotId}/declaration`).set(asSup()).send({})).status);
    const audit = await pool.query(
      `SELECT action FROM core.audit_events WHERE object_id = $1 AND action = 'lot.declare'`, [lotId]);
    expect(audit.rowCount).toBe(1);
  });

  // ---------- Phase 3 buyer surfaces (B3 comparison enrichment + evidence pack) ----------

  it('(P1) comparison shows supplier organization name and verification status', async () => {
    const req = await t.http.post('/api/demand/requirements').set(asBuyer()).send({
      mode: 'FORMAL', title: `P3 cmp ${RUN}`,
      lines: [{ commodityId: productId, quantity: 10, uomId: stemUom, neededAt: FUTURE, deliveryDestination: 'Cmp Dest' }]
    });
    expectOk(req.status);
    const reqId = req.body.id as string;
    expectOk((await t.http.post(`/api/demand/requirements/${reqId}/submit`).set(asBuyer()).set('Idempotency-Key', idem('p1-sub'))).status);
    const pub = await t.http.post(`/api/demand/requirements/${reqId}/publish-rfq`).set(asBuyer())
      .set('Idempotency-Key', idem('p1-pub')).send({ supplierOrgIds: [supOrg], quoteDeadline: FUTURE });
    expectOk(pub.status);
    const rfqId = pub.body.id as string;
    const detail = await t.http.get(`/api/demand/rfqs/${rfqId}`).set(asBuyer());
    const lineId = detail.body.lines[0].requirement_line_id as string;
    expectOk((await t.http.post(`/api/demand/rfqs/${rfqId}/quotes`).set(asSup())
      .set('Idempotency-Key', idem('p1-q'))
      .send({ validTo: FUTURE, lines: [{ requirementLineId: lineId, quotedQty: 10, quotedUomId: stemUom, unitPriceMinor: 42000 }] })).status);
    const cmp = await t.http.get(`/api/demand/rfqs/${rfqId}/comparison`).set(asBuyer());
    expectOk(cmp.status);
    const offers = cmp.body.offers as { supplier_org_name: string | null; supplier_kyb_status: string | null }[];
    expect(offers.length).toBe(1);
    expect(offers[0].supplier_org_name).toBe(`P3 Grower ${RUN}`);
    expect(offers[0].supplier_kyb_status).toBeDefined();
  });

  it('(P2) buyer evidence pack composes the full trust chain; outsider denied', async () => {
    const fx = await jobChain('p2', 'REEFER_ROAD', true);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/accept`).set(asDriver())).status);
    const pk = await upload(asDriver());
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/pickup`).set(asDriver())
      .send({ awbRef: `AWB-P2-${RUN}`, mediaObjectId: pk.body.id })).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/transit`).set(asDriver())).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/deliver`).set(asDriver())
      .send({ deliveredQty: 40, receiverName: 'Front Desk' })).status);
    const up = await upload(asBuyer());
    expectOk((await t.http.post(`/api/orders/${fx.orderId}/receipt-evidence`).set(asBuyer())
      .send({ mediaObjectId: up.body.id, purpose: 'RECEIPT_EVIDENCE' })).status);
    const pack = await t.http.get(`/api/orders/${fx.orderId}/evidence-pack`).set(asBuyer());
    expectOk(pack.status);
    expect(pack.body.order.id).toBe(fx.orderId);
    const lots = pack.body.lots as { qualityBasis: string; media: unknown[]; batchRef: string | null }[];
    expect(lots.length).toBeGreaterThanOrEqual(1);
    expect(lots[0].qualityBasis).toBe('SUPPLIER_DECLARATION');
    expect(lots[0].media.length).toBeGreaterThanOrEqual(2);
    expect((pack.body.packs as unknown[]).length).toBe(1);
    const shipments = pack.body.shipments as { pods: unknown[]; media: unknown[] }[];
    expect(shipments.length).toBe(1);
    expect(shipments[0].pods.length).toBe(1);
    expect(shipments[0].media.length).toBeGreaterThanOrEqual(1);
    expect((pack.body.receipt.items as unknown[]).length).toBe(1);
    const denied = await t.http.get(`/api/orders/${fx.orderId}/evidence-pack`).set(asOutsider());
    expect(denied.status).toBe(404);
  });
});
