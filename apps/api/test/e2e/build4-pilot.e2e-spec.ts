// BUILD 4 GATE: Pilot Fulfilment Core — award→order conversion, supplier allocations,
// supply lots + balance invariants (ADR-001 never-oversell), QC with pinned grade
// profiles + conflict control, packing/dispatch/POD, custody, manual transport,
// temperature-excursion HOLD gating (ADR-002), manual external payments + supplier
// settlements (§22/§23, recorder≠verifier §29, ADR-003 immutability, ADR-004 payout
// freeze), claims lifecycle, control-tower exception queues, tenant isolation/IDOR,
// and the mandatory end-to-end pilot simulation.
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { bootTestApp, TestApp } from './helpers';

const password = 'Sup3rSecret99';
const RUN = randomUUID().slice(0, 8);
const FUTURE = new Date(Date.now() + 30 * 24 * 3600e3).toISOString();
const PAST = new Date(Date.now() - 3600e3).toISOString();
const idem = (label: string) => `b4-${RUN}-${label}`;
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// NestJS returns 201 for POST actions; both 200/201 denote success for mutations.
const expectOk = (status: number): void => { expect([200, 201]).toContain(status); };

interface User { userId: string; accessToken: string; platformOrgId?: string }
interface Chain {
  reqId: string; rfqId: string; lineId: string; versionId: string; awardId: string;
  orderId: string; orderRef: string; allocId: string; salLineId: string;
  lotId?: string; inspectionId?: string; shipmentId?: string;
}

