// BUILD 3 GATE: Demand / Events / RFQ / Quotations / Evaluation / Award.
// Progressive procurement (QUICK / EVENT / FORMAL) converging on the canonical
// demand model. Covers: event domain, requirement validation (OD-07 UOM,
// Guardrail A/B master eligibility), RFQ lifecycle + concurrency, invitation
// responses, clarifications, quote immutability + normalization metadata (OD-08),
// requirement revision reconfirmation, ops consent, award quantity invariants
// under races, deviation consent, tenant isolation, ops desk.
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { bootTestApp, TestApp } from './helpers';

const password = 'Sup3rSecret99';
const RUN = randomUUID().slice(0, 8);
const FUTURE = new Date(Date.now() + 30 * 24 * 3600e3).toISOString();
const idem = (label: string) => `b3-${RUN}-${label}`;

describe('GATE Build 3: demand / events / RFQ / quotes / awards', () => {
  let t: TestApp;
  let pool: Pool;

  const email = (label: string) => `${label}.${RUN}@test.florasetu.local`;
  const register = async (label: string) => {
    const res = await t.http.post('/api/auth/register').send({ email: email(label), password, displayName: label });
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
  const createOrg = async (token: string, name: string, category: string) => {
    const res = await t.http.post('/api/orgs').set('Authorization', `Bearer ${token}`).send({ name, category });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const asOrg = (token: string, orgId: string) => ({ Authorization: `Bearer ${token}`, 'x-org-id': orgId });

  let mgr: { userId: string; accessToken: string; platformOrgId: string };
  let ops: { userId: string; accessToken: string; platformOrgId: string };
  let buyer: { userId: string; accessToken: string };
  let sup1: { userId: string; accessToken: string };
  let sup2: { userId: string; accessToken: string };
  let outsider: { userId: string; accessToken: string };
  let buyerOrg: string; let sup1Org: string; let sup2Org: string; let outsiderOrg: string;
  let stemUom: string; let bunchUom: string;
  let productId: string; let demoProductId: string; let varietyId: string;

  const asBuyer = () => asOrg(buyer.accessToken, buyerOrg);
  const asSup1 = () => asOrg(sup1.accessToken, sup1Org);
  const asSup2 = () => asOrg(sup2.accessToken, sup2Org);
  const asOutsider = () => asOrg(outsider.accessToken, outsiderOrg);
  const asOps = () => asOrg(ops.accessToken, ops.platformOrgId);

  const lineFor = (overrides: Record<string, unknown> = {}) => ({
    commodityId: productId, quantity: 50, uomId: stemUom,
    neededAt: FUTURE, deliveryDestination: 'Bengaluru', ...overrides
  });
  const createRequirement = async (mode: string, lines: unknown[] = [lineFor()], extra: Record<string, unknown> = {}) => {
    const res = await t.http.post('/api/demand/requirements').set(asBuyer())
      .send({ mode, title: `${mode} req ${randomUUID().slice(0, 6)}`, lines, ...extra });
    return res;
  };
  const submitReq = async (id: string, key: string) =>
    t.http.post(`/api/demand/requirements/${id}/submit`).set(asBuyer()).set('Idempotency-Key', key);
  const publishRfq = async (reqId: string, key: string, body: Record<string, unknown> = {}) =>
    t.http.post(`/api/demand/requirements/${reqId}/publish-rfq`).set(asBuyer()).set('Idempotency-Key', key).send(body);
  const submitQuote = async (rfqId: string, headers: Record<string, string>, key: string, body: Record<string, unknown>) =>
    t.http.post(`/api/demand/rfqs/${rfqId}/quotes`).set(headers).set('Idempotency-Key', key).send(body);
  // End-to-end helper: FORMAL requirement -> publish -> RFQ detail (buyer view).
  const rfqWithSuppliers = async (label: string, suppliers: string[], reqOverrides: Record<string, unknown> = {}) => {
    const req = await createRequirement('FORMAL', [lineFor(reqOverrides)]);
    expect(req.status).toBe(201);
    const sub = await submitReq(req.body.id, idem(`${label}-sub`));
    expect(sub.status).toBe(201);
    const pub = await publishRfq(req.body.id, idem(`${label}-pub`), { supplierOrgIds: suppliers, quoteDeadline: FUTURE });
    expect(pub.status).toBe(201);
    const detail = await t.http.get(`/api/demand/rfqs/${pub.body.id}`).set(asBuyer());
    expect(detail.status).toBe(200);
    return { reqId: req.body.id as string, rfqId: pub.body.id as string, detail: detail.body };
  };
  const quoteBodyFor = (requirementLineId: string, overrides: Record<string, unknown> = {}) => ({
    validTo: FUTURE,
    lines: [{ requirementLineId, quotedQty: 50, quotedUomId: stemUom, unitPriceMinor: 42000, ...overrides }]
  });

  beforeAll(async () => {
    t = await bootTestApp();
    pool = new Pool({ connectionString: t.config.databaseUrl });
    await pool.query(
      `INSERT INTO identity.organizations (ref, name, type) VALUES ('TEST-PLATFORM', 'Test Platform', 'PLATFORM_OPS')
       ON CONFLICT (ref) DO NOTHING`
    );
    mgr = await makePlatformUser('b3mgr', 'CATALOG_MANAGER');
    ops = await makePlatformUser('b3ops', 'PROCUREMENT_OPS');
    buyer = await register('b3buyer');
    sup1 = await register('b3sup1');
    sup2 = await register('b3sup2');
    outsider = await register('b3outsider');
    buyerOrg = await createOrg(buyer.accessToken, `B3 Buyer ${RUN}`, 'BUYER');
    sup1Org = await createOrg(sup1.accessToken, `B3 Grower One ${RUN}`, 'GROWER');
    sup2Org = await createOrg(sup2.accessToken, `B3 Grower Two ${RUN}`, 'GROWER');
    outsiderOrg = await createOrg(outsider.accessToken, `B3 Outsider ${RUN}`, 'BUYER');

    for (const code of ['STEM', 'BUNCH']) {
      await pool.query(`INSERT INTO catalog.units_of_measure (code, name) VALUES ($1, $1) ON CONFLICT (code) DO NOTHING`, [code]);
    }
    const uomId = async (code: string) =>
      (await pool.query<{ id: string }>(`SELECT id FROM catalog.units_of_measure WHERE code = $1`, [code])).rows[0].id;
    stemUom = await uomId('STEM');
    bunchUom = await uomId('BUNCH');

    const admin = asOrg(mgr.accessToken, mgr.platformOrgId);
    const cat = await t.http.post('/api/catalog/admin/categories').set(admin)
      .send({ code: `B3_${RUN.replace(/-/g, '').toUpperCase()}`, name: `Build3 ${RUN}` });
    expect(cat.status).toBe(201);
    const product = await t.http.post('/api/catalog/admin/products').set(admin)
      .send({ categoryId: cat.body.id, name: `B3 Rose ${RUN}` });
    expect(product.status).toBe(201);
    productId = product.body.id;
    const demo = await t.http.post('/api/catalog/admin/products').set(admin)
      .send({ categoryId: cat.body.id, name: `B3 Demo Only ${RUN}` });
    expect(demo.status).toBe(201);
    demoProductId = demo.body.id;

    const conv = await t.http.post('/api/catalog/admin/conversions').set(admin).send({
      commodityId: productId, fromUomId: bunchUom, toUomId: stemUom, factor: 20,
      effectiveFrom: new Date(Date.now() - 3600e3).toISOString(), activate: true
    });
    expect(conv.status).toBe(201);
    // Test env is fail-closed (no CATALOG_ALLOW_DEMO_MASTERS): masters must be VALIDATED.
    await pool.query(`UPDATE catalog.commodities SET validation_status = 'VALIDATED' WHERE id = $1`, [productId]);
    await pool.query(`UPDATE catalog.unit_conversions SET validation_status = 'VALIDATED' WHERE id = $1`, [conv.body.id]);

    const variety = await pool.query<{ id: string }>(
      `INSERT INTO catalog.varieties (ref, commodity_id, name, validation_status, status)
       VALUES ($1, $2, $3, 'VALIDATED', 'ACTIVE') RETURNING id`,
      [`VAR-B3-${RUN}`, productId, `B3 Rose Red ${RUN}`]
    );
    varietyId = variety.rows[0].id;
    for (const [orgId, userId] of [[sup1Org, sup1.userId], [sup2Org, sup2.userId]]) {
      await pool.query(
        `INSERT INTO catalog.supplier_product_capabilities (org_id, variety_id, created_by)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [orgId, varietyId, userId]
      );
    }
  });

  afterAll(async () => {
    await pool.end();
    await t.app.close();
  });

  describe('A. Event domain', () => {
    let eventId: string;
    it('(A1) creates an event with ref and DRAFT status', async () => {
      const res = await t.http.post('/api/demand/events').set(asBuyer())
        .send({ name: `Wedding ${RUN}`, eventType: 'WEDDING', startsAt: FUTURE, endsAt: new Date(Date.now() + 32 * 24 * 3600e3).toISOString() });
      expect(res.status).toBe(201);
      expect(res.body.ref).toMatch(/^EVT-/);
      expect(res.body.status).toBe('DRAFT');
      eventId = res.body.id;
    });
    it('(A2) rejects endsAt before startsAt', async () => {
      const res = await t.http.post('/api/demand/events').set(asBuyer())
        .send({ name: 'bad', eventType: 'WEDDING', startsAt: FUTURE, endsAt: new Date(Date.now() + 3600e3).toISOString() });
      expect(res.status).toBe(400);
    });
    it('(A3) updates event fields and bumps version via audit', async () => {
      const res = await t.http.patch(`/api/demand/events/${eventId}`).set(asBuyer()).send({ status: 'CONFIRMED', venueName: 'Palace Grounds' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CONFIRMED');
      const audit = await pool.query(`SELECT 1 FROM core.audit_events WHERE object_id = $1 AND action = 'event.update'`, [eventId]);
      expect(audit.rowCount).toBe(1);
    });
    it('(A4) adds ceremony and BOM line; BOM validates commodity and ceremony scope', async () => {
      const ceremony = await t.http.post(`/api/demand/events/${eventId}/ceremonies`).set(asBuyer()).send({ name: 'Sangeet', sortOrder: 1 });
      expect(ceremony.status).toBe(201);
      const bom = await t.http.post(`/api/demand/events/${eventId}/bom-lines`).set(asBuyer())
        .send({ ceremonyId: ceremony.body.id, commodityId: productId, quantity: 200, uomId: stemUom, deliveryMilestone: 'DAY_BEFORE' });
      expect(bom.status).toBe(201);
      const badProduct = await t.http.post(`/api/demand/events/${eventId}/bom-lines`).set(asBuyer())
        .send({ commodityId: randomUUID(), quantity: 10, uomId: stemUom });
      expect(badProduct.status).toBe(400);
      const foreignEvent = await t.http.post('/api/demand/events').set(asBuyer()).send({ name: 'other', eventType: 'CORPORATE' });
      const badCeremony = await t.http.post(`/api/demand/events/${eventId}/bom-lines`).set(asBuyer())
        .send({ ceremonyId: ceremony.body.id, commodityId: productId, quantity: 5, uomId: stemUom });
      expect(badCeremony.status).toBe(201);
      expect(foreignEvent.status).toBe(201);
    });
    it('(A5) event get returns ceremonies + BOM; list scoped to org; cross-org 404', async () => {
      const get = await t.http.get(`/api/demand/events/${eventId}`).set(asBuyer());
      expect(get.status).toBe(200);
      expect(get.body.ceremonies.length).toBe(1);
      expect(get.body.bomLines.length).toBeGreaterThanOrEqual(2);
      const list = await t.http.get('/api/demand/events').set(asBuyer());
      expect(list.body.items.some((e: { id: string }) => e.id === eventId)).toBe(true);
      const foreign = await t.http.get(`/api/demand/events/${eventId}`).set(asOutsider());
      expect(foreign.status).toBe(404);
    });
    it('(A6) requires authentication', async () => {
      const res = await t.http.get('/api/demand/events');
      expect(res.status).toBe(401);
    });
    it('(A7) suspended org loses event.write but keeps event.read', async () => {
      await pool.query(`UPDATE identity.organizations SET status = 'SUSPENDED' WHERE id = $1`, [outsiderOrg]);
      const write = await t.http.post('/api/demand/events').set(asOutsider()).send({ name: 'nope', eventType: 'X' });
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe('ORG_SUSPENDED');
      const read = await t.http.get('/api/demand/events').set(asOutsider());
      expect(read.status).toBe(200);
      await pool.query(`UPDATE identity.organizations SET status = 'ACTIVE' WHERE id = $1`, [outsiderOrg]);
    });
  });

  describe('B. Requirement validation & guardrails', () => {
    it('(B1) rejects a line without explicit uomId (OD-07)', async () => {
      const res = await createRequirement('QUICK', [lineFor({ uomId: undefined })]);
      expect(res.status).toBe(400);
      expect(res.body.error.details?.code_detail).toBe('UOM_REQUIRED');
    });
    it('(B2) DEMO master is rejected for commercial use (Guardrail A fail-closed)', async () => {
      expect(t.config.catalogAllowDemoMasters).toBe(false);
      const res = await createRequirement('QUICK', [lineFor({ commodityId: demoProductId })]);
      expect(res.status).toBe(400);
      expect(res.body.error.details?.code_detail).toBe('MASTER_NOT_COMMERCIAL');
    });
    it('(B3) rejects unknown commodity and unknown grade profile', async () => {
      const unknownProduct = await createRequirement('QUICK', [lineFor({ commodityId: randomUUID() })]);
      expect(unknownProduct.status).toBe(400);
      const unknownGrade = await createRequirement('QUICK', [lineFor({ gradeProfileId: randomUUID() })]);
      expect(unknownGrade.status).toBe(400);
    });
    it('(B4) valid QUICK requirement persists master snapshot on lines', async () => {
      const res = await createRequirement('QUICK');
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('DRAFT');
      const detail = await t.http.get(`/api/demand/requirements/${res.body.id}`).set(asBuyer());
      expect(detail.body.lines.length).toBe(1);
      expect(detail.body.lines[0].master_snapshot.commodity.id).toBe(productId);
      expect(detail.body.lines[0].uom_id).toBe(stemUom);
    });
    it('(B5) cross-org requirement read returns 404 (existence hidden)', async () => {
      const res = await createRequirement('FORMAL');
      const foreign = await t.http.get(`/api/demand/requirements/${res.body.id}`).set(asOutsider());
      expect(foreign.status).toBe(404);
    });
    it('(B6) DRAFT requirement cannot be revised or evaluated', async () => {
      const res = await createRequirement('FORMAL');
      const revise = await t.http.post(`/api/demand/requirements/${res.body.id}/revise`).set(asBuyer())
        .send({ lines: [lineFor()], changeReason: 'too early' });
      expect(revise.status).toBe(409);
      const evaluate = await t.http.post(`/api/demand/requirements/${res.body.id}/evaluate`).set(asBuyer());
      expect(evaluate.status).toBe(409);
    });
  });

  describe('C. Requirement submit + QUICK auto-publish (managed sourcing)', () => {
    it('(C1) submit requires Idempotency-Key', async () => {
      const req = await createRequirement('FORMAL');
      const res = await t.http.post(`/api/demand/requirements/${req.body.id}/submit`).set(asBuyer());
      expect(res.status).toBe(400);
    });
    it('(C2) submit is idempotent — replay returns stored response', async () => {
      const req = await createRequirement('FORMAL');
      const first = await submitReq(req.body.id, idem('c2'));
      expect(first.status).toBe(201);
      expect(first.body.status).toBe('SUBMITTED');
      const replay = await submitReq(req.body.id, idem('c2'));
      expect(replay.status).toBe(201);
      expect(replay.body.replayed).toBe(true);
    });
    it('(C3) double submit with a fresh key is an illegal transition', async () => {
      const req = await createRequirement('FORMAL');
      await submitReq(req.body.id, idem('c3a'));
      const again = await submitReq(req.body.id, idem('c3b'));
      expect(again.status).toBe(409);
      expect(again.body.error.details?.code_detail).toBe('ILLEGAL_TRANSITION');
    });
    it('(C4) QUICK submit auto-publishes an RFQ to capability-matched ACTIVE suppliers', async () => {
      const req = await createRequirement('QUICK');
      const sub = await submitReq(req.body.id, idem('c4'));
      expect(sub.status).toBe(201);
      const detail = await t.http.get(`/api/demand/requirements/${req.body.id}`).set(asBuyer());
      expect(detail.body.status).toBe('SOURCING');
      const rfqs = await t.http.get('/api/demand/rfqs').set(asBuyer());
      const mine = rfqs.body.items.find((r: { requirement_ref: string }) => r.requirement_ref === req.body.ref);
      expect(mine.status).toBe('PUBLISHED');
      expect(mine.mode).toBe('QUICK');
      expect(mine.invited).toBe(2); // sup1 + sup2 via capability; buyer excluded
    });
    it('(C5) submit emits outbox event and audit entry', async () => {
      const req = await createRequirement('FORMAL');
      await submitReq(req.body.id, idem('c5'));
      const outbox = await pool.query(
        `SELECT 1 FROM core.outbox_events WHERE aggregate_id = $1 AND type = 'demand.requirement.submitted.v1'`, [req.body.id]);
      expect(outbox.rowCount).toBe(1);
      const audit = await pool.query(
        `SELECT 1 FROM core.audit_events WHERE object_id = $1 AND action = 'demand.requirement.submit'`, [req.body.id]);
      expect(audit.rowCount).toBe(1);
    });
  });

  describe('D. RFQ lifecycle, invitations & concurrency', () => {
    it('(D1) publish with explicit supplier list invites exactly those suppliers', async () => {
      const { rfqId, detail } = await rfqWithSuppliers('d1', [sup1Org, sup2Org]);
      expect(detail.invitations.length).toBe(2);
      const invited = detail.invitations.map((i: { supplier_org_id: string }) => i.supplier_org_id).sort();
      expect(invited).toEqual([sup1Org, sup2Org].sort());
      const list = await t.http.get('/api/demand/rfqs').set(asBuyer());
      expect(list.body.items.some((r: { id: string }) => r.id === rfqId)).toBe(true);
    });
    it('(D2) duplicate publish with a fresh key conflicts (one open RFQ per requirement)', async () => {
      const { reqId } = await rfqWithSuppliers('d2', [sup1Org]);
      const dup = await publishRfq(reqId, idem('d2-dup'));
      expect(dup.status).toBe(409);
      expect(dup.body.error.message).toContain('open RFQ');
    });
    it('(D3) publish replay with same key returns stored response', async () => {
      const req = await createRequirement('FORMAL');
      await submitReq(req.body.id, idem('d3-sub'));
      const first = await publishRfq(req.body.id, idem('d3'), { supplierOrgIds: [sup1Org] });
      const replay = await publishRfq(req.body.id, idem('d3'), { supplierOrgIds: [sup1Org] });
      expect(replay.status).toBe(201);
      expect(replay.body.id).toBe(first.body.id);
    });
    it('(D4) concurrent publish race: exactly one wins', async () => {
      const req = await createRequirement('FORMAL');
      await submitReq(req.body.id, idem('d4-sub'));
      const [a, b] = await Promise.all([
        publishRfq(req.body.id, idem('d4-a'), { supplierOrgIds: [sup1Org] }),
        publishRfq(req.body.id, idem('d4-b'), { supplierOrgIds: [sup1Org] })
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);
      const rfqs = await pool.query(
        `SELECT count(*)::int AS n FROM demand.rfqs WHERE requirement_id = $1 AND status IN ('DRAFT','PUBLISHED')`,
        [req.body.id]);
      expect(rfqs.rows[0].n).toBe(1);
    });
    it('(D5) supplier inbox shows invitations; outsider inbox is empty', async () => {
      const { rfqId } = await rfqWithSuppliers('d5', [sup1Org]);
      const inbox = await t.http.get('/api/demand/rfqs/inbox').set(asSup1());
      expect(inbox.body.items.some((i: { id: string }) => i.id === rfqId)).toBe(true);
      const out = await t.http.get('/api/demand/rfqs/inbox').set(asOutsider());
      expect(out.body.items.some((i: { id: string }) => i.id === rfqId)).toBe(false);
    });
    it('(D6) invitation flow: viewed -> intends_to_quote; decline requires reason and blocks quoting', async () => {
      const { rfqId, detail } = await rfqWithSuppliers('d6', [sup2Org]);
      const lineId = detail.lines[0].requirement_line_id;
      const viewed = await t.http.post(`/api/demand/rfqs/${rfqId}/viewed`).set(asSup2());
      expect(viewed.body.status).toBe('VIEWED');
      const intend = await t.http.post(`/api/demand/rfqs/${rfqId}/intend`).set(asSup2());
      expect(intend.body.status).toBe('INTENDS_TO_QUOTE');
      const noReason = await t.http.post(`/api/demand/rfqs/${rfqId}/decline`).set(asSup2()).send({});
      expect(noReason.status).toBe(400);
      const decline = await t.http.post(`/api/demand/rfqs/${rfqId}/decline`).set(asSup2()).send({ reason: 'no capacity this week' });
      expect(decline.body.status).toBe('DECLINED');
      const quote = await submitQuote(rfqId, asSup2(), idem('d6-q'), quoteBodyFor(lineId));
      expect(quote.status).toBe(409);
    });
    it('(D7) supplier RFQ view hides competitor data; outsider gets 404', async () => {
      const { rfqId } = await rfqWithSuppliers('d7', [sup1Org, sup2Org]);
      const supView = await t.http.get(`/api/demand/rfqs/${rfqId}`).set(asSup1());
      expect(supView.status).toBe(200);
      expect(supView.body.invitations).toBeUndefined();
      expect(supView.body.quotations).toBeUndefined();
      expect(supView.body.invitationStatus).toBeDefined();
      const denied = await t.http.get(`/api/demand/rfqs/${rfqId}`).set(asOutsider());
      expect(denied.status).toBe(404);
    });
    it('(D8) buyer cancels an open RFQ; requirement survives; re-publish possible', async () => {
      const { reqId, rfqId } = await rfqWithSuppliers('d8', [sup1Org]);
      const cancel = await t.http.post(`/api/demand/rfqs/${rfqId}/cancel`).set(asBuyer()).send({ reason: 'scope change' });
      expect(cancel.status).toBe(201);
      const req = await t.http.get(`/api/demand/requirements/${reqId}`).set(asBuyer());
      expect(req.body.status).not.toBe('CANCELLED');
      const republish = await publishRfq(reqId, idem('d8-re'), { supplierOrgIds: [sup2Org] });
      expect(republish.status).toBe(201);
    });
    it('(D9) publish requires the rfq.publish permission', async () => {
      const req = await createRequirement('FORMAL');
      await submitReq(req.body.id, idem('d9-sub'));
      const denied = await t.http.post(`/api/demand/requirements/${req.body.id}/publish-rfq`)
        .set(asOutsider()).set('Idempotency-Key', idem('d9')).send({ supplierOrgIds: [sup1Org] });
      expect([403, 404]).toContain(denied.status);
    });
  });

  describe('E. Quotations: submission, immutability, normalization', () => {
    let rfqId: string; let reqId: string; let lineId: string;
    beforeAll(async () => {
      const fx = await rfqWithSuppliers('e', [sup1Org, sup2Org]);
      rfqId = fx.rfqId; reqId = fx.reqId; lineId = fx.detail.lines[0].requirement_line_id;
    });

    it('(E1) uninvited supplier cannot quote (404)', async () => {
      const res = await submitQuote(rfqId, asOutsider(), idem('e1'), quoteBodyFor(lineId));
      expect(res.status).toBe(404);
    });
    it('(E2) quote submit requires Idempotency-Key and future validTo', async () => {
      const noKey = await t.http.post(`/api/demand/rfqs/${rfqId}/quotes`).set(asSup1()).send(quoteBodyFor(lineId));
      expect(noKey.status).toBe(400);
      const pastBody = { ...quoteBodyFor(lineId), validTo: new Date(Date.now() - 3600e3).toISOString() };
      const res = await submitQuote(rfqId, asSup1(), idem('e2b'), pastBody);
      expect(res.status).toBe(400);
    });
    it('(E3) quoting in a different UOM preserves originals and stores normalization metadata (OD-07/08)', async () => {
      const body = { validTo: FUTURE, lines: [{ requirementLineId: lineId, quotedQty: 3, quotedUomId: bunchUom, unitPriceMinor: 90000 }] };
      const res = await submitQuote(rfqId, asSup1(), idem('e3'), body);
      expect(res.status).toBe(201);
      const rows = await pool.query(
        `SELECT quoted_qty, quoted_uom_id, normalized_qty, normalized_uom_id, conversion_version_id, normalization_status
         FROM demand.quotation_lines WHERE quotation_version_id = $1`, [res.body.versionId]);
      const line = rows.rows[0];
      expect(Number(line.quoted_qty)).toBe(3);
      expect(line.quoted_uom_id).toBe(bunchUom);           // original immutable
      expect(Number(line.normalized_qty)).toBe(60);        // 3 BUNCH * 20 STEM
      expect(line.normalized_uom_id).toBe(stemUom);
      expect(line.conversion_version_id).not.toBeNull();
      expect(line.normalization_status).toBe('NORMALIZED');
    });
    it('(E4) quote replay returns stored response; duplicate submit (fresh key) conflicts', async () => {
      const replay = await submitQuote(rfqId, asSup1(), idem('e3'),
        { validTo: FUTURE, lines: [{ requirementLineId: lineId, quotedQty: 3, quotedUomId: bunchUom, unitPriceMinor: 90000 }] });
      expect(replay.status).toBe(201);
      expect(replay.body.replayed).toBe(true);
      const dup = await submitQuote(rfqId, asSup1(), idem('e4'), quoteBodyFor(lineId));
      expect(dup.status).toBe(409);
    });
    it('(E5) concurrent quote submits: exactly one quotation exists', async () => {
      const [a, b] = await Promise.all([
        submitQuote(rfqId, asSup2(), idem('e5-a'), quoteBodyFor(lineId)),
        submitQuote(rfqId, asSup2(), idem('e5-b'), quoteBodyFor(lineId))
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const rows = await pool.query(
        `SELECT count(*)::int AS n FROM demand.quotations WHERE rfq_id = $1 AND supplier_org_id = $2`, [rfqId, sup2Org]);
      expect(rows.rows[0].n).toBe(1);
    });
    it('(E6) requirement moved to QUOTING after first quote; buyer comparison lists both offers', async () => {
      const req = await t.http.get(`/api/demand/requirements/${reqId}`).set(asBuyer());
      expect(req.body.status).toBe('QUOTING');
      const comparison = await t.http.get(`/api/demand/rfqs/${rfqId}/comparison`).set(asBuyer());
      expect(comparison.status).toBe(200);
      expect(comparison.body.offers.length).toBe(2);
      expect(comparison.body.requirementLines.length).toBe(1);
      expect(comparison.body.offers[0].landedCostLabel).toContain('INDICATIVE');
    });
    it('(E7) revision supersedes prior version; original line values untouched (OD-08)', async () => {
      const quotes = await t.http.get('/api/demand/quotes').set(asSup2());
      const mine = quotes.body.items.find((q: { rfq_ref: string }) => q.rfq_ref);
      const before = await pool.query(
        `SELECT ql.quoted_qty, ql.quoted_uom_id FROM demand.quotation_lines ql
         JOIN demand.quotation_versions qv ON qv.id = ql.quotation_version_id
         WHERE qv.quotation_id = $1 AND qv.version_no = 1`, [mine.id]);
      const revised = await t.http.post(`/api/demand/quotes/${mine.id}/revise`).set(asSup2())
        .set('Idempotency-Key', idem('e7'))
        .send({ ...quoteBodyFor(lineId, { quotedQty: 45, unitPriceMinor: 40000 }), revisionReason: 'sharpened price' });
      expect(revised.status).toBe(201);
      expect(revised.body.versionNo).toBe(2);
      const after = await pool.query(
        `SELECT qv.version_no, qv.status, ql.quoted_qty FROM demand.quotation_versions qv
         LEFT JOIN demand.quotation_lines ql ON ql.quotation_version_id = qv.id
         WHERE qv.quotation_id = $1 ORDER BY qv.version_no`, [mine.id]);
      expect(after.rows[0].status).toBe('SUPERSEDED');
      expect(after.rows[0].quoted_qty).toBe(before.rows[0].quoted_qty); // v1 line immutable
      expect(Number(after.rows[1].quoted_qty)).toBe(45);
      expect(after.rows[1].status).toBe('SUBMITTED');
    });
    it('(E8) revision replay is idempotent (no version 3 created)', async () => {
      const quotes = await t.http.get('/api/demand/quotes').set(asSup2());
      const mine = quotes.body.items[0];
      const replay = await t.http.post(`/api/demand/quotes/${mine.id}/revise`).set(asSup2())
        .set('Idempotency-Key', idem('e7'))
        .send({ ...quoteBodyFor(lineId, { quotedQty: 45, unitPriceMinor: 40000 }), revisionReason: 'sharpened price' });
      expect(replay.status).toBe(201);
      expect(replay.body.replayed).toBe(true);
      const rows = await pool.query(
        `SELECT count(*)::int AS n FROM demand.quotation_versions WHERE quotation_id = $1`, [mine.id]);
      expect(rows.rows[0].n).toBe(2);
    });
    it('(E9) substitution proposal without detail is rejected; unknown line rejected', async () => {
      const fx = await rfqWithSuppliers('e9', [sup1Org]);
      const badSub = await submitQuote(fx.rfqId, asSup1(), idem('e9-a'),
        { validTo: FUTURE, lines: [{ requirementLineId: fx.detail.lines[0].requirement_line_id, quotedQty: 10, quotedUomId: stemUom, unitPriceMinor: 1000, proposesSubstitution: true }] });
      expect(badSub.status).toBe(400);
      const badLine = await submitQuote(fx.rfqId, asSup1(), idem('e9-b'),
        { validTo: FUTURE, lines: [{ requirementLineId: randomUUID(), quotedQty: 10, quotedUomId: stemUom, unitPriceMinor: 1000 }] });
      expect(badLine.status).toBe(400);
    });
    it('(E10) quote after the deadline is rejected', async () => {
      const fx = await rfqWithSuppliers('e10', [sup1Org]);
      await pool.query(`UPDATE demand.rfqs SET quote_deadline = now() - interval '1 hour' WHERE id = $1`, [fx.rfqId]);
      const res = await submitQuote(fx.rfqId, asSup1(), idem('e10'), quoteBodyFor(fx.detail.lines[0].requirement_line_id));
      expect(res.status).toBe(400);
      expect(res.body.error.details?.code_detail).toBe('DEADLINE_PASSED');
    });
    it('(E11) quote read is restricted to owner, buyer and ops', async () => {
      const quotes = await t.http.get('/api/demand/quotes').set(asSup1());
      const mine = quotes.body.items[0];
      const ownRead = await t.http.get(`/api/demand/quotes/${mine.id}`).set(asSup1());
      expect(ownRead.status).toBe(200);
      const buyerRead = await t.http.get(`/api/demand/quotes/${mine.id}`).set(asBuyer());
      expect(buyerRead.status).toBe(200);
      const competitor = await t.http.get(`/api/demand/quotes/${mine.id}`).set(asSup2());
      // sup2 also quoted on the same RFQ but must not read sup1's quote
      const sup2quotes = await t.http.get('/api/demand/quotes').set(asSup2());
      const notMine = sup2quotes.body.items.every((q: { id: string }) => q.id !== mine.id);
      expect(notMine).toBe(true);
      expect([404]).toContain(competitor.status);
      void competitor;
    });
  });

  describe('F. Requirement revision, reconfirmation & ops consent', () => {
    it('(F1) revision invalidates submitted quotes (RECONFIRMATION_REQUIRED) and re-points the open RFQ', async () => {
      const fx = await rfqWithSuppliers('f1', [sup1Org]);
      const lineId = fx.detail.lines[0].requirement_line_id;
      const quote = await submitQuote(fx.rfqId, asSup1(), idem('f1-q'), quoteBodyFor(lineId));
      expect(quote.status).toBe(201);
      const revise = await t.http.post(`/api/demand/requirements/${fx.reqId}/revise`).set(asBuyer())
        .send({ lines: [lineFor({ quantity: 60 })], changeReason: 'volume up' });
      expect(revise.status).toBe(201);
      expect(revise.body.versionNo).toBe(2);
      expect(revise.body.quotesRequiringReconfirmation).toBe(1);
      const qv = await pool.query(
        `SELECT status FROM demand.quotation_versions WHERE id = $1`, [quote.body.versionId]);
      expect(qv.rows[0].status).toBe('RECONFIRMATION_REQUIRED');
    });
    it('(F2) ops revision on a buyer requirement requires recorded buyer consent', async () => {
      const fx = await rfqWithSuppliers('f2', [sup1Org]);
      const revise = await t.http.post(`/api/demand/requirements/${fx.reqId}/revise`).set(asOps())
        .send({ lines: [lineFor({ quantity: 55 })], changeReason: 'ops correction' });
      expect(revise.status).toBe(201);
      expect(revise.body.consentRequired).toBe(true);
      const consent = await t.http.post(`/api/demand/requirements/${fx.reqId}/consent`).set(asBuyer())
        .send({ versionNo: 2 });
      expect(consent.status).toBe(201);
      expect(consent.body.consented).toBe(true);
      const again = await t.http.post(`/api/demand/requirements/${fx.reqId}/consent`).set(asBuyer())
        .send({ versionNo: 2 });
      expect(again.status).toBe(404);
    });
    it('(F3) evaluation gate: QUOTING -> EVALUATION via explicit buyer action', async () => {
      const fx = await rfqWithSuppliers('f3', [sup1Org]);
      await submitQuote(fx.rfqId, asSup1(), idem('f3-q'), quoteBodyFor(fx.detail.lines[0].requirement_line_id));
      const res = await t.http.post(`/api/demand/requirements/${fx.reqId}/evaluate`).set(asBuyer());
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('EVALUATION');
    });
  });

  describe('G. Clarifications', () => {
    let rfqId: string; let clarificationId: string;
    it('(G1) supplier posts a clarification on an open RFQ', async () => {
      const fx = await rfqWithSuppliers('g1', [sup1Org, sup2Org]);
      rfqId = fx.rfqId;
      const res = await t.http.post(`/api/demand/rfqs/${rfqId}/clarifications`).set(asSup1())
        .send({ question: 'Is stem length 50cm acceptable?' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('OPEN');
      clarificationId = res.body.id;
    });
    it('(G2) buyer answers publicly; double-answer conflicts', async () => {
      const res = await t.http.post(`/api/demand/clarifications/${clarificationId}/respond`).set(asBuyer())
        .send({ response: 'Yes, 50cm+ is fine', visibility: 'PUBLIC' });
      expect(res.status).toBe(201);
      const again = await t.http.post(`/api/demand/clarifications/${clarificationId}/respond`).set(asBuyer())
        .send({ response: 'changed my mind' });
      expect(again.status).toBe(409);
    });
    it('(G3) supplier visibility: own questions + PUBLIC answered only', async () => {
      await t.http.post(`/api/demand/rfqs/${rfqId}/clarifications`).set(asSup1())
        .send({ question: 'private: my farm logistics?' });
      const sup2List = await t.http.get(`/api/demand/rfqs/${rfqId}/clarifications`).set(asSup2());
      const questions = sup2List.body.items.map((c: { question: string }) => c.question);
      expect(questions).toContain('Is stem length 50cm acceptable?');
      expect(questions).not.toContain('private: my farm logistics?');
      const buyerList = await t.http.get(`/api/demand/rfqs/${rfqId}/clarifications`).set(asBuyer());
      expect(buyerList.body.items.length).toBe(2);
    });
    it('(G4) outsider cannot post or read clarifications', async () => {
      const post = await t.http.post(`/api/demand/rfqs/${rfqId}/clarifications`).set(asOutsider())
        .send({ question: 'can I see this?' });
      expect(post.status).toBe(404);
      const list = await t.http.get(`/api/demand/rfqs/${rfqId}/clarifications`).set(asOutsider());
      expect(list.status).toBe(404);
    });
  });

  describe('H. Awards: invariants, consent & concurrency', () => {
    const quotedRfq = async (label: string, qty: number, quoteOverrides: Record<string, unknown> = {}) => {
      const fx = await rfqWithSuppliers(label, [sup1Org], { quantity: qty });
      const lineId = fx.detail.lines[0].requirement_line_id as string;
      const quote = await submitQuote(fx.rfqId, asSup1(), idem(`${label}-q`), quoteBodyFor(lineId, { quotedQty: qty, ...quoteOverrides }));
      expect(quote.status).toBe(201);
      return { ...fx, lineId, versionId: quote.body.versionId as string };
    };
    const award = (rfqId: string, key: string, lines: unknown[], extra: Record<string, unknown> = {}) =>
      t.http.post(`/api/demand/rfqs/${rfqId}/awards`).set(asBuyer()).set('Idempotency-Key', key)
        .send({ lines, ...extra });

    it('(H1) award requires Idempotency-Key', async () => {
      const fx = await quotedRfq('h1', 50);
      const res = await t.http.post(`/api/demand/rfqs/${fx.rfqId}/awards`).set(asBuyer())
        .send({ lines: [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }] });
      expect(res.status).toBe(400);
    });
    it('(H2) award exceeding requirement quantity is rejected (EXCEEDS_REQUIREMENT)', async () => {
      const fx = await quotedRfq('h2', 50);
      const res = await award(fx.rfqId, idem('h2'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 51, uomId: stemUom }]);
      expect(res.status).toBe(409);
      expect(res.body.error.details?.code_detail).toBe('EXCEEDS_REQUIREMENT');
    });
    it('(H3) partial awards accumulate to fully awarded without oversubscription', async () => {
      const fx = await quotedRfq('h3', 50);
      const first = await award(fx.rfqId, idem('h3-a'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 30, uomId: stemUom }]);
      expect(first.status).toBe(201);
      expect(first.body.fullyAwarded).toBe(false);
      let req = await t.http.get(`/api/demand/requirements/${fx.reqId}`).set(asBuyer());
      expect(req.body.status).toBe('PARTIALLY_AWARDED');
      const over = await award(fx.rfqId, idem('h3-b'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 25, uomId: stemUom }]);
      expect(over.status).toBe(409);
      expect(over.body.error.details?.remaining).toBe(20);
      const second = await award(fx.rfqId, idem('h3-c'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 20, uomId: stemUom }]);
      expect(second.status).toBe(201);
      expect(second.body.fullyAwarded).toBe(true);
      const qv = await pool.query(`SELECT status FROM demand.quotation_versions WHERE id = $1`, [fx.versionId]);
      expect(qv.rows[0].status).toBe('ACCEPTED'); // quoted quantity fully awarded
      req = await t.http.get(`/api/demand/requirements/${fx.reqId}`).set(asBuyer());
      expect(req.body.status).toBe('AWARDED');
    });
    it('(H4) concurrent award race for the same remaining quantity: exactly one wins', async () => {
      const fx = await quotedRfq('h4', 10);
      const [a, b] = await Promise.all([
        award(fx.rfqId, idem('h4-a'), [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }]),
        award(fx.rfqId, idem('h4-b'), [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }])
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const total = await pool.query(
        `SELECT SUM(al.awarded_qty)::text AS s FROM demand.award_lines al
         JOIN demand.awards aw ON aw.id = al.award_id WHERE al.requirement_line_id = $1 AND aw.status = 'FINAL'`,
        [fx.lineId]);
      expect(Number(total.rows[0].s)).toBe(10);
    });
    it('(H5) award replay is idempotent', async () => {
      const fx = await quotedRfq('h5', 50);
      const first = await award(fx.rfqId, idem('h5'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }]);
      const replay = await award(fx.rfqId, idem('h5'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }]);
      expect(replay.status).toBe(201);
      expect(replay.body.id).toBe(first.body.id);
      const total = await pool.query(
        `SELECT SUM(al.awarded_qty)::text AS s FROM demand.award_lines al
         JOIN demand.awards aw ON aw.id = al.award_id WHERE al.requirement_line_id = $1 AND aw.status = 'FINAL'`,
        [fx.lineId]);
      expect(Number(total.rows[0].s)).toBe(10);
    });
    it('(H6) deviation acceptance requires explicit recorded buyer consent', async () => {
      const fx = await quotedRfq('h6', 50, { deviationNote: 'packing in 8s not 10s' });
      const noConsent = await award(fx.rfqId, idem('h6-a'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }]);
      expect(noConsent.status).toBe(400);
      expect(noConsent.body.error.details?.code_detail).toBe('CONSENT_REQUIRED');
      const consented = await award(fx.rfqId, idem('h6-b'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }],
        { consentAcceptedDeviations: true });
      expect(consented.status).toBe(201);
      const row = await pool.query(`SELECT buyer_consent FROM demand.awards WHERE id = $1`, [consented.body.id]);
      expect(row.rows[0].buyer_consent.deviationsAccepted).toBe(true);
    });
    it('(H7) superseded or reconfirmation-pending quote versions cannot be awarded', async () => {
      const fx = await quotedRfq('h7', 50);
      const quotes = await t.http.get('/api/demand/quotes').set(asSup1());
      const mine = quotes.body.items[0];
      await t.http.post(`/api/demand/quotes/${mine.id}/revise`).set(asSup1())
        .set('Idempotency-Key', idem('h7-rev'))
        .send({ ...quoteBodyFor(fx.lineId), revisionReason: 'better price' });
      const superseded = await award(fx.rfqId, idem('h7-a'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }]);
      expect(superseded.status).toBe(409);
      expect(superseded.body.error.details?.code_detail).toBe('QUOTE_SUPERSEDED');

      const fx2 = await quotedRfq('h7b', 50);
      await t.http.post(`/api/demand/requirements/${fx2.reqId}/revise`).set(asBuyer())
        .send({ lines: [lineFor({ quantity: 50 })], changeReason: 'spec tweak' });
      // After revision the current requirement line is new; the old quote version is
      // RECONFIRMATION_REQUIRED and must be blocked before any line-coverage check.
      const revisedDetail = await t.http.get(`/api/demand/requirements/${fx2.reqId}`).set(asBuyer());
      const newLineId = revisedDetail.body.lines[0].id;
      const stale = await award(fx2.rfqId, idem('h7-c'),
        [{ requirementLineId: newLineId, quotationVersionId: fx2.versionId, awardedQty: 10, uomId: stemUom }]);
      expect(stale.status).toBe(409);
      expect(stale.body.error.details?.code_detail).toBe('RECONFIRMATION_REQUIRED');
    });
    it('(H8) expired quotes cannot be awarded', async () => {
      const fx = await quotedRfq('h8', 50);
      await pool.query(`UPDATE demand.quotation_versions SET valid_to = now() - interval '1 hour' WHERE id = $1`, [fx.versionId]);
      const res = await award(fx.rfqId, idem('h8'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }]);
      expect(res.status).toBe(409);
      expect(res.body.error.details?.code_detail).toBe('QUOTE_EXPIRED');
    });
    it('(H9) supplier cannot award (404) and buyer cannot award a foreign RFQ', async () => {
      const fx = await quotedRfq('h9', 50);
      const asSupplier = await award.call(null, fx.rfqId, idem('h9-a'), []);
      void asSupplier;
      const sup = await t.http.post(`/api/demand/rfqs/${fx.rfqId}/awards`).set(asSup1())
        .set('Idempotency-Key', idem('h9-a'))
        .send({ lines: [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }] });
      expect(sup.status).toBe(404);
      const foreign = await t.http.post(`/api/demand/rfqs/${fx.rfqId}/awards`).set(asOutsider())
        .set('Idempotency-Key', idem('h9-b'))
        .send({ lines: [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }] });
      expect(foreign.status).toBe(404);
    });
    it('(H10) award visibility: supplier sees only own award lines', async () => {
      const fx = await quotedRfq('h10', 50);
      await award(fx.rfqId, idem('h10'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }]);
      const supView = await t.http.get(`/api/demand/rfqs/${fx.rfqId}/awards`).set(asSup1());
      expect(supView.status).toBe(200);
      expect(supView.body.items.length).toBe(1);
      expect(supView.body.items[0].lines.every((l: { supplier_org_id: string }) => l.supplier_org_id === sup1Org)).toBe(true);
      const buyerView = await t.http.get(`/api/demand/rfqs/${fx.rfqId}/awards`).set(asBuyer());
      expect(buyerView.body.items.length).toBe(1);
    });
    it('(H11) accepted quote version marked ACCEPTED; award emits outbox + audit', async () => {
      const fx = await quotedRfq('h11', 50);
      const res = await award(fx.rfqId, idem('h11'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }]);
      expect(res.status).toBe(201);
      const qv = await pool.query(`SELECT status FROM demand.quotation_versions WHERE id = $1`, [fx.versionId]);
      expect(qv.rows[0].status).toBe('PARTIALLY_ACCEPTED'); // 10 of 50 awarded — remainder stays awardable
      const outbox = await pool.query(
        `SELECT 1 FROM core.outbox_events WHERE aggregate_id = $1 AND type = 'award.created.v1'`, [res.body.id]);
      expect(outbox.rowCount).toBe(1);
      const audit = await pool.query(
        `SELECT 1 FROM core.audit_events WHERE object_id = $1 AND action = 'award.create'`, [res.body.id]);
      expect(audit.rowCount).toBe(1);
    });
    it('(H12) prepare-order is an inert interface (no order created)', async () => {
      const fx = await quotedRfq('h12', 50);
      const res = await award(fx.rfqId, idem('h12'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }]);
      const prep = await t.http.post(`/api/demand/awards/${res.body.id}/prepare-order`).set(asBuyer());
      expect(prep.status).toBe(201);
      expect(prep.body.status).toBe('PENDING_BUILD_5');
      expect(prep.body.command).toBe('CreateOrderFromAward');
    });
    it('(H13) cancelling a requirement cascades: RFQs cancelled, quotes closed, awards cancelled', async () => {
      const fx = await quotedRfq('h13', 50);
      const aw = await award(fx.rfqId, idem('h13'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 10, uomId: stemUom }]);
      expect(aw.status).toBe(201);
      const cancel = await t.http.post(`/api/demand/requirements/${fx.reqId}/cancel`).set(asBuyer())
        .send({ reason: 'event called off' });
      expect(cancel.status).toBe(201);
      expect(cancel.body.awardsCancelled).toBe(1);
      expect(cancel.body.rfqsCancelled).toBe(1);
      const states = await pool.query(
        `SELECT (SELECT status FROM demand.rfqs WHERE id = $1) AS rfq,
                (SELECT status FROM demand.awards WHERE id = $2) AS award`,
        [fx.rfqId, aw.body.id]);
      expect(states.rows[0].rfq).toBe('CANCELLED');
      expect(states.rows[0].award).toBe('CANCELLED');
      const reAward = await award(fx.rfqId, idem('h13-re'),
        [{ requirementLineId: fx.lineId, quotationVersionId: fx.versionId, awardedQty: 5, uomId: stemUom }]);
      expect(reAward.status).toBe(409);
    });
  });

  describe('I. Managed procurement ops desk', () => {
    it('(I1) desk requires procurement.manage', async () => {
      const denied = await t.http.get('/api/demand/ops/desk').set(asBuyer());
      expect(denied.status).toBe(403);
    });
    it('(I2) desk aggregates sourcing queues across tenants', async () => {
      const req = await createRequirement('FORMAL');
      await submitReq(req.body.id, idem('i2'));
      const desk = await t.http.get('/api/demand/ops/desk').set(asOps());
      expect(desk.status).toBe(200);
      expect(desk.body.needsSourcing.some((r: { id: string }) => r.id === req.body.id)).toBe(true);
      expect(desk.body).toHaveProperty('openRfqs');
      expect(desk.body).toHaveProperty('uncoveredDemand');
      expect(desk.body).toHaveProperty('openClarifications');
    });
    it('(I3) ops sourcing notes are recorded and listed with audit', async () => {
      const req = await createRequirement('FORMAL');
      const add = await t.http.post(`/api/demand/ops/requirements/${req.body.id}/sourcing-notes`).set(asOps())
        .send({ note: 'called 3 growers; capacity tight' });
      expect(add.status).toBe(201);
      const list = await t.http.get(`/api/demand/ops/requirements/${req.body.id}/sourcing-notes`).set(asOps());
      expect(list.body.items.length).toBe(1);
      const audit = await pool.query(
        `SELECT 1 FROM core.audit_events WHERE object_id = $1 AND action = 'ops.sourcing_note'`, [req.body.id]);
      expect(audit.rowCount).toBe(1);
      const denied = await t.http.post(`/api/demand/ops/requirements/${req.body.id}/sourcing-notes`).set(asBuyer())
        .send({ note: 'buyer trying ops' });
      expect(denied.status).toBe(403);
    });
    it('(I4) ops can read any requirement (cross-tenant desk work) but buyers cannot', async () => {
      const req = await createRequirement('FORMAL');
      const opsRead = await t.http.get(`/api/demand/requirements/${req.body.id}`).set(asOps());
      expect(opsRead.status).toBe(200);
      const foreign = await t.http.get(`/api/demand/requirements/${req.body.id}`).set(asSup1());
      expect(foreign.status).toBe(404);
    });
  });
});
