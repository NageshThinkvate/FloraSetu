// PHASE 5 GATE (ADR-012): independent logistics partner execution boundary.
// L1-L16 acceptance scenarios from the Phase 5 owner directive:
// partner-controlled driver assignment (same-org only, history preserved), FloraSetu staff
// locked out of operational milestones, driver job isolation, multimodal driverless flows,
// backend-persisted arrival events, structured POD evidence (signature + reference),
// orthogonal exceptions, POD != quality acceptance, idempotent retries, tenant isolation.
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { bootTestApp, TestApp } from './helpers';

const password = 'Sup3rSecret99';
const RUN = randomUUID().slice(0, 8);
const FUTURE = new Date(Date.now() + 30 * 24 * 3600e3).toISOString();
const PAST = new Date(Date.now() - 3600e3).toISOString();
const idem = (label: string) => `p5-${RUN}-${label}`;
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const expectOk = (status: number): void => { expect([200, 201]).toContain(status); };

interface User { userId: string; accessToken: string; platformOrgId?: string }

describe('GATE Phase 5: independent logistics partner execution (ADR-012)', () => {
  let t: TestApp;
  let pool: Pool;

  const email = (label: string) => `${label}.${RUN}@test.florasetu.local`;
  const register = async (label: string): Promise<User> => {
    const res = await t.http.post('/api/auth/register').send({ email: email(label), password, displayName: `P5 ${label}` });
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
  const addMember = async (orgId: string, userId: string): Promise<void> => {
    await pool.query(
      `INSERT INTO identity.org_memberships (org_id, user_id, status) VALUES ($1, $2, 'ACTIVE') ON CONFLICT DO NOTHING`,
      [orgId, userId]);
  };
  const asOrg = (token: string, orgId: string) => ({ Authorization: `Bearer ${token}`, 'x-org-id': orgId });

  let admin: User; let ops: User; let buyer: User; let sup: User;
  let partnerA: User; let partnerB: User; let driverA1: User; let driverA2: User; let driverB: User; let outsider: User;
  let buyerOrg: string; let supOrg: string; let partnerAOrg: string; let partnerBOrg: string; let outsiderOrg: string;
  let stemUom: string; let productId: string; let varietyId: string;

  const asAdmin = () => asOrg(admin.accessToken, admin.platformOrgId as string);
  const asOps = () => asOrg(ops.accessToken, ops.platformOrgId as string);
  const asBuyer = () => asOrg(buyer.accessToken, buyerOrg);
  const asSup = () => asOrg(sup.accessToken, supOrg);
  const asPartnerA = () => asOrg(partnerA.accessToken, partnerAOrg);
  const asPartnerB = () => asOrg(partnerB.accessToken, partnerBOrg);
  const asDriverA1 = () => asOrg(driverA1.accessToken, partnerAOrg);
  const asDriverA2 = () => asOrg(driverA2.accessToken, partnerAOrg);
  const asOutsider = () => asOrg(outsider.accessToken, outsiderOrg);

  const upload = (headers: Record<string, string>) =>
    t.http.post('/api/media').set(headers).send({ contentType: 'image/png', dataBase64: PNG_B64, bucket: 'pilot' });

  const makeLot = async (label: string, qty = 50): Promise<string> => {
    const lot = await t.http.post('/api/supply/lots/harvest').set(asSup()).set('Idempotency-Key', idem(`${label}-lot`))
      .send({ commodityId: productId, varietyId, declaredQty: qty, uomId: stemUom, originType: 'OWN_FARM', harvestedAt: PAST, farmName: `Farm ${label}` });
    expectOk(lot.status);
    return lot.body.id as string;
  };
  const attachEvidence = async (lotId: string): Promise<void> => {
    for (let i = 0; i < 2; i += 1) {
      const up = await upload(asSup());
      expectOk(up.status);
      expectOk((await t.http.post(`/api/supply/lots/${lotId}/media`).set(asSup())
        .send({ mediaObjectId: up.body.id, purpose: 'LOT_ACTUAL' })).status);
    }
  };

  const orderedChain = async (label: string, qty = 40): Promise<{ orderId: string; salLineId: string }> => {
    const req = await t.http.post('/api/demand/requirements').set(asBuyer()).send({
      mode: 'FORMAL', title: `P5 ${label} ${RUN}`,
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

  // Full chain: order READY_FOR_DISPATCH -> shipment(mode) -> Ops assigns PARTNER ORG only
  // (ADR-012) -> partner admin assigns own-org driver when the scenario needs one.
  const jobChain = async (
    label: string,
    mode: string,
    opts: { driver?: User; shipmentExtra?: Record<string, unknown> } = {}
  ): Promise<{ orderId: string; salLineId: string; lotId: string; shipmentId: string }> => {
    const fx = await orderedChain(label, 40);
    const lotId = await makeLot(label, 50);
    await attachEvidence(lotId);
    expectOk((await t.http.post(`/api/supply/lots/${lotId}/declaration`).set(asSup()).send({})).status);
    expectOk((await t.http.post('/api/orders/allocate').set(asBuyer()).set('Idempotency-Key', idem(`${label}-al`))
      .send({ supplierAllocationLineId: fx.salLineId, lotId, qty: 40 })).status);
    expectOk((await t.http.post('/api/logistics/pack').set(asSup()).set('Idempotency-Key', idem(`${label}-pk`))
      .send({ orderId: fx.orderId, supplierAllocationLineId: fx.salLineId, lotId, packedQty: 40, uomId: stemUom, packType: 'CARTON', cartonCount: 2 })).status);
    expectOk((await t.http.post(`/api/orders/${fx.orderId}/transition`).set(asBuyer()).send({ to: 'QC_PACK' })).status);
    expectOk((await t.http.post(`/api/orders/${fx.orderId}/transition`).set(asBuyer()).send({ to: 'READY_FOR_DISPATCH' })).status);
    const shp = await t.http.post('/api/logistics/shipments').set(asBuyer()).set('Idempotency-Key', idem(`${label}-sh`))
      .send({ orderId: fx.orderId, mode, tempControlled: mode === 'REEFER_ROAD' || mode === 'INSULATED_ROAD',
        carrierName: 'Partner Co', packageCount: 2, handlingNote: 'Keep upright', ...opts.shipmentExtra });
    expectOk(shp.status);
    const shipmentId = shp.body.id as string;
    const assign = await t.http.post(`/api/logistics/shipments/${shipmentId}/assign`).set(asOps())
      .send({ logisticsOrgId: partnerAOrg });
    expectOk(assign.status);
    if (opts.driver) {
      const ad = await t.http.post(`/api/logistics/jobs/${shipmentId}/assign-driver`).set(asPartnerA())
        .send({ driverUserId: opts.driver.userId });
      expectOk(ad.status);
    }
    return { ...fx, lotId, shipmentId };
  };

  const driveToTransit = async (shipmentId: string, headers: Record<string, string>): Promise<void> => {
    expectOk((await t.http.post(`/api/logistics/jobs/${shipmentId}/accept`).set(headers)).status);
    // No awbRef here — pickup must not overwrite creation-time AWB/booking references.
    expectOk((await t.http.post(`/api/logistics/jobs/${shipmentId}/pickup`).set(headers).send({})).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${shipmentId}/transit`).set(headers)).status);
  };

  beforeAll(async () => {
    t = await bootTestApp();
    pool = new Pool({ connectionString: t.config.databaseUrl });
    await pool.query(
      `INSERT INTO identity.organizations (ref, name, type) VALUES ('TEST-PLATFORM', 'Test Platform', 'PLATFORM_OPS')
       ON CONFLICT (ref) DO NOTHING`);
    admin = await makePlatformUser('p5admin', 'PLATFORM_ADMIN');
    ops = await makePlatformUser('p5ops', 'PROCUREMENT_OPS');
    buyer = await register('p5buyer');
    sup = await register('p5sup');
    partnerA = await register('p5partnerA');
    partnerB = await register('p5partnerB');
    driverA1 = await register('p5driverA1');
    driverA2 = await register('p5driverA2');
    driverB = await register('p5driverB');
    outsider = await register('p5out');
    buyerOrg = await createOrg(buyer.accessToken, `P5 Buyer ${RUN}`, 'BUYER');
    supOrg = await createOrg(sup.accessToken, `P5 Grower ${RUN}`, 'GROWER');
    partnerAOrg = await createOrg(partnerA.accessToken, `P5 Logistics A ${RUN}`, 'LOGISTICS_PROVIDER');
    partnerBOrg = await createOrg(partnerB.accessToken, `P5 Logistics B ${RUN}`, 'LOGISTICS_PROVIDER');
    outsiderOrg = await createOrg(outsider.accessToken, `P5 Out ${RUN}`, 'BUYER');
    await addMember(partnerAOrg, driverA1.userId);
    await addMember(partnerAOrg, driverA2.userId);
    await addMember(partnerBOrg, driverB.userId);

    await pool.query(`INSERT INTO catalog.units_of_measure (code, name) VALUES ('STEM', 'STEM') ON CONFLICT (code) DO NOTHING`);
    stemUom = (await pool.query<{ id: string }>(`SELECT id FROM catalog.units_of_measure WHERE code = 'STEM'`)).rows[0].id;
    const cat = await t.http.post('/api/catalog/admin/categories').set(asAdmin())
      .send({ code: `P5_${RUN.replace(/-/g, '').toUpperCase()}`, name: `Phase5 ${RUN}` });
    expectOk(cat.status);
    const product = await t.http.post('/api/catalog/admin/products').set(asAdmin())
      .send({ categoryId: cat.body.id, name: `P5 Rose ${RUN}` });
    expectOk(product.status);
    productId = product.body.id;
    await pool.query(`UPDATE catalog.commodities SET validation_status = 'VALIDATED' WHERE id = $1`, [productId]);
    const variety = await pool.query<{ id: string }>(
      `INSERT INTO catalog.varieties (ref, commodity_id, name, validation_status, status)
       VALUES ($1, $2, $3, 'VALIDATED', 'ACTIVE') RETURNING id`,
      [`VAR-P5-${RUN}`, productId, `P5 Rose Red ${RUN}`]);
    varietyId = variety.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
    await t.app.close();
  });

  it('(L1) partner admin assigns own-org driver; assignment + event + audit + reassignment history', async () => {
    const fx = await jobChain('l1', 'REEFER_ROAD');
    const assign = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/assign-driver`).set(asPartnerA())
      .send({ driverUserId: driverA1.userId, vehicleRef: 'KA-04-E-1234' });
    expectOk(assign.status);
    expect(assign.body.action).toBe('ASSIGNED');
    const history = await pool.query(
      `SELECT action, driver_user_id, previous_driver_user_id, vehicle_ref FROM logistics.driver_assignments
       WHERE shipment_id = $1 ORDER BY created_at`, [fx.shipmentId]);
    expect(history.rowCount).toBe(1);
    expect(history.rows[0].action).toBe('ASSIGNED');
    expect(history.rows[0].vehicle_ref).toBe('KA-04-E-1234');
    const events = await pool.query(
      `SELECT event_type FROM logistics.execution_events WHERE shipment_id = $1 AND event_type = 'DRIVER_ASSIGNED'`,
      [fx.shipmentId]);
    expect(events.rowCount).toBe(1);
    const audit = await pool.query(
      `SELECT action FROM core.audit_events WHERE object_id = $1 AND action = 'shipment.driver_assign'`, [fx.shipmentId]);
    expect(audit.rowCount).toBe(1);
    // Reassignment preserves history (never overwrites).
    const reassign = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/assign-driver`).set(asPartnerA())
      .send({ driverUserId: driverA2.userId, reason: 'Shift change' });
    expectOk(reassign.status);
    expect(reassign.body.action).toBe('REASSIGNED');
    const history2 = await pool.query(
      `SELECT action, driver_user_id, previous_driver_user_id FROM logistics.driver_assignments
       WHERE shipment_id = $1 ORDER BY created_at`, [fx.shipmentId]);
    expect(history2.rowCount).toBe(2);
    expect(history2.rows[1].action).toBe('REASSIGNED');
    expect(history2.rows[1].previous_driver_user_id).toBe(driverA1.userId);
    expect(history2.rows[1].driver_user_id).toBe(driverA2.userId);
    const job = await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asPartnerA());
    expect(job.body.driver_user_id).toBe(driverA2.userId);
    expect(job.body.driver_name).toContain('p5driverA2');
  });

  it('(L2) cross-organization driver assignment is denied server-side', async () => {
    const fx = await jobChain('l2', 'NORMAL_ROAD');
    // Partner A admin tries a member of Partner B's organization.
    const foreignMember = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/assign-driver`).set(asPartnerA())
      .send({ driverUserId: driverB.userId });
    expect(foreignMember.status).toBe(404);
    // Partner B admin tries to assign their own member onto Partner A's job.
    const foreignJob = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/assign-driver`).set(asPartnerB())
      .send({ driverUserId: driverB.userId });
    expect(foreignJob.status).toBe(404);
    // Inactive/unknown user id is rejected too.
    const unknown = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/assign-driver`).set(asPartnerA())
      .send({ driverUserId: randomUUID() });
    expect(unknown.status).toBe(404);
  });

  it('(L3) FloraSetu staff, buyer, supplier and driver self-assignment are all denied', async () => {
    const fx = await jobChain('l3', 'NORMAL_ROAD');
    const url = `/api/logistics/jobs/${fx.shipmentId}/assign-driver`;
    expect((await t.http.post(url).set(asOps()).send({ driverUserId: driverA1.userId })).status).toBe(403);
    expect((await t.http.post(url).set(asAdmin()).send({ driverUserId: driverA1.userId })).status).toBe(403);
    // Buyer/supplier org admins carry logistics.* on THEIR orgs, but the job belongs to the
    // partner organization — object-level isolation denies them (404-on-foreign).
    expect((await t.http.post(url).set(asBuyer()).send({ driverUserId: driverA1.userId })).status).toBe(404);
    expect((await t.http.post(url).set(asSup()).send({ driverUserId: driverA1.userId })).status).toBe(404);
    expect((await t.http.post(url).set(asDriverA1()).send({ driverUserId: driverA1.userId })).status).toBe(403);
    // The legacy ops assignment path cannot smuggle a driver through either.
    const legacy = await t.http.post(`/api/logistics/shipments/${fx.shipmentId}/assign`).set(asOps())
      .send({ logisticsOrgId: partnerAOrg, driverUserId: driverA1.userId });
    expect(legacy.status).toBe(403);
    expect(legacy.body.error.details.code_detail).toBe('DRIVER_ASSIGNMENT_PARTNER_ONLY');
  });

  it('(L4) driver job isolation: other/unsigned drivers cannot read or mutate the job', async () => {
    const fx = await jobChain('l4a', 'NORMAL_ROAD', { driver: driverA1 });
    const other = await jobChain('l4b', 'NORMAL_ROAD', { driver: driverA2 });
    // Assigned driver reads own job; the unassigned sibling driver cannot.
    expectOk((await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asDriverA1())).status);
    expect((await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asDriverA2())).status).toBe(404);
    expect((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/accept`).set(asDriverA2())).status).toBe(404);
    // Driver A1 cannot touch a job assigned to driver A2.
    expect((await t.http.get(`/api/logistics/jobs/${other.shipmentId}`).set(asDriverA1())).status).toBe(404);
    expect((await t.http.post(`/api/logistics/jobs/${other.shipmentId}/transit`).set(asDriverA1())).status).toBe(404);
    // Driver-scoped list shows only own jobs; the partner manager sees both.
    const mine = await t.http.get('/api/logistics/jobs').set(asDriverA1());
    const mineIds = (mine.body.items as { id: string }[]).map((j) => j.id);
    expect(mineIds).toContain(fx.shipmentId);
    expect(mineIds).not.toContain(other.shipmentId);
    const all = await t.http.get('/api/logistics/jobs').set(asPartnerA());
    const allIds = (all.body.items as { id: string }[]).map((j) => j.id);
    expect(allIds).toContain(fx.shipmentId);
    expect(allIds).toContain(other.shipmentId);
  });

  it('(L5) road job without a named driver stays fully executable by the partner manager', async () => {
    const fx = await jobChain('l5', 'NORMAL_ROAD');
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/accept`).set(asPartnerA())).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/arrived-pickup`).set(asPartnerA())).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/pickup`).set(asPartnerA())
      .send({ transportRef: 'KA-51-VAN-9' })).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/transit`).set(asPartnerA())).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/arrived-delivery`).set(asPartnerA())).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/deliver`).set(asPartnerA())
      .send({ deliveredQty: 40, receiverName: 'Store Manager', podRef: `POD-L5-${RUN}` })).status);
    const job = await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asPartnerA());
    expect(job.body.status).toBe('DELIVERED');
    expect(job.body.driver_user_id).toBeNull();
    const types = (job.body.events as { event_type: string }[]).map((e) => e.event_type);
    expect(types).toEqual(['JOB_ACCEPTED', 'ARRIVED_AT_PICKUP', 'PICKUP_CONFIRMED', 'IN_TRANSIT',
      'ARRIVED_AT_DELIVERY', 'DELIVERY_CONFIRMED', 'POD_SUBMITTED']);
  });

  it('(L6) bus parcel: driverless workflow with operator/terminal/booking references', async () => {
    const fx = await jobChain('l6', 'BUS_PARCEL', {
      shipmentExtra: { carrierName: 'KPN Travels', originTerminal: 'Ooty Bus Stand',
        destinationTerminal: 'Bengaluru Satellite', transportRef: 'KPN-EXP-7', etd: FUTURE, eta: FUTURE }
    });
    await driveToTransit(fx.shipmentId, asPartnerA());
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/deliver`).set(asPartnerA())
      .send({ deliveredQty: 40, receiverName: 'Parcel Desk', podRef: `BUS-RCPT-${RUN}` })).status);
    const job = await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asPartnerA());
    expect(job.body.mode).toBe('BUS_PARCEL');
    expect(job.body.carrier_name).toBe('KPN Travels');
    expect(job.body.origin_terminal).toBe('Ooty Bus Stand');
    expect(job.body.destination_terminal).toBe('Bengaluru Satellite');
    expect(job.body.driver_user_id).toBeNull();
  });

  it('(L7) rail parcel: driverless workflow with consignment reference', async () => {
    const fx = await jobChain('l7', 'RAIL_PARCEL', {
      shipmentExtra: { carrierName: 'Indian Railways Parcel', originTerminal: 'Udagamandalam (UAM)',
        destinationTerminal: 'KSR Bengaluru (SBC)', transportRef: 'SWR-12627' }
    });
    await driveToTransit(fx.shipmentId, asPartnerA());
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/deliver`).set(asPartnerA())
      .send({ deliveredQty: 40, receiverName: 'Rail Parcel Office', podRef: `RLY-CRN-${RUN}` })).status);
    const job = await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asPartnerA());
    expect(job.body.mode).toBe('RAIL_PARCEL');
    expect(job.body.driver_user_id).toBeNull();
  });

  it('(L8) air cargo: driverless workflow with AWB reference', async () => {
    const fx = await jobChain('l8', 'AIR_CARGO', {
      shipmentExtra: { carrierName: 'IndiGo Cargo', originTerminal: 'CJB Cargo Terminal',
        destinationTerminal: 'BLR Air Cargo', transportRef: '6E-513', parcelAwbRef: `AWB-6E-${RUN}` }
    });
    await driveToTransit(fx.shipmentId, asPartnerA());
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/deliver`).set(asPartnerA())
      .send({ deliveredQty: 40, receiverName: 'Cargo Desk', podRef: `AIR-DO-${RUN}` })).status);
    const job = await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asPartnerA());
    expect(job.body.mode).toBe('AIR_CARGO');
    expect(job.body.parcel_awb_ref).toBe(`AWB-6E-${RUN}`);
    expect(job.body.driver_user_id).toBeNull();
  });

  it('(L9) arrived-at-pickup is a backend-persisted audit event with server timestamp', async () => {
    const fx = await jobChain('l9', 'REEFER_ROAD', { driver: driverA1 });
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/accept`).set(asDriverA1())).status);
    const arrived = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/arrived-pickup`).set(asDriverA1());
    expectOk(arrived.status);
    expect(arrived.body.arrivedPickupAt).toBeTruthy();
    const col = await pool.query<{ arrived_pickup_at: string | null }>(
      `SELECT arrived_pickup_at FROM logistics.shipments WHERE id = $1`, [fx.shipmentId]);
    expect(col.rows[0].arrived_pickup_at).not.toBeNull();
    const ev = await pool.query<{ occurred_at: string; actor_user_id: string }>(
      `SELECT occurred_at, actor_user_id FROM logistics.execution_events
       WHERE shipment_id = $1 AND event_type = 'ARRIVED_AT_PICKUP'`, [fx.shipmentId]);
    expect(ev.rowCount).toBe(1);
    expect(ev.rows[0].actor_user_id).toBe(driverA1.userId);
    const job = await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asPartnerA());
    const timeline = job.body.events as { event_type: string; actor_name: string | null }[];
    const found = timeline.find((e) => e.event_type === 'ARRIVED_AT_PICKUP');
    expect(found).toBeDefined();
    expect(found!.actor_name).toContain('p5driverA1');
    // Ops cannot record arrival on the partner's behalf.
    expect((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/arrived-delivery`).set(asOps())).status).toBe(404);
  });

  it('(L10) arrived-at-delivery is backend-persisted and transition-guarded', async () => {
    const fx = await jobChain('l10', 'NORMAL_ROAD', { driver: driverA1 });
    // Arrival at delivery before transit is an impossible transition.
    expect((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/arrived-delivery`).set(asDriverA1())).status).toBe(409);
    // Pickup before acceptance is impossible too.
    expect((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/pickup`).set(asDriverA1()).send({})).status).toBe(409);
    await driveToTransit(fx.shipmentId, asDriverA1());
    const arrived = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/arrived-delivery`).set(asDriverA1());
    expectOk(arrived.status);
    const ev = await pool.query(
      `SELECT 1 FROM logistics.execution_events WHERE shipment_id = $1 AND event_type = 'ARRIVED_AT_DELIVERY'`,
      [fx.shipmentId]);
    expect(ev.rowCount).toBe(1);
    // Delivery before transit must fail on a fresh job.
    const fx2 = await jobChain('l10b', 'NORMAL_ROAD', { driver: driverA1 });
    expect((await t.http.post(`/api/logistics/jobs/${fx2.shipmentId}/deliver`).set(asDriverA1())
      .send({ deliveredQty: 40 })).status).toBe(409);
  });

  it('(L11) POD with signature media + reference: protected evidence, authorized access only', async () => {
    const fx = await jobChain('l11', 'REEFER_ROAD', { driver: driverA1 });
    await driveToTransit(fx.shipmentId, asDriverA1());
    const photo = await upload(asDriverA1());
    const signature = await upload(asDriverA1());
    expectOk(photo.status);
    expectOk(signature.status);
    const deliver = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/deliver`).set(asDriverA1())
      .send({ deliveredQty: 40, receiverName: 'Front Desk', podRef: `POD-${RUN}`,
        mediaObjectId: photo.body.id, signatureMediaObjectId: signature.body.id, notes: 'Received in good order' });
    expectOk(deliver.status);
    const pod = await pool.query<{ pod_ref: string; signature_media_object_id: string }>(
      `SELECT pod_ref, signature_media_object_id FROM logistics.pod_records WHERE shipment_id = $1`, [fx.shipmentId]);
    expect(pod.rows[0].pod_ref).toBe(`POD-${RUN}`);
    expect(pod.rows[0].signature_media_object_id).toBe(signature.body.id);
    const podMedia = await pool.query(
      `SELECT purpose FROM logistics.shipment_media WHERE shipment_id = $1 AND purpose = 'POD'`, [fx.shipmentId]);
    expect(podMedia.rowCount).toBe(2);
    const job = await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asPartnerA());
    const podView = (job.body.pods as { url: string | null; signature_url: string | null }[])[0];
    expect(podView.url).toContain('/api/media/raw/');
    expect(podView.signature_url).toContain('sig=');
    // Signed URL works; unsigned/tampered access does not.
    expectOk((await t.http.get(podView.signature_url as string)).status);
    expect((await t.http.get(`/api/media/raw/${signature.body.id}`)).status).toBe(404);
    // Partner B can never obtain the evidence URLs (job detail is denied).
    expect((await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asPartnerB())).status).toBe(404);
  });

  it('(L12) non-signature POD: documentary reference evidence accepted without signature', async () => {
    const fx = await jobChain('l12', 'BUS_PARCEL');
    await driveToTransit(fx.shipmentId, asPartnerA());
    const deliver = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/deliver`).set(asPartnerA())
      .send({ deliveredQty: 40, receiverName: 'Parcel Desk', podRef: `BUS-RR-${RUN}`, notes: 'RR number collected' });
    expectOk(deliver.status);
    const pod = await pool.query<{ signature_media_object_id: string | null; pod_ref: string }>(
      `SELECT signature_media_object_id, pod_ref FROM logistics.pod_records WHERE shipment_id = $1`, [fx.shipmentId]);
    expect(pod.rows[0].pod_ref).toBe(`BUS-RR-${RUN}`);
    expect(pod.rows[0].signature_media_object_id).toBeNull();
  });

  it('(L13) partner exception is recorded and visible, but blocks/mutates nothing else', async () => {
    const fx = await jobChain('l13', 'INSULATED_ROAD', { driver: driverA1 });
    await driveToTransit(fx.shipmentId, asDriverA1());
    const before = await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer());
    const ex = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/exception`).set(asDriverA1())
      .send({ type: 'VEHICLE_BREAKDOWN', note: 'flat tyre on NH-44' });
    expectOk(ex.status);
    const row = await pool.query<{ blocks_buyer_acceptance: boolean; blocks_supplier_settlement: boolean }>(
      `SELECT blocks_buyer_acceptance, blocks_supplier_settlement FROM logistics.shipment_exceptions WHERE id = $1`,
      [ex.body.id]);
    expect(row.rows[0].blocks_buyer_acceptance).toBe(false);
    expect(row.rows[0].blocks_supplier_settlement).toBe(false);
    const after = await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer());
    expect(after.body.status).toBe(before.body.status);
    const claims = await pool.query(`SELECT id FROM claims.claims WHERE order_id = $1`, [fx.orderId]);
    expect(claims.rowCount).toBe(0);
    const ev = await pool.query(
      `SELECT 1 FROM logistics.execution_events WHERE shipment_id = $1 AND event_type = 'EXCEPTION_REPORTED'`,
      [fx.shipmentId]);
    expect(ev.rowCount).toBe(1);
    const asOpsView = await t.http.get(`/api/logistics/shipments/${fx.shipmentId}`).set(asOps());
    expect((asOpsView.body.exceptions as { id: string }[]).some((e) => e.id === ex.body.id)).toBe(true);
  });

  it('(L14) POD never implies quality acceptance or auto-closes anything', async () => {
    const fx = await jobChain('l14', 'NORMAL_ROAD', { driver: driverA1 });
    await driveToTransit(fx.shipmentId, asDriverA1());
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/deliver`).set(asDriverA1())
      .send({ deliveredQty: 40, receiverName: 'Front Desk' })).status);
    const lot = await pool.query<{ quality_basis: string }>(
      `SELECT quality_basis FROM supply.supply_lots WHERE id = $1`, [fx.lotId]);
    expect(lot.rows[0].quality_basis).toBe('SUPPLIER_DECLARATION');
    const inspections = await pool.query(`SELECT id FROM quality.qc_inspections WHERE lot_id = $1`, [fx.lotId]);
    expect(inspections.rowCount).toBe(0);
    const order = await t.http.get(`/api/orders/${fx.orderId}`).set(asBuyer());
    expect(['DELIVERED', 'ACCEPTANCE_PENDING']).toContain(order.body.status);
    const claims = await pool.query(`SELECT id FROM claims.claims WHERE order_id = $1`, [fx.orderId]);
    expect(claims.rowCount).toBe(0);
  });

  it('(L15) duplicate retries collapse to one logical event/record', async () => {
    const fx = await jobChain('l15', 'REEFER_ROAD', { driver: driverA1 });
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/accept`).set(asDriverA1())).status);
    const a1 = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/arrived-pickup`).set(asDriverA1());
    const a2 = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/arrived-pickup`).set(asDriverA1());
    expectOk(a1.status);
    expectOk(a2.status);
    expect(a2.body.replayed).toBe(true);
    const arrivals = await pool.query(
      `SELECT id FROM logistics.execution_events WHERE shipment_id = $1 AND event_type = 'ARRIVED_AT_PICKUP'`,
      [fx.shipmentId]);
    expect(arrivals.rowCount).toBe(1);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/pickup`).set(asDriverA1()).send({})).status);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/pickup`).set(asDriverA1()).send({})).status);
    const pickups = await pool.query(
      `SELECT id FROM logistics.execution_events WHERE shipment_id = $1 AND event_type = 'PICKUP_CONFIRMED'`,
      [fx.shipmentId]);
    expect(pickups.rowCount).toBe(1);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/transit`).set(asDriverA1())).status);
    const d1 = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/deliver`).set(asDriverA1())
      .send({ deliveredQty: 40, receiverName: 'Front Desk' });
    const d2 = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/deliver`).set(asDriverA1())
      .send({ deliveredQty: 40, receiverName: 'Front Desk' });
    expectOk(d1.status);
    expectOk(d2.status);
    expect(d2.body.replayed).toBe(true);
    const pods = await pool.query(`SELECT id FROM logistics.pod_records WHERE shipment_id = $1`, [fx.shipmentId]);
    expect(pods.rowCount).toBe(1);
    const podEvents = await pool.query(
      `SELECT id FROM logistics.execution_events WHERE shipment_id = $1 AND event_type = 'POD_SUBMITTED'`,
      [fx.shipmentId]);
    expect(podEvents.rowCount).toBe(1);
  });

  it('(L16) tenant isolation: Partner B cannot read, list, mutate or take evidence from Partner A jobs', async () => {
    const fx = await jobChain('l16', 'REEFER_ROAD', { driver: driverA1 });
    expect((await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asPartnerB())).status).toBe(404);
    const list = await t.http.get('/api/logistics/jobs').set(asPartnerB());
    expect((list.body.items as { id: string }[]).some((j) => j.id === fx.shipmentId)).toBe(false);
    expect((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/accept`).set(asPartnerB())).status).toBe(404);
    expect((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/arrived-pickup`).set(asPartnerB())).status).toBe(404);
    expect((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/assign-driver`).set(asPartnerB())
      .send({ driverUserId: driverB.userId })).status).toBe(404);
    expect((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/exception`).set(asPartnerB())
      .send({ type: 'OTHER' })).status).toBe(404);
    // Outsider (buyer-category org) is equally locked out.
    expect((await t.http.get(`/api/logistics/jobs/${fx.shipmentId}`).set(asOutsider())).status).toBe(404);
  });

  it('(L17) dashboard buckets + eligible-driver picker are org-scoped', async () => {
    const fx = await jobChain('l17', 'LOCAL_PICKUP', { driver: driverA1 });
    const dash = await t.http.get('/api/logistics/jobs/dashboard').set(asPartnerA());
    expectOk(dash.status);
    expect(dash.body.new_jobs).toBeGreaterThanOrEqual(1);
    const drivers = await t.http.get('/api/logistics/jobs/eligible-drivers').set(asPartnerA());
    expectOk(drivers.status);
    const ids = (drivers.body.items as { userId: string; roles: string[] }[]).map((m) => m.userId);
    expect(ids).toContain(driverA1.userId);
    expect(ids).toContain(driverA2.userId);
    expect(ids).not.toContain(driverB.userId);
    // Driver cannot open the picker; Partner B sees only their own members.
    expect((await t.http.get('/api/logistics/jobs/eligible-drivers').set(asDriverA1())).status).toBe(403);
    const driversB = await t.http.get('/api/logistics/jobs/eligible-drivers').set(asPartnerB());
    const idsB = (driversB.body.items as { userId: string }[]).map((m) => m.userId);
    expect(idsB).toContain(driverB.userId);
    expect(idsB).not.toContain(driverA1.userId);
    // Unassign keeps history and frees the job back to manager-only execution.
    const un = await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/unassign-driver`).set(asPartnerA())
      .send({ reason: 'Route consolidated' });
    expectOk(un.status);
    const hist = await pool.query(
      `SELECT action FROM logistics.driver_assignments WHERE shipment_id = $1 ORDER BY created_at, action`, [fx.shipmentId]);
    expect(hist.rows.map((r) => r.action)).toEqual(['ASSIGNED', 'UNASSIGNED']);
    expect((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/accept`).set(asDriverA1())).status).toBe(404);
    expectOk((await t.http.post(`/api/logistics/jobs/${fx.shipmentId}/accept`).set(asPartnerA())).status);
  });
});