describe('GATE Build 4: pilot fulfilment core', () => {
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
  const createOrg = async (token: string, name: string, category: string): Promise<string> => {
    const res = await t.http.post('/api/orgs').set('Authorization', `Bearer ${token}`).send({ name, category });
    expectOk(res.status);
    return res.body.id as string;
  };
  const asOrg = (token: string, orgId: string) => ({ Authorization: `Bearer ${token}`, 'x-org-id': orgId });

  let admin: User; let ops: User; let qc: User; let fin1: User; let fin2: User;
  let buyer: User; let sup: User; let outsider: User;
  let buyerOrg: string; let supOrg: string; let outsiderOrg: string;
  let stemUom: string; let bunchUom: string; let productId: string; let varietyId: string; let gradeProfileId: string;

  const asAdmin = () => asOrg(admin.accessToken, admin.platformOrgId as string);
  const asOps = () => asOrg(ops.accessToken, ops.platformOrgId as string);
  const asQc = () => asOrg(qc.accessToken, qc.platformOrgId as string);
  const asFin1 = () => asOrg(fin1.accessToken, fin1.platformOrgId as string);
  const asFin2 = () => asOrg(fin2.accessToken, fin2.platformOrgId as string);
  const asBuyer = () => asOrg(buyer.accessToken, buyerOrg);
  const asSup = () => asOrg(sup.accessToken, supOrg);
  const asOutsider = () => asOrg(outsider.accessToken, outsiderOrg);

  // ---- chain helpers: each stage builds on the previous ----
  const awardedChain = async (label: string, qty = 40): Promise<Chain> => {
    const req = await t.http.post('/api/demand/requirements').set(asBuyer()).send({
      mode: 'FORMAL', title: `B4 ${label} ${RUN}`,
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
    return { reqId, rfqId, lineId, versionId: quote.body.versionId, awardId: award.body.id } as Chain;
  };
  const convert = (awardId: string, key: string, headers = asBuyer()) =>
    t.http.post('/api/orders/convert-award').set(headers).set('Idempotency-Key', key).send({ awardId });
  const convertedChain = async (label: string, qty = 40): Promise<Chain> => {
    const fx = await awardedChain(label, qty);
    const conv = await convert(fx.awardId, idem(`${label}-conv`));
    expectOk(conv.status);
    const orderId = conv.body.id as string;
    const mine = await t.http.get('/api/orders/allocations/mine').set(asSup());
    const alloc = (mine.body.items as { id: string; order_id: string }[]).find((a) => a.order_id === orderId);
    const detail = await t.http.get(`/api/orders/${orderId}`).set(asBuyer());
    const salLineId = (detail.body.allocationLines as { id: string }[])[0].id;
    return { ...fx, orderId, orderRef: conv.body.ref, allocId: alloc?.id ?? '', salLineId };
  };
  const confirmAlloc = (allocId: string) =>
    t.http.post(`/api/orders/allocations/${allocId}/confirm`).set(asSup());
  const confirmedChain = async (label: string, qty = 40): Promise<Chain> => {
    const fx = await convertedChain(label, qty);
    expectOk((await confirmAlloc(fx.allocId)).status);
    return fx;
  };
  const makeLot = async (label: string, qty = 50, headers = asSup(), uomId?: string) => {
    const lot = await t.http.post('/api/supply/lots/harvest').set(headers).set('Idempotency-Key', idem(`${label}-lot`))
      .send({ commodityId: productId, varietyId, declaredQty: qty, uomId: uomId ?? stemUom, originType: 'OWN_FARM', harvestedAt: PAST, farmName: `Farm ${label}` });
    expectOk(lot.status);
    return lot.body.id as string;
  };
  const qcLot = async (label: string, lotId: string, accepted: number, rejected = 0, held = 0) => {
    expectOk((await t.http.post(`/api/supply/lots/${lotId}/submit-qc`).set(asSup())).status);
    const ins = await t.http.post('/api/quality/inspections').set(asQc()).send({ lotId, scope: 'SAMPLE' });
    expectOk(ins.status);
    const done = await t.http.post(`/api/quality/inspections/${ins.body.id}/complete`).set(asQc())
      .set('Idempotency-Key', idem(`${label}-qc`))
      .send({ acceptedQty: accepted, rejectedQty: rejected, heldQty: held, gradeResults: [{ gradeProfileId, measurements: { stem_length_cm: 55 } }] });
    expectOk(done.status);
    return ins.body.id as string;
  };
  const suppliedChain = async (label: string, qty = 40, lotQty = 50): Promise<Chain> => {
    const fx = await confirmedChain(label, qty);
    const lotId = await makeLot(label, lotQty);
    const inspectionId = await qcLot(label, lotId, lotQty);
    const alloc = await t.http.post('/api/orders/allocate').set(asBuyer()).set('Idempotency-Key', idem(`${label}-al`))
      .send({ supplierAllocationLineId: fx.salLineId, lotId, qty });
    expectOk(alloc.status);
    return { ...fx, lotId, inspectionId };
  };
  const packedChain = async (label: string, qty = 40): Promise<Chain> => {
    const fx = await suppliedChain(label, qty);
    const pack = await t.http.post('/api/logistics/pack').set(asSup()).set('Idempotency-Key', idem(`${label}-pk`))
      .send({ orderId: fx.orderId, supplierAllocationLineId: fx.salLineId, lotId: fx.lotId, packedQty: qty, uomId: stemUom, packType: 'CARTON', cartonCount: 2 });
    expectOk(pack.status);
    expectOk((await t.http.post(`/api/orders/${fx.orderId}/transition`).set(asBuyer()).send({ to: 'QC_PACK' })).status);
    expectOk((await t.http.post(`/api/orders/${fx.orderId}/transition`).set(asBuyer()).send({ to: 'READY_FOR_DISPATCH' })).status);
    return fx;
  };
  const shippedChain = async (label: string, qty = 40): Promise<Chain> => {
    const fx = await packedChain(label, qty);
    const shp = await t.http.post('/api/logistics/shipments').set(asBuyer()).set('Idempotency-Key', idem(`${label}-sh`))
      .send({ orderId: fx.orderId, mode: 'REEFER_ROAD', tempControlled: true, carrierName: 'Pilot Logistics', packageCount: 2 });
    expectOk(shp.status);
    return { ...fx, shipmentId: shp.body.id as string };
  };
  const deliveredChain = async (label: string, qty = 40): Promise<Chain> => {
    const fx = await shippedChain(label, qty);
    expectOk((await t.http.post(`/api/logistics/shipments/${fx.shipmentId}/dispatch`).set(asBuyer())
      .set('Idempotency-Key', idem(`${label}-di`))).status);
    const pod = await t.http.post(`/api/logistics/shipments/${fx.shipmentId}/pod`).set(asBuyer())
      .set('Idempotency-Key', idem(`${label}-pod`)).send({ deliveredQty: qty, receiverName: 'Receiver One' });
    expectOk(pod.status);
    return fx;
  };
  const acceptedChain = async (label: string, qty = 40): Promise<Chain> => {
    const fx = await deliveredChain(label, qty);
    const acc = await t.http.post(`/api/orders/${fx.orderId}/accept`).set(asBuyer()).send({ acceptedQty: qty });
    expectOk(acc.status);
    expect(acc.body.status).toBe('ACCEPTED');
    return fx;
  };

  beforeAll(async () => {
    t = await bootTestApp();
    pool = new Pool({ connectionString: t.config.databaseUrl });
    await pool.query(
      `INSERT INTO identity.organizations (ref, name, type) VALUES ('TEST-PLATFORM', 'Test Platform', 'PLATFORM_OPS')
       ON CONFLICT (ref) DO NOTHING`
    );
    admin = await makePlatformUser('b4admin', 'PLATFORM_ADMIN');
    ops = await makePlatformUser('b4ops', 'PROCUREMENT_OPS');
    qc = await makePlatformUser('b4qc', 'QC_AGENT');
    fin1 = await makePlatformUser('b4fin1', 'FINANCE_OPS');
    fin2 = await makePlatformUser('b4fin2', 'FINANCE_OPS');
    buyer = await register('b4buyer');
    sup = await register('b4sup');
    outsider = await register('b4outsider');
    buyerOrg = await createOrg(buyer.accessToken, `B4 Buyer ${RUN}`, 'BUYER');
    supOrg = await createOrg(sup.accessToken, `B4 Grower ${RUN}`, 'GROWER');
    outsiderOrg = await createOrg(outsider.accessToken, `B4 Outsider ${RUN}`, 'BUYER');

    await pool.query(`INSERT INTO catalog.units_of_measure (code, name) VALUES ('STEM', 'STEM') ON CONFLICT (code) DO NOTHING`);
    await pool.query(`INSERT INTO catalog.units_of_measure (code, name) VALUES ('BUNCH', 'BUNCH') ON CONFLICT (code) DO NOTHING`);
    stemUom = (await pool.query<{ id: string }>(`SELECT id FROM catalog.units_of_measure WHERE code = 'STEM'`)).rows[0].id;
    bunchUom = (await pool.query<{ id: string }>(`SELECT id FROM catalog.units_of_measure WHERE code = 'BUNCH'`)).rows[0].id;
    const cat = await t.http.post('/api/catalog/admin/categories').set(asAdmin())
      .send({ code: `B4_${RUN.replace(/-/g, '').toUpperCase()}`, name: `Build4 ${RUN}` });
    expectOk(cat.status);
    const product = await t.http.post('/api/catalog/admin/products').set(asAdmin())
      .send({ categoryId: cat.body.id, name: `B4 Rose ${RUN}` });
    expectOk(product.status);
    productId = product.body.id;
    // Test env is fail-closed (no CATALOG_ALLOW_DEMO_MASTERS): masters must be VALIDATED.
    await pool.query(`UPDATE catalog.commodities SET validation_status = 'VALIDATED' WHERE id = $1`, [productId]);
    const conv = await t.http.post('/api/catalog/admin/conversions').set(asAdmin()).send({
      commodityId: productId, fromUomId: bunchUom, toUomId: stemUom, factor: 20,
      effectiveFrom: PAST, activate: true
    });
    expectOk(conv.status);
    await pool.query(`UPDATE catalog.unit_conversions SET validation_status = 'VALIDATED' WHERE id = $1`, [conv.body.id]);
    const variety = await pool.query<{ id: string }>(
      `INSERT INTO catalog.varieties (ref, commodity_id, name, validation_status, status)
       VALUES ($1, $2, $3, 'VALIDATED', 'ACTIVE') RETURNING id`,
      [`VAR-B4-${RUN}`, productId, `B4 Rose Red ${RUN}`]
    );
    varietyId = variety.rows[0].id;
    const gp = await pool.query<{ id: string }>(
      `INSERT INTO catalog.grade_profiles (commodity_id, grade_code, version_no, rules, status, effective_from, created_by, validation_status)
       VALUES ($1, $2, 1, '[]', 'ACTIVE', $3, $4, 'VALIDATED') RETURNING id`,
      [productId, `B4A_${RUN}`, PAST, admin.userId]
    );
    gradeProfileId = gp.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
    await t.app.close();
  });

  describe('A. Award -> order conversion', () => {
    it('(A1) convert requires Idempotency-Key', async () => {
      const fx = await awardedChain('a1');
      const res = await t.http.post('/api/orders/convert-award').set(asBuyer()).send({ awardId: fx.awardId });
      expect(res.status).toBe(400);
    });
    it('(A2) convert creates PENDING_CONFIRMATION order with lines, allocations, history and audit', async () => {
      const fx = await awardedChain('a2');
      const conv = await convert(fx.awardId, idem('a2-conv'));
      expectOk(conv.status);
      expect(conv.body.ref).toMatch(/^ORD-/);
      expect(conv.body.status).toBe('PENDING_CONFIRMATION');
      const detail = await t.http.get(`/api/orders/${conv.body.id}`).set(asBuyer());
      expect(detail.body.lines.length).toBe(1);
      expect(detail.body.lines[0].spec_snapshot.quotationVersionId).toBe(fx.versionId);
      expect(detail.body.allocations.length).toBe(1);
      expect(detail.body.allocations[0].supplier_org_id).toBe(supOrg);
      expect(detail.body.history.length).toBe(1);
      const audit = await pool.query(`SELECT 1 FROM core.audit_events WHERE object_id = $1 AND action = 'order.convert'`, [conv.body.id]);
      expect(audit.rowCount).toBe(1);
    });
    it('(A3) convert replay with same key returns the same order', async () => {
      const fx = await awardedChain('a3');
      const first = await convert(fx.awardId, idem('a3-conv'));
      const replay = await convert(fx.awardId, idem('a3-conv'));
      expectOk(replay.status);
      expect(replay.body.id).toBe(first.body.id);
    });
    it('(A4) convert with a different key returns the existing order (one order per award)', async () => {
      const fx = await awardedChain('a4');
      const first = await convert(fx.awardId, idem('a4-a'));
      const second = await convert(fx.awardId, idem('a4-b'));
      expectOk(second.status);
      expect(second.body.id).toBe(first.body.id);
      const count = await pool.query(`SELECT count(*)::int AS c FROM ordering.orders WHERE award_id = $1`, [fx.awardId]);
      expect(count.rows[0].c).toBe(1);
    });
    it('(A5) unknown award -> 404', async () => {
      const res = await convert(randomUUID(), idem('a5'));
      expect(res.status).toBe(404);
    });
    it('(A6) outsider converting a foreign award -> 404 (existence hidden)', async () => {
      const fx = await awardedChain('a6');
      const res = await convert(fx.awardId, idem('a6'), asOutsider());
      expect(res.status).toBe(404);
    });
    it('(A7) ops can convert on behalf of the buyer', async () => {
      const fx = await awardedChain('a7');
      const res = await convert(fx.awardId, idem('a7'), asOps());
      expectOk(res.status);
    });
    it('(A8) order totals derive from awarded qty x unit price', async () => {
      const fx = await awardedChain('a8', 10);
      const conv = await convert(fx.awardId, idem('a8-conv'));
      expect(conv.body.totalMinor).toBe(10 * 42000);
    });
  });

  describe('B. Supplier allocation confirmation', () => {
    it('(B1) supplier sees the allocation in allocations/mine with lines', async () => {
      const fx = await convertedChain('b1');
      const mine = await t.http.get('/api/orders/allocations/mine').set(asSup());
      const alloc = (mine.body.items as { id: string; order_id: string; lines: unknown[] }[]).find((a) => a.order_id === fx.orderId);
      expect(alloc).toBeTruthy();
      expect(alloc?.lines.length).toBe(1);
    });
    it('(B2) supplier confirm -> CONFIRMED; order becomes CONFIRMED when all suppliers confirm', async () => {
      const fx = await convertedChain('b2');
      const res = await confirmAlloc(fx.allocId);
      expectOk(res.status);
      expect(res.body.status).toBe('CONFIRMED');
      const detail = await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer());
      expect(detail.body.status).toBe('CONFIRMED');
    });
    it('(B3) double confirm -> 409 ILLEGAL_TRANSITION', async () => {
      const fx = await convertedChain('b3');
      await confirmAlloc(fx.allocId);
      const again = await confirmAlloc(fx.allocId);
      expect(again.status).toBe(409);
      expect(again.body.error.details?.code_detail).toBe('ILLEGAL_TRANSITION');
    });
    it('(B4) outsider confirming -> 404', async () => {
      const fx = await convertedChain('b4');
      const res = await t.http.post(`/api/orders/allocations/${fx.allocId}/confirm`).set(asOutsider());
      expect(res.status).toBe(404);
    });
    it('(B5) supplier order view is a slice: own allocation only, no buyer fields (tenant isolation)', async () => {
      const fx = await convertedChain('b5');
      const res = await t.http.get(`/api/orders/${fx.orderId}`).set(asSup());
      expect(res.status).toBe(200);
      expect(res.body.allocation.id).toBe(fx.allocId);
      expect(res.body.buyer_org_id).toBeUndefined();
      expect(res.body.total_minor).toBeUndefined();
      expect(res.body.award_id).toBeUndefined();
      const foreign = await t.http.get(`/api/orders/${fx.orderId}`).set(asOutsider());
      expect(foreign.status).toBe(404);
    });
  });

  describe('C. Supply lots: creation, balances, media', () => {
    it('(C1) lot create requires Idempotency-Key', async () => {
      const res = await t.http.post('/api/supply/lots/harvest').set(asSup())
        .send({ commodityId: productId, varietyId, declaredQty: 10, uomId: stemUom, originType: 'OWN_FARM', harvestedAt: PAST });
      expect(res.status).toBe(400);
    });
    it('(C2) harvest lot creates lot + harvest record, status HARVESTED, available 0', async () => {
      const lotId = await makeLot('c2', 30);
      const lot = await t.http.get(`/api/supply/lots/${lotId}`).set(asSup());
      expect(lot.body.status).toBe('HARVESTED');
      expect(Number(lot.body.available_qty)).toBe(0);
      const hr = await pool.query(`SELECT 1 FROM supply.harvest_records WHERE lot_id = $1`, [lotId]);
      expect(hr.rowCount).toBe(1);
    });
    it('(C3) stock lot -> STOCK_RECEIVED with received_at', async () => {
      const res = await t.http.post('/api/supply/lots/stock').set(asSup()).set('Idempotency-Key', idem('c3'))
        .send({ commodityId: productId, varietyId, declaredQty: 12, uomId: stemUom, originType: 'WHOLESALE_STOCK', receivedAt: PAST });
      expectOk(res.status);
      expect(res.body.status).toBe('STOCK_RECEIVED');
    });
    it('(C4) unvalidated/unknown masters rejected (Guardrail B)', async () => {
      const unknown = await t.http.post('/api/supply/lots/harvest').set(asSup()).set('Idempotency-Key', idem('c4'))
        .send({ commodityId: randomUUID(), declaredQty: 5, uomId: stemUom, originType: 'OWN_FARM', harvestedAt: PAST });
      expect(unknown.status).toBe(400);
    });
    it('(C5) lot create replay is idempotent', async () => {
      const body = { commodityId: productId, varietyId, declaredQty: 8, uomId: stemUom, originType: 'OWN_FARM', harvestedAt: PAST };
      const first = await t.http.post('/api/supply/lots/harvest').set(asSup()).set('Idempotency-Key', idem('c5')).send(body);
      const replay = await t.http.post('/api/supply/lots/harvest').set(asSup()).set('Idempotency-Key', idem('c5')).send(body);
      expect(replay.body.id).toBe(first.body.id);
    });
    it('(C6) submit-qc -> QC_PENDING; second submit -> 409', async () => {
      const lotId = await makeLot('c6', 10);
      const sub = await t.http.post(`/api/supply/lots/${lotId}/submit-qc`).set(asSup());
      expectOk(sub.status);
      expect(sub.body.status).toBe('QC_PENDING');
      const again = await t.http.post(`/api/supply/lots/${lotId}/submit-qc`).set(asSup());
      expect(again.status).toBe(409);
    });
    it('(C7) lot read scoped: outsider 404, ops allowed', async () => {
      const lotId = await makeLot('c7', 10);
      expect((await t.http.get(`/api/supply/lots/${lotId}`).set(asOutsider())).status).toBe(404);
      expect((await t.http.get(`/api/supply/lots/${lotId}`).set(asOps())).status).toBe(200);
    });
    it('(C8) listMine returns only own lots', async () => {
      const lotId = await makeLot('c8', 10);
      const mine = await t.http.get('/api/supply/lots').set(asSup());
      expect((mine.body.items as { id: string }[]).some((l) => l.id === lotId)).toBe(true);
      const other = await t.http.get('/api/supply/lots').set(asOutsider());
      expect((other.body.items as { id: string }[]).some((l) => l.id === lotId)).toBe(false);
    });
    it('(C9) lot media: upload, attach, signed read URL serves bytes', async () => {
      const lotId = await makeLot('c9', 10);
      const up = await t.http.post('/api/media').set(asSup())
        .send({ contentType: 'image/png', dataBase64: PNG_B64, bucket: 'pilot' });
      expectOk(up.status);
      const attach = await t.http.post(`/api/supply/lots/${lotId}/media`).set(asSup())
        .send({ mediaObjectId: up.body.id, purpose: 'LOT_PHOTO' });
      expectOk(attach.status);
      const media = await t.http.get(`/api/supply/lots/${lotId}/media`).set(asSup());
      expect(media.body.items.length).toBe(1);
      const raw = await t.http.get(media.body.items[0].url as string);
      expect(raw.status).toBe(200);
      expect(raw.headers['content-type']).toBe('image/png');
    });
    it('(C10) suspended org loses lot.write but keeps lot.read', async () => {
      await pool.query(`UPDATE identity.organizations SET status = 'SUSPENDED' WHERE id = $1`, [outsiderOrg]);
      const write = await t.http.post('/api/supply/lots/harvest').set(asOutsider()).set('Idempotency-Key', idem('c10'))
        .send({ commodityId: productId, varietyId, declaredQty: 5, uomId: stemUom, originType: 'OWN_FARM', harvestedAt: PAST });
      expect(write.status).toBe(403);
      const read = await t.http.get('/api/supply/lots').set(asOutsider());
      expect(read.status).toBe(200);
      await pool.query(`UPDATE identity.organizations SET status = 'ACTIVE' WHERE id = $1`, [outsiderOrg]);
    });
  });

  describe('D. QC inspections: evidence, conflict control, hold math', () => {
    it('(D1) queue lists only QC_PENDING lots', async () => {
      const lotId = await makeLot('d1', 10);
      await t.http.post(`/api/supply/lots/${lotId}/submit-qc`).set(asSup());
      const queue = await t.http.get('/api/quality/queue').set(asQc());
      expect((queue.body.items as { id: string }[]).some((l) => l.id === lotId)).toBe(true);
    });
    it('(D2) inspection on a non-QC_PENDING lot -> 409', async () => {
      const lotId = await makeLot('d2', 10);
      const res = await t.http.post('/api/quality/inspections').set(asQc()).send({ lotId, scope: 'SAMPLE' });
      expect(res.status).toBe(409);
    });
    it('(D3) inspector from the lot-owning org is blocked without ops override (QC_CONFLICT)', async () => {
      const lotId = await makeLot('d3', 10, asAdmin());
      await t.http.post(`/api/supply/lots/${lotId}/submit-qc`).set(asAdmin());
      const res = await t.http.post('/api/quality/inspections').set(asQc()).send({ lotId, scope: 'FULL' });
      // qc user is on the platform org which owns this lot -> financial-interest conflict
      expect(res.status).toBe(409);
      expect(res.body.error.details?.code_detail).toBe('QC_CONFLICT');
    });
    it('(D4) procurement.manage override with recorded reason allows the conflicted inspection', async () => {
      const lotId = await makeLot('d4', 10, asAdmin());
      await t.http.post(`/api/supply/lots/${lotId}/submit-qc`).set(asAdmin());
      const res = await t.http.post('/api/quality/inspections').set(asAdmin())
        .send({ lotId, scope: 'FULL', conflictOverrideReason: 'single QC desk available for pilot' });
      expectOk(res.status);
      expect(res.body.conflictFlag).toBe(true);
    });
    it('(D5) complete requires Idempotency-Key', async () => {
      const lotId = await makeLot('d5', 10);
      await t.http.post(`/api/supply/lots/${lotId}/submit-qc`).set(asSup());
      const ins = await t.http.post('/api/quality/inspections').set(asQc()).send({ lotId, scope: 'SAMPLE' });
      const res = await t.http.post(`/api/quality/inspections/${ins.body.id}/complete`).set(asQc())
        .send({ acceptedQty: 10, rejectedQty: 0, heldQty: 0, gradeResults: [{ gradeProfileId, measurements: {} }] });
      expect(res.status).toBe(400);
    });
    it('(D6) unknown grade profile -> 400 UNKNOWN_REFERENCE (never invent grades)', async () => {
      const lotId = await makeLot('d6', 10);
      await t.http.post(`/api/supply/lots/${lotId}/submit-qc`).set(asSup());
      const ins = await t.http.post('/api/quality/inspections').set(asQc()).send({ lotId, scope: 'SAMPLE' });
      const res = await t.http.post(`/api/quality/inspections/${ins.body.id}/complete`).set(asQc())
        .set('Idempotency-Key', idem('d6'))
        .send({ acceptedQty: 10, rejectedQty: 0, heldQty: 0, gradeResults: [{ gradeProfileId: randomUUID(), measurements: {} }] });
      expect(res.status).toBe(400);
      expect(res.body.error.details?.code_detail).toBe('UNKNOWN_REFERENCE');
    });
    it('(D7) accepted qty moves lot to AVAILABLE and pins the grade-profile version', async () => {
      const lotId = await makeLot('d7', 25);
      const insId = await qcLot('d7', lotId, 25);
      const lot = await t.http.get(`/api/supply/lots/${lotId}`).set(asSup());
      expect(lot.body.status).toBe('AVAILABLE');
      expect(Number(lot.body.available_qty)).toBe(25);
      const result = await pool.query(
        `SELECT grade_profile_version_no FROM quality.qc_results WHERE inspection_id = $1`, [insId]);
      expect(result.rows[0].grade_profile_version_no).toBe(1);
    });
    it('(D8) fully rejected lot -> REJECTED and never available', async () => {
      const lotId = await makeLot('d8', 15);
      await qcLot('d8', lotId, 0, 15, 0);
      const lot = await t.http.get(`/api/supply/lots/${lotId}`).set(asSup());
      expect(lot.body.status).toBe('REJECTED');
      expect(Number(lot.body.available_qty)).toBe(0);
      expect(Number(lot.body.qc_rejected_qty)).toBe(15);
    });
    it('(D9) held qty puts lot on HOLD and blocks availability', async () => {
      const lotId = await makeLot('d9', 20);
      await qcLot('d9', lotId, 12, 3, 5);
      const lot = await t.http.get(`/api/supply/lots/${lotId}`).set(asSup());
      expect(lot.body.status).toBe('HOLD');
      expect(Number(lot.body.available_qty)).toBe(12);
      expect(Number(lot.body.qc_held_qty)).toBe(5);
    });
    it('(D10) hold resolution must account for the exact held quantity', async () => {
      const lotId = await makeLot('d10', 20);
      await qcLot('d10', lotId, 12, 3, 5);
      const bad = await t.http.post(`/api/supply/lots/${lotId}/resolve-hold`).set(asSup())
        .send({ toAvailableQty: 2, toRejectedQty: 2 });
      expect(bad.status).toBe(400);
      const ok = await t.http.post(`/api/supply/lots/${lotId}/resolve-hold`).set(asSup())
        .send({ toAvailableQty: 5, toRejectedQty: 0, reason: 're-inspected' });
      expectOk(ok.status);
      const lot = await t.http.get(`/api/supply/lots/${lotId}`).set(asSup());
      expect(lot.body.status).toBe('AVAILABLE');
      expect(Number(lot.body.available_qty)).toBe(17);
    });
    it('(D11) complete replay is idempotent; second complete -> 409', async () => {
      const lotId = await makeLot('d11', 10);
      await t.http.post(`/api/supply/lots/${lotId}/submit-qc`).set(asSup());
      const ins = await t.http.post('/api/quality/inspections').set(asQc()).send({ lotId, scope: 'SAMPLE' });
      const body = { acceptedQty: 10, rejectedQty: 0, heldQty: 0, gradeResults: [{ gradeProfileId, measurements: {} }] };
      const first = await t.http.post(`/api/quality/inspections/${ins.body.id}/complete`).set(asQc()).set('Idempotency-Key', idem('d11')).send(body);
      const replay = await t.http.post(`/api/quality/inspections/${ins.body.id}/complete`).set(asQc()).set('Idempotency-Key', idem('d11')).send(body);
      expectOk(replay.status);
      expect(replay.body.replayed).toBe(true);
      expect(first.body.id).toBe(replay.body.id);
      const again = await t.http.post(`/api/quality/inspections/${ins.body.id}/complete`).set(asQc()).set('Idempotency-Key', idem('d11-new')).send(body);
      expect(again.status).toBe(409);
    });
  });

  describe('E. Lot allocation into order lines (ADR-001)', () => {
    it('(E1) allocate requires Idempotency-Key', async () => {
      const fx = await confirmedChain('e1');
      const res = await t.http.post('/api/orders/allocate').set(asBuyer())
        .send({ supplierAllocationLineId: fx.salLineId, lotId: randomUUID(), qty: 1 });
      expect(res.status).toBe(400);
    });
    it('(E2) allocate moves qty into allocated against the gross QC pool (ADR-001 invariant)', async () => {
      const fx = await suppliedChain('e2');
      const lot = await t.http.get(`/api/supply/lots/${fx.lotId}`).set(asSup());
      expect(Number(lot.body.allocated_qty)).toBe(40);
      // available = gross QC pool; allocatable = available - reserved - allocated = 10
      expect(Number(lot.body.available_qty)).toBe(50);
      expect(Number(lot.body.available_qty) - Number(lot.body.reserved_qty) - Number(lot.body.allocated_qty)).toBe(10);
      const detail = await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer());
      expect(detail.body.status).toBe('SUPPLY_CONFIRMED');
      expect(detail.body.allocationLines[0].fulfilment_status).toBe('ALLOCATED');
    });
    it('(E3) allocation beyond lot availability is rejected (never oversell)', async () => {
      const fx = await confirmedChain('e3', 10);
      const lotId = await makeLot('e3', 5);
      await qcLot('e3', lotId, 5);
      const res = await t.http.post('/api/orders/allocate').set(asBuyer()).set('Idempotency-Key', idem('e3'))
        .send({ supplierAllocationLineId: fx.salLineId, lotId, qty: 10 });
      expect(res.status).toBe(409);
    });
    it('(E4) allocation beyond remaining line quantity -> EXCEEDS_REQUIREMENT', async () => {
      const fx = await confirmedChain('e4', 10);
      const lotId = await makeLot('e4', 50);
      await qcLot('e4', lotId, 50);
      const res = await t.http.post('/api/orders/allocate').set(asBuyer()).set('Idempotency-Key', idem('e4'))
        .send({ supplierAllocationLineId: fx.salLineId, lotId, qty: 11 });
      expect(res.status).toBe(409);
      expect(res.body.error.details?.code_detail).toBe('EXCEEDS_REQUIREMENT');
    });
    it('(E5) lot UoM must match the order line UoM', async () => {
      const fx = await confirmedChain('e5', 10);
      const lotId = await makeLot('e5', 10, asSup(), bunchUom);
      await qcLot('e5', lotId, 10);
      const res = await t.http.post('/api/orders/allocate').set(asBuyer()).set('Idempotency-Key', idem('e5'))
        .send({ supplierAllocationLineId: fx.salLineId, lotId, qty: 10 });
      expect(res.status).toBe(400);
    });
    it('(E6) supplier cannot allocate its own lots into the order (buyer/ops only)', async () => {
      const fx = await confirmedChain('e6', 10);
      const lotId = await makeLot('e6', 10);
      await qcLot('e6', lotId, 10);
      const res = await t.http.post('/api/orders/allocate').set(asSup()).set('Idempotency-Key', idem('e6'))
        .send({ supplierAllocationLineId: fx.salLineId, lotId, qty: 10 });
      expect(res.status).toBe(404);
    });
    it('(E7) allocation replay is idempotent (balances unchanged)', async () => {
      const fx = await confirmedChain('e7', 10);
      const lotId = await makeLot('e7', 20);
      await qcLot('e7', lotId, 20);
      const body = { supplierAllocationLineId: fx.salLineId, lotId, qty: 10 };
      const first = await t.http.post('/api/orders/allocate').set(asBuyer()).set('Idempotency-Key', idem('e7')).send(body);
      const replay = await t.http.post('/api/orders/allocate').set(asBuyer()).set('Idempotency-Key', idem('e7')).send(body);
      expectOk(replay.status);
      expect(replay.body.reservationId).toBe(first.body.reservationId);
      const lot = await t.http.get(`/api/supply/lots/${lotId}`).set(asSup());
      expect(Number(lot.body.allocated_qty)).toBe(10);
    });
    it('(E8) shortfall marks the line SHORT', async () => {
      const fx = await confirmedChain('e8', 10);
      const res = await t.http.post(`/api/orders/allocations/${fx.salLineId}/shortfall`).set(asBuyer()).send({ note: 'crop failure' });
      expectOk(res.status);
      expect(res.body.status).toBe('SHORT');
      const detail = await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer());
      expect(detail.body.allocationLines[0].fulfilment_status).toBe('SHORT');
    });
  });

  describe('F. Packing, dispatch and POD', () => {
    it('(F1) packing requires an ALLOCATED line', async () => {
      const fx = await confirmedChain('f1', 10);
      const lotId = await makeLot('f1', 10);
      const res = await t.http.post('/api/logistics/pack').set(asSup()).set('Idempotency-Key', idem('f1'))
        .send({ orderId: fx.orderId, supplierAllocationLineId: fx.salLineId, lotId, packedQty: 5, uomId: stemUom });
      expect(res.status).toBe(409);
    });
    it('(F2) packed quantity can never exceed allocated quantity', async () => {
      const fx = await suppliedChain('f2', 10, 20);
      const res = await t.http.post('/api/logistics/pack').set(asSup()).set('Idempotency-Key', idem('f2'))
        .send({ orderId: fx.orderId, supplierAllocationLineId: fx.salLineId, lotId: fx.lotId, packedQty: 11, uomId: stemUom });
      expect(res.status).toBe(409);
      expect(res.body.error.details?.code_detail).toBe('EXCEEDS_ALLOCATED');
    });
    it('(F3) packing updates lot packed_qty, records custody and flips the line to PACKED', async () => {
      const fx = await suppliedChain('f3', 10, 20);
      const pack = await t.http.post('/api/logistics/pack').set(asSup()).set('Idempotency-Key', idem('f3'))
        .send({ orderId: fx.orderId, supplierAllocationLineId: fx.salLineId, lotId: fx.lotId, packedQty: 10, uomId: stemUom, packType: 'CARTON' });
      expectOk(pack.status);
      expect(pack.body.ref).toMatch(/^PCK-/);
      const lot = await t.http.get(`/api/supply/lots/${fx.lotId}`).set(asSup());
      expect(Number(lot.body.packed_qty)).toBe(10);
      const custody = await t.http.get(`/api/quality/custody/lot/${fx.lotId}`).set(asSup());
      expect((custody.body.items as { event_type: string }[]).some((c) => c.event_type === 'PACKED')).toBe(true);
      const detail = await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer());
      expect(detail.body.allocationLines[0].fulfilment_status).toBe('PACKED');
    });
    it('(F4) READY_FOR_DISPATCH is blocked until every line is packed', async () => {
      const fx = await suppliedChain('f4', 10);
      await t.http.post(`/api/orders/${fx.orderId}/transition`).set(asBuyer()).send({ to: 'QC_PACK' });
      const res = await t.http.post(`/api/orders/${fx.orderId}/transition`).set(asBuyer()).send({ to: 'READY_FOR_DISPATCH' });
      expect(res.status).toBe(409);
      expect(res.body.error.details?.code_detail).toBe('PREREQUISITE_MISSING');
    });
    it('(F5) shipment creation requires READY_FOR_DISPATCH', async () => {
      const fx = await suppliedChain('f5', 10);
      const early = await t.http.post('/api/logistics/shipments').set(asBuyer()).set('Idempotency-Key', idem('f5'))
        .send({ orderId: fx.orderId, mode: 'REEFER_ROAD', tempControlled: true });
      expect(early.status).toBe(409);
    });
    it('(F6) dispatch is atomic: shipment IN_TRANSIT, lot dispatched, line DISPATCHED, custody, order DISPATCHED', async () => {
      const fx = await shippedChain('f6', 10);
      const res = await t.http.post(`/api/logistics/shipments/${fx.shipmentId}/dispatch`).set(asBuyer())
        .set('Idempotency-Key', idem('f6-di'));
      expectOk(res.status);
      expect(res.body.status).toBe('IN_TRANSIT');
      const lot = await t.http.get(`/api/supply/lots/${fx.lotId}`).set(asSup());
      expect(Number(lot.body.dispatched_qty)).toBe(10);
      const detail = await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer());
      expect(detail.body.status).toBe('DISPATCHED');
      expect(detail.body.allocationLines[0].fulfilment_status).toBe('DISPATCHED');
      const custody = await t.http.get(`/api/quality/custody/lot/${fx.lotId}`).set(asSup());
      expect((custody.body.items as { event_type: string }[]).some((c) => c.event_type === 'CARRIER_HANDOFF')).toBe(true);
    });
    it('(F7) POD is atomic and one-per-shipment: order DELIVERED, lot delivered, duplicate replays', async () => {
      const fx = await shippedChain('f7', 10);
      await t.http.post(`/api/logistics/shipments/${fx.shipmentId}/dispatch`).set(asBuyer()).set('Idempotency-Key', idem('f7-di'));
      const pod = await t.http.post(`/api/logistics/shipments/${fx.shipmentId}/pod`).set(asBuyer())
        .set('Idempotency-Key', idem('f7-pod')).send({ deliveredQty: 10, receiverName: 'Gate' });
      expectOk(pod.status);
      const dup = await t.http.post(`/api/logistics/shipments/${fx.shipmentId}/pod`).set(asBuyer())
        .set('Idempotency-Key', idem('f7-pod2')).send({ deliveredQty: 10, receiverName: 'Gate' });
      expectOk(dup.status);
      expect(dup.body.duplicate).toBe(true);
      const pods = await pool.query(`SELECT count(*)::int AS c FROM logistics.pod_records WHERE shipment_id = $1`, [fx.shipmentId]);
      expect(pods.rows[0].c).toBe(1);
      // POD ends the order in ACCEPTANCE_PENDING (DELIVERED is a transient step awaiting buyer).
      const detail = await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer());
      expect(detail.body.status).toBe('ACCEPTANCE_PENDING');
      const lot = await t.http.get(`/api/supply/lots/${fx.lotId}`).set(asSup());
      expect(Number(lot.body.delivered_qty)).toBe(10);
    });
    it('(F8) shipments are listed per order for buyer and supplier, hidden from outsiders', async () => {
      const fx = await shippedChain('f8', 10);
      const buyerView = await t.http.get(`/api/logistics/shipments/order/${fx.orderId}`).set(asBuyer());
      expect(buyerView.status).toBe(200);
      expect(buyerView.body.items.length).toBe(1);
      const supView = await t.http.get(`/api/logistics/shipments/order/${fx.orderId}`).set(asSup());
      expect(supView.status).toBe(200);
      const outView = await t.http.get(`/api/logistics/shipments/order/${fx.orderId}`).set(asOutsider());
      expect(outView.status).toBe(404);
    });
  });

  describe('G. Cold-chain excursions and HOLD gating (ADR-002)', () => {
    it('(G1) WARNING excursion is recorded without blocking', async () => {
      const fx = await shippedChain('g1', 10);
      const res = await t.http.post(`/api/logistics/shipments/${fx.shipmentId}/temperature-exception`).set(asBuyer())
        .send({ severity: 'WARNING', celsius: 7, occurredAt: PAST });
      expectOk(res.status);
      expect(res.body.blocked).toBe(false);
    });
    it('(G2) CRITICAL excursion opens a blocking exception and holds buyer acceptance', async () => {
      const fx = await deliveredChain('g2', 10);
      const res = await t.http.post(`/api/logistics/shipments/${fx.shipmentId}/temperature-exception`).set(asBuyer())
        .send({ severity: 'CRITICAL', celsius: 9, occurredAt: PAST, actionTaken: 're-iced' });
      expectOk(res.status);
      expect(res.body.blocked).toBe(true);
      const accept = await t.http.post(`/api/orders/${fx.orderId}/accept`).set(asBuyer()).send({ acceptedQty: 10 });
      expect(accept.status).toBe(409);
      expect(accept.body.error.details?.code_detail).toBe('DELIVERY_HOLD');
    });
    it('(G3) ops resolution releases the hold; acceptance then succeeds', async () => {
      const fx = await deliveredChain('g3', 10);
      const exc = await t.http.post(`/api/logistics/shipments/${fx.shipmentId}/temperature-exception`).set(asBuyer())
        .send({ severity: 'CRITICAL', celsius: 9, occurredAt: PAST });
      const rel = await t.http.post(`/api/logistics/exceptions/${exc.body.exceptionId}/resolve`).set(asOps())
        .send({ resolution: 'reviewed, no quality impact' });
      expectOk(rel.status);
      const accept = await t.http.post(`/api/orders/${fx.orderId}/accept`).set(asBuyer()).send({ acceptedQty: 10 });
      expectOk(accept.status);
    });
    it('(G4) exception resolution is ops-only', async () => {
      const fx = await deliveredChain('g4', 10);
      const exc = await t.http.post(`/api/logistics/shipments/${fx.shipmentId}/temperature-exception`).set(asBuyer())
        .send({ severity: 'CRITICAL', celsius: 9, occurredAt: PAST });
      const res = await t.http.post(`/api/logistics/exceptions/${exc.body.exceptionId}/resolve`).set(asSup())
        .send({ resolution: 'nope' });
      expect(res.status).toBe(403);
    });
  });

  describe('H. Manual payments and supplier settlements (§22/§23/§29, ADR-003/004)', () => {
    it('(H1) payment record requires Idempotency-Key and is an EXTERNAL record', async () => {
      const fx = await acceptedChain('h1', 10);
      const noKey = await t.http.post('/api/finance/payments').set(asFin1())
        .send({ orderId: fx.orderId, amountMinor: 1000, method: 'UPI', externalRef: 'UTR1', paidAt: PAST });
      expect(noKey.status).toBe(400);
      const res = await t.http.post('/api/finance/payments').set(asFin1()).set('Idempotency-Key', idem('h1'))
        .send({ orderId: fx.orderId, amountMinor: 420000, method: 'UPI', externalRef: 'UTR-1', paidAt: PAST });
      expectOk(res.status);
      expect(res.body.kind).toBe('EXTERNAL_RECORDED');
      expect(res.body.status).toBe('RECORDED');
    });
    it('(H2) buyer without payment.record permission cannot record (403)', async () => {
      const fx = await acceptedChain('h2', 10);
      const res = await t.http.post('/api/finance/payments').set(asBuyer()).set('Idempotency-Key', idem('h2'))
        .send({ orderId: fx.orderId, amountMinor: 1000, method: 'UPI', externalRef: 'UTR-2', paidAt: PAST });
      expect(res.status).toBe(403);
    });
    it('(H3) recorder cannot self-verify; a second finance user verifies', async () => {
      const fx = await acceptedChain('h3', 10);
      const rec = await t.http.post('/api/finance/payments').set(asFin1()).set('Idempotency-Key', idem('h3'))
        .send({ orderId: fx.orderId, amountMinor: 1000, method: 'NEFT', externalRef: 'UTR-3', paidAt: PAST });
      const self = await t.http.post(`/api/finance/payments/${rec.body.id}/verify`).set(asFin1());
      expect(self.status).toBe(403);
      expect(self.body.error.details?.code_detail).toBe('SELF_VERIFY');
      const other = await t.http.post(`/api/finance/payments/${rec.body.id}/verify`).set(asFin2());
      expectOk(other.status);
      expect(other.body.status).toBe('VERIFIED');
    });
    it('(H4) supplier can never record its own settlement (SELF_DEALING)', async () => {
      const fx = await acceptedChain('h4', 10);
      const res = await t.http.post('/api/finance/settlements').set(asSup()).set('Idempotency-Key', idem('h4'))
        .send({ orderId: fx.orderId, supplierOrgId: supOrg, grossMinor: 420000 });
      expect(res.status).toBe(403);
    });
    it('(H5) settlement net = gross - deductions - claim adjustment; negative net rejected', async () => {
      const fx = await acceptedChain('h5', 10);
      const res = await t.http.post('/api/finance/settlements').set(asFin1()).set('Idempotency-Key', idem('h5'))
        .send({ orderId: fx.orderId, supplierOrgId: supOrg, grossMinor: 420000,
          deductions: [{ label: 'crate deposit', amountMinor: 2000 }], claimAdjustmentMinor: 8000, payoutRef: 'PO-1' });
      expectOk(res.status);
      expect(res.body.netMinor).toBe(410000);
      const negative = await t.http.post('/api/finance/settlements').set(asFin1()).set('Idempotency-Key', idem('h5-neg'))
        .send({ orderId: fx.orderId, supplierOrgId: supOrg, grossMinor: 100, claimAdjustmentMinor: 200 });
      expect(negative.status).toBe(400);
    });
    it('(H6) settlement lifecycle: record -> verify -> complete -> order SETTLED; complete-before-verify 409', async () => {
      const fx = await acceptedChain('h6', 10);
      const rec = await t.http.post('/api/finance/settlements').set(asFin1()).set('Idempotency-Key', idem('h6'))
        .send({ orderId: fx.orderId, supplierOrgId: supOrg, grossMinor: 420000 });
      const early = await t.http.post(`/api/finance/settlements/${rec.body.id}/complete`).set(asFin2());
      expect(early.status).toBe(409);
      expectOk((await t.http.post(`/api/finance/settlements/${rec.body.id}/verify`).set(asFin2())).status);
      const done = await t.http.post(`/api/finance/settlements/${rec.body.id}/complete`).set(asFin2());
      expectOk(done.status);
      expect(done.body.status).toBe('COMPLETED');
      const detail = await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer());
      expect(detail.body.status).toBe('SETTLED');
    });
    it('(H7) COMPLETED settlement is immutable — corrections are adjustment rows (ADR-003)', async () => {
      const fx = await acceptedChain('h7', 10);
      const rec = await t.http.post('/api/finance/settlements').set(asFin1()).set('Idempotency-Key', idem('h7'))
        .send({ orderId: fx.orderId, supplierOrgId: supOrg, grossMinor: 420000 });
      await t.http.post(`/api/finance/settlements/${rec.body.id}/verify`).set(asFin2());
      await t.http.post(`/api/finance/settlements/${rec.body.id}/complete`).set(asFin2());
      const adj = await t.http.post(`/api/finance/settlements/${rec.body.id}/adjustments`).set(asFin1())
        .send({ direction: 'DEBIT', amountMinor: 5000, reason: 'post-settlement quality deduction' });
      expectOk(adj.status);
      const rows = await pool.query(`SELECT direction, amount_minor FROM payments.financial_adjustments WHERE settlement_id = $1`, [rec.body.id]);
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0].direction).toBe('DEBIT');
      const before = await pool.query<{ net_minor: string }>(`SELECT net_minor FROM payments.settlements WHERE id = $1`, [rec.body.id]);
      await pool.query(`UPDATE payments.settlements SET net_minor = 1 WHERE id = $1`, [rec.body.id]).catch(() => undefined);
      const after = await pool.query<{ net_minor: string }>(`SELECT net_minor FROM payments.settlements WHERE id = $1`, [rec.body.id]);
      expect(after.rows[0].net_minor).toBe(before.rows[0].net_minor);
    });
    it('(H8) open payout freeze (ADR-004) blocks settlement completion until cleared', async () => {
      const fx = await acceptedChain('h8', 10);
      // ADR-004: supplier bank change under re-verification freezes payouts.
      const bank = await pool.query<{ id: string }>(
        `INSERT INTO identity.bank_accounts (org_id, account_ref, ifsc, account_number_enc, holder_name)
         VALUES ($1, $2, 'IFSC0001', 'enc', 'Holder') RETURNING id`, [supOrg, `BA-${RUN}`]);
      await pool.query(
        `INSERT INTO identity.bank_change_requests (org_id, new_bank_account_id, status, payout_freeze)
         VALUES ($1, $2, 'PENDING_REVERIFICATION', true)`, [supOrg, bank.rows[0].id]);
      const rec = await t.http.post('/api/finance/settlements').set(asFin1()).set('Idempotency-Key', idem('h8'))
        .send({ orderId: fx.orderId, supplierOrgId: supOrg, grossMinor: 420000 });
      await t.http.post(`/api/finance/settlements/${rec.body.id}/verify`).set(asFin2());
      const frozen = await t.http.post(`/api/finance/settlements/${rec.body.id}/complete`).set(asFin2());
      expect(frozen.status).toBe(409);
      expect(frozen.body.error.details?.code_detail).toBe('PAYOUT_FROZEN');
      await pool.query(`UPDATE identity.bank_change_requests SET status = 'APPROVED_FINAL', payout_freeze = false WHERE org_id = $1`, [supOrg]);
      const released = await t.http.post(`/api/finance/settlements/${rec.body.id}/complete`).set(asFin2());
      expectOk(released.status);
    });
    it('(H9) suppliers see only their own settlement rows on the order', async () => {
      const fx = await acceptedChain('h9', 10);
      await t.http.post('/api/finance/settlements').set(asFin1()).set('Idempotency-Key', idem('h9'))
        .send({ orderId: fx.orderId, supplierOrgId: supOrg, grossMinor: 420000 });
      const supView = await t.http.get(`/api/finance/settlements/order/${fx.orderId}`).set(asSup());
      expect(supView.status).toBe(200);
      expect((supView.body.items as { org_id: string }[]).every((s) => s.org_id === supOrg)).toBe(true);
      const outView = await t.http.get(`/api/finance/settlements/order/${fx.orderId}`).set(asOutsider());
      expect(outView.status).toBe(404);
    });
  });

  describe('I. Claims lifecycle (§20)', () => {
    it('(I1) claims open only after delivery', async () => {
      const fx = await confirmedChain('i1', 10);
      const res = await t.http.post('/api/claims').set(asBuyer()).set('Idempotency-Key', idem('i1'))
        .send({ orderId: fx.orderId, category: 'SHORT_QUANTITY', description: 'not yet delivered' });
      expect(res.status).toBe(409);
    });
    it('(I2) create DRAFT -> submit -> SUBMITTED; order flagged CLAIM_OPEN; replay safe', async () => {
      const fx = await acceptedChain('i2', 10);
      const claim = await t.http.post('/api/claims').set(asBuyer()).set('Idempotency-Key', idem('i2'))
        .send({ orderId: fx.orderId, category: 'QUALITY_MISMATCH', description: 'wilted stems', disputedQty: 4 });
      expectOk(claim.status);
      expect(claim.body.status).toBe('DRAFT');
      const sub = await t.http.post(`/api/claims/${claim.body.id}/submit`).set(asBuyer()).set('Idempotency-Key', idem('i2-sub'));
      expectOk(sub.status);
      const replay = await t.http.post(`/api/claims/${claim.body.id}/submit`).set(asBuyer()).set('Idempotency-Key', idem('i2-sub'));
      expectOk(replay.status);
      const detail = await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer());
      expect(detail.body.status).toBe('CLAIM_OPEN');
    });
    it('(I3) supplier counterparty response is recorded', async () => {
      const fx = await acceptedChain('i3', 10);
      const claim = await t.http.post('/api/claims').set(asBuyer()).set('Idempotency-Key', idem('i3'))
        .send({ orderId: fx.orderId, category: 'DAMAGED', description: 'bruised' });
      await t.http.post(`/api/claims/${claim.body.id}/submit`).set(asBuyer()).set('Idempotency-Key', idem('i3-sub'));
      const res = await t.http.post(`/api/claims/${claim.body.id}/respond`).set(asSup())
        .send({ response: 'packed to spec; transit damage suspected' });
      expectOk(res.status);
      expect(res.body.status).toBe('COUNTERPARTY_RESPONSE');
    });
    it('(I4) illegal transitions rejected; terminal decisions recorded once (immutable ledger)', async () => {
      const fx = await acceptedChain('i4', 10);
      const claim = await t.http.post('/api/claims').set(asBuyer()).set('Idempotency-Key', idem('i4'))
        .send({ orderId: fx.orderId, category: 'OTHER', description: 'misc' });
      const illegal = await t.http.post(`/api/claims/${claim.body.id}/transition`).set(asOps()).send({ to: 'CLOSED' });
      expect(illegal.status).toBe(409);
      await t.http.post(`/api/claims/${claim.body.id}/submit`).set(asBuyer()).set('Idempotency-Key', idem('i4-sub'));
      for (const to of ['EVIDENCE_VALIDATION', 'UNDER_REVIEW', 'PROPOSED_RESOLUTION', 'APPROVED']) {
        const step = await t.http.post(`/api/claims/${claim.body.id}/transition`).set(asOps()).send({ to });
        expectOk(step.status);
      }
      const decisions = await pool.query(`SELECT outcome FROM claims.claim_decisions WHERE claim_id = $1`, [claim.body.id]);
      expect(decisions.rows.length).toBe(1);
      expect(decisions.rows[0].outcome).toBe('APPROVED');
    });
    it('(I5) evidence attaches while open; closed claims reject evidence', async () => {
      const fx = await acceptedChain('i5', 10);
      const up = await t.http.post('/api/media').set(asBuyer())
        .send({ contentType: 'image/png', dataBase64: PNG_B64, bucket: 'claim' });
      const claim = await t.http.post('/api/claims').set(asBuyer()).set('Idempotency-Key', idem('i5'))
        .send({ orderId: fx.orderId, category: 'QUALITY_MISMATCH', description: 'evidence test', mediaObjectIds: [up.body.id] });
      await t.http.post(`/api/claims/${claim.body.id}/submit`).set(asBuyer()).set('Idempotency-Key', idem('i5-sub'));
      const more = await t.http.post(`/api/claims/${claim.body.id}/evidence`).set(asBuyer())
        .send({ mediaObjectId: up.body.id, note: 'second photo' });
      expectOk(more.status);
      await t.http.post(`/api/claims/${claim.body.id}/transition`).set(asOps()).send({ to: 'EVIDENCE_VALIDATION' });
      await t.http.post(`/api/claims/${claim.body.id}/transition`).set(asOps()).send({ to: 'UNDER_REVIEW' });
      await t.http.post(`/api/claims/${claim.body.id}/transition`).set(asOps()).send({ to: 'REJECTED', resolutionNote: 'no defect found' });
      const closed = await t.http.post(`/api/claims/${claim.body.id}/evidence`).set(asBuyer())
        .send({ mediaObjectId: up.body.id });
      expect(closed.status).toBe(409);
      const detail = await t.http.get(`/api/claims/${claim.body.id}`).set(asBuyer());
      expect(detail.body.evidences.length).toBe(2);
      expect(detail.body.decisions.length).toBe(1);
      expect(detail.body.decisions[0].outcome).toBe('REJECTED');
    });
    it('(I6) claim visibility: buyer + supplier + ops can read, outsider 404', async () => {
      const fx = await acceptedChain('i6', 10);
      const claim = await t.http.post('/api/claims').set(asBuyer()).set('Idempotency-Key', idem('i6'))
        .send({ orderId: fx.orderId, category: 'LATE_DELIVERY', description: 'late' });
      expect((await t.http.get(`/api/claims/${claim.body.id}`).set(asBuyer())).status).toBe(200);
      expect((await t.http.get(`/api/claims/${claim.body.id}`).set(asSup())).status).toBe(200);
      expect((await t.http.get(`/api/claims/${claim.body.id}`).set(asOps())).status).toBe(200);
      expect((await t.http.get(`/api/claims/${claim.body.id}`).set(asOutsider())).status).toBe(404);
    });
  });

  describe('J. Custody trail and control tower (§16/§24)', () => {
    it('(J1) custody events are append-only (DB rules block mutation)', async () => {
      const fx = await packedChain('j1', 10);
      const custody = await t.http.get(`/api/quality/custody/lot/${fx.lotId}`).set(asSup());
      const first = (custody.body.items as { id: string; event_type: string }[])[0];
      await pool.query(`UPDATE quality.custody_events SET event_type = 'TAMPERED' WHERE id = $1`, [first.id]).catch(() => undefined);
      const after = await pool.query<{ event_type: string }>(`SELECT event_type FROM quality.custody_events WHERE id = $1`, [first.id]);
      expect(after.rows[0].event_type).toBe(first.event_type);
    });
    it('(J2) custody timeline records the pilot chain in order', async () => {
      const fx = await deliveredChain('j2', 10);
      const custody = await t.http.get(`/api/quality/custody/lot/${fx.lotId}`).set(asSup());
      const types = (custody.body.items as { event_type: string }[]).map((c) => c.event_type);
      expect(types).toEqual(expect.arrayContaining(['QC_HANDOFF', 'PACKED', 'CARRIER_HANDOFF', 'DESTINATION_RECEIPT']));
    });
    it('(J3) tower aggregates exception queues and is ops-only', async () => {
      const fx = await confirmedChain('j3', 10);
      await t.http.post(`/api/orders/allocations/${fx.salLineId}/shortfall`).set(asBuyer()).send({ note: 'short' });
      const tower = await t.http.get('/api/tower/exceptions').set(asOps());
      expect(tower.status).toBe(200);
      for (const key of ['awardNotConverted', 'supplierNotConfirmed', 'orderShortAfterQc', 'buyerAcceptancePending',
        'lotAwaitingQc', 'qcHoldOrReject', 'packedAwaitingDispatch', 'openInspections', 'dispatchOverdue',
        'etaOverdue', 'podMissing', 'openShipmentExceptions', 'paymentUnverified', 'settlementPending', 'claimOpen']) {
        expect(Array.isArray(tower.body[key])).toBe(true);
      }
      expect((tower.body.orderShortAfterQc as { id: string }[]).some((l) => l.id === fx.salLineId)).toBe(true);
      const supTower = await t.http.get('/api/tower/exceptions').set(asSup());
      expect(supTower.status).toBe(403);
    });
    it('(J4) awardNotConverted queue clears after conversion', async () => {
      const fx = await awardedChain('j4');
      const before = await t.http.get('/api/tower/exceptions').set(asOps());
      expect((before.body.awardNotConverted as { id: string }[]).some((a) => a.id === fx.awardId)).toBe(true);
      await convert(fx.awardId, idem('j4-conv'));
      const after = await t.http.get('/api/tower/exceptions').set(asOps());
      expect((after.body.awardNotConverted as { id: string }[]).some((a) => a.id === fx.awardId)).toBe(false);
    });
  });

  describe('K. Mandatory end-to-end pilot simulation', () => {
    it('(K1) accepted offer -> order -> lots -> QC -> allocation -> pack -> dispatch -> POD -> acceptance -> payment -> settlement -> claim, all invariants hold', async () => {
      const qty = 40;
      const fx = await convertedChain('k1', qty);
      expect((await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer())).body.status).toBe('PENDING_CONFIRMATION');

      // Supplier confirms; order CONFIRMED.
      await confirmAlloc(fx.allocId);
      expect((await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer())).body.status).toBe('CONFIRMED');

      // Physical supply: harvest lot -> QC -> full acceptance.
      const lotId = await makeLot('k1', 50);
      const insId = await qcLot('k1', lotId, 50);
      const lotAfterQc = await t.http.get(`/api/supply/lots/${lotId}`).set(asSup());
      expect(lotAfterQc.body.status).toBe('AVAILABLE');

      // Allocation covers the line; order SUPPLY_CONFIRMED; ADR-001: 50 = 40 allocated + 10 allocatable.
      await t.http.post('/api/orders/allocate').set(asBuyer()).set('Idempotency-Key', idem('k1-al'))
        .send({ supplierAllocationLineId: fx.salLineId, lotId, qty });
      const lotAfterAlloc = await t.http.get(`/api/supply/lots/${lotId}`).set(asSup());
      expect(Number(lotAfterAlloc.body.available_qty)
        - Number(lotAfterAlloc.body.reserved_qty) - Number(lotAfterAlloc.body.allocated_qty)).toBe(10);

      // Pack -> READY_FOR_DISPATCH -> ship -> dispatch -> POD.
      await t.http.post('/api/logistics/pack').set(asSup()).set('Idempotency-Key', idem('k1-pk'))
        .send({ orderId: fx.orderId, supplierAllocationLineId: fx.salLineId, lotId, packedQty: qty, uomId: stemUom, packType: 'CARTON' });
      await t.http.post(`/api/orders/${fx.orderId}/transition`).set(asBuyer()).send({ to: 'QC_PACK' });
      await t.http.post(`/api/orders/${fx.orderId}/transition`).set(asBuyer()).send({ to: 'READY_FOR_DISPATCH' });
      const shp = await t.http.post('/api/logistics/shipments').set(asBuyer()).set('Idempotency-Key', idem('k1-sh'))
        .send({ orderId: fx.orderId, mode: 'REEFER_ROAD', tempControlled: true, carrierName: 'Pilot Logistics', transportRef: 'KA-01-1234' });
      await t.http.post(`/api/logistics/shipments/${shp.body.id}/dispatch`).set(asBuyer()).set('Idempotency-Key', idem('k1-di'));
      await t.http.post(`/api/logistics/shipments/${shp.body.id}/pod`).set(asBuyer()).set('Idempotency-Key', idem('k1-pod'))
        .send({ deliveredQty: qty, receiverName: 'Buyer Gate' });
      // POD: shipment DELIVERED; order DELIVERED -> ACCEPTANCE_PENDING (awaiting buyer).
      expect((await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer())).body.status).toBe('ACCEPTANCE_PENDING');

      // Buyer acceptance.
      const accept = await t.http.post(`/api/orders/${fx.orderId}/accept`).set(asBuyer()).send({ acceptedQty: qty });
      expect(accept.body.status).toBe('ACCEPTED');

      // Claim raised, responded, resolved with a financial adjustment.
      const claim = await t.http.post('/api/claims').set(asBuyer()).set('Idempotency-Key', idem('k1-cl'))
        .send({ orderId: fx.orderId, category: 'QUALITY_MISMATCH', description: 'minor bruising on 5 stems', disputedQty: 5 });
      await t.http.post(`/api/claims/${claim.body.id}/submit`).set(asBuyer()).set('Idempotency-Key', idem('k1-clsub'));
      await t.http.post(`/api/claims/${claim.body.id}/respond`).set(asSup()).send({ response: 'acknowledged' });
      await t.http.post(`/api/claims/${claim.body.id}/transition`).set(asOps()).send({ to: 'UNDER_REVIEW' });
      await t.http.post(`/api/claims/${claim.body.id}/transition`).set(asOps()).send({ to: 'PROPOSED_RESOLUTION' });
      await t.http.post(`/api/claims/${claim.body.id}/transition`).set(asOps()).send({ to: 'APPROVED' });
      const adjStep = await t.http.post(`/api/claims/${claim.body.id}/transition`).set(asOps())
        .send({ to: 'FINANCIAL_ADJUSTMENT', adjustmentMinor: 20000, resolutionNote: '₹200 credit' });
      expectOk(adjStep.status);

      // External payment recorded + verified by a second finance user.
      const pay = await t.http.post('/api/finance/payments').set(asFin1()).set('Idempotency-Key', idem('k1-pay'))
        .send({ orderId: fx.orderId, amountMinor: qty * 42000, method: 'RTGS', externalRef: `UTR-K1-${RUN}`, paidAt: PAST });
      expect((await t.http.post(`/api/finance/payments/${pay.body.id}/verify`).set(asFin2())).body.status).toBe('VERIFIED');

      // Supplier settlement: gross - claim adjustment, verified, completed -> order SETTLED.
      const stl = await t.http.post('/api/finance/settlements').set(asFin1()).set('Idempotency-Key', idem('k1-stl'))
        .send({ orderId: fx.orderId, supplierOrgId: supOrg, grossMinor: qty * 42000, claimAdjustmentMinor: 20000, payoutRef: `PO-K1-${RUN}` });
      expect(stl.body.netMinor).toBe(qty * 42000 - 20000);
      await t.http.post(`/api/finance/settlements/${stl.body.id}/verify`).set(asFin2());
      expect((await t.http.post(`/api/finance/settlements/${stl.body.id}/complete`).set(asFin2())).body.status).toBe('COMPLETED');

      // Final invariants.
      const finalOrder = await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer());
      expect(finalOrder.body.status).toBe('SETTLED');
      const finalLot = await t.http.get(`/api/supply/lots/${lotId}`).set(asSup());
      expect(Number(finalLot.body.delivered_qty)).toBe(qty);
      // Dispatch consumes the allocation and locks the lot (single-dispatch pilot model):
      // allocated returns to 0 and the DELIVERED status blocks any further allocation.
      expect(Number(finalLot.body.allocated_qty)).toBe(0);
      expect(finalLot.body.status).toBe('DELIVERED');
      const reallocate = await t.http.post('/api/orders/allocate').set(asBuyer()).set('Idempotency-Key', idem('k1-real'))
        .send({ supplierAllocationLineId: fx.salLineId, lotId, qty: 1 });
      expect(reallocate.status).toBe(409); // LOT_NOT_AVAILABLE — shipped stock can never be resold
      const custody = await t.http.get(`/api/quality/custody/lot/${lotId}`).set(asSup());
      expect((custody.body.items as { event_type: string }[]).map((c) => c.event_type))
        .toEqual(expect.arrayContaining(['QC_HANDOFF', 'PACKED', 'CARRIER_HANDOFF', 'DESTINATION_RECEIPT']));
      const history = finalOrder.body.history as { to_status: string }[];
      expect(history.map((h) => h.to_status)).toEqual(expect.arrayContaining(
        ['PENDING_CONFIRMATION', 'CONFIRMED', 'ALLOCATING', 'SUPPLY_CONFIRMED', 'QC_PACK', 'READY_FOR_DISPATCH',
          'DISPATCHED', 'DELIVERED', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'CLAIM_OPEN', 'SETTLED']));
      // Audit trail covers every critical transition.
      const audit = await pool.query<{ action: string }>(
        `SELECT DISTINCT action FROM core.audit_events WHERE object_id IN ($1, $2, $3, $4, $5)`,
        [fx.orderId, lotId, shp.body.id, claim.body.id, insId]);
      const actions = audit.rows.map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(
        ['order.convert', 'qc.complete', 'shipment.dispatch', 'shipment.pod', 'order.accept', 'claim.create']));
    });
  });
});
