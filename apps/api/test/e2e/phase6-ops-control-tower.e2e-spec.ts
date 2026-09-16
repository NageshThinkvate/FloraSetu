// PHASE 6 GATE (ADR-013): Operations Control Tower authorization boundary.
// Owner rulings under test:
//  S1  tower.read gates the composed staff surface (board, monitors, search, export).
//  S2  discipline isolation — finance never sees PROCUREMENT lane, procurement never
//      sees FINANCE lane, support sees neither.
//  S3  support (claim.read) reads claims but can NEVER transition them (claim.manage).
//  S4  finance mutations are discipline-locked (procurement/support cannot verify).
//  S5  FloraSetu staff can NEVER execute partner logistics: no driver assignment, no
//      milestone mutation, no partner POD (ADR-012 reconfirmed for every ops role).
//  S6  board export is audited (tower.board_export).
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { bootTestApp, TestApp } from './helpers';

const password = 'Sup3rSecret99';
const RUN = randomUUID().slice(0, 8);

interface User { userId: string; accessToken: string; platformOrgId?: string }

describe('GATE Phase 6: operations control tower authorization (ADR-013)', () => {
  let t: TestApp;
  let pool: Pool;

  const email = (label: string) => `p6.${label}.${RUN}@test.florasetu.local`;
  const register = async (label: string): Promise<User> => {
    const res = await t.http.post('/api/auth/register').send({ email: email(label), password, displayName: `P6 ${label}` });
    expect([200, 201]).toContain(res.status);
    return { userId: res.body.userId as string, accessToken: res.body.accessToken as string };
  };
  const makePlatformUser = async (label: string, role: string): Promise<User> => {
    const u = await register(label);
    await pool.query(
      `INSERT INTO identity.organizations (ref, name, type) VALUES ('TEST-PLATFORM', 'Test Platform', 'PLATFORM_OPS')
       ON CONFLICT (ref) DO NOTHING`);
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
  const asOrg = (token: string, orgId: string) => ({ Authorization: `Bearer ${token}`, 'x-org-id': orgId });

  let proc: User; let fin: User; let sup: User; let buyer: User; let buyerOrg: string;
  const asProc = () => asOrg(proc.accessToken, proc.platformOrgId as string);
  const asFin = () => asOrg(fin.accessToken, fin.platformOrgId as string);
  const asSup = () => asOrg(sup.accessToken, sup.platformOrgId as string);
  const asBuyer = () => asOrg(buyer.accessToken, buyerOrg);

  beforeAll(async () => {
    t = await bootTestApp();
    pool = new Pool({ connectionString: t.config.databaseUrl });
    proc = await makePlatformUser('proc', 'PROCUREMENT_OPS');
    fin = await makePlatformUser('fin', 'FINANCE_OPS');
    sup = await makePlatformUser('sup', 'SUPPORT_AGENT');
    buyer = await register('buyer');
    const org = await t.http.post('/api/orgs').set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ name: `P6 Buyer ${RUN}`, category: 'BUYER' });
    expect([200, 201]).toContain(org.status);
    buyerOrg = org.body.id as string;
  }, 120000);

  afterAll(async () => {
    await t?.app.close();
  });

  // ---------- S1: tower.read gates the composed staff surface ----------

  it('S1a: ops disciplines can read the tower surface', async () => {
    for (const headers of [asProc(), asFin(), asSup()]) {
      for (const path of ['/api/tower/board', '/api/tower/orders', '/api/tower/logistics', '/api/tower/search?q=ab']) {
        const res = await t.http.get(path).set(headers);
        expect(res.status).toBe(200);
      }
    }
  });

  it('S1b: non-staff users are denied the tower surface', async () => {
    for (const path of ['/api/tower/board', '/api/tower/orders', '/api/tower/logistics', '/api/tower/search?q=ab', '/api/tower/board/export']) {
      const res = await t.http.get(path).set(asBuyer());
      expect(res.status).toBe(403);
    }
  });

  // ---------- S2: discipline isolation on the board ----------

  it('S2: board lanes respect discipline permissions', async () => {
    const [procBoard, finBoard, supBoard] = await Promise.all([
      t.http.get('/api/tower/board').set(asProc()),
      t.http.get('/api/tower/board').set(asFin()),
      t.http.get('/api/tower/board').set(asSup())
    ]);
    expect(procBoard.status).toBe(200);
    expect(finBoard.status).toBe(200);
    expect(supBoard.status).toBe(200);
    const lanes = (b: { body: { items: { discipline: string }[] } }) => b.body.items.map((i) => i.discipline);
    // PROCUREMENT_OPS lacks payment.verify/settlement.verify → never a FINANCE lane item.
    expect(lanes(procBoard)).not.toContain('FINANCE');
    // FINANCE_OPS lacks procurement.manage → never a PROCUREMENT lane item.
    expect(lanes(finBoard)).not.toContain('PROCUREMENT');
    // SUPPORT_AGENT has neither finance nor procurement authority.
    expect(lanes(supBoard)).not.toContain('FINANCE');
    expect(lanes(supBoard)).not.toContain('PROCUREMENT');
  });

  // ---------- S3: claims triage boundary (support never adjudicates) ----------

  it('S3a: support can read the claims queue', async () => {
    const res = await t.http.get('/api/claims').set(asSup());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('S3b: support and finance can never transition a claim', async () => {
    const id = randomUUID();
    for (const headers of [asSup(), asFin()]) {
      const res = await t.http.post(`/api/claims/${id}/transition`).set(headers)
        .send({ to: 'UNDER_REVIEW', resolutionNote: 'should never pass' });
      expect(res.status).toBe(403);
    }
  });

  it('S3c: claim.manage holders pass the transition guard (404 on unknown claim)', async () => {
    const res = await t.http.post(`/api/claims/${randomUUID()}/transition`).set(asProc())
      .send({ to: 'UNDER_REVIEW', resolutionNote: 'guard check' });
    expect(res.status).toBe(404);
  });

  // ---------- S4: finance discipline lockout ----------

  it('S4a: procurement and support cannot verify payments or settlements', async () => {
    const id = randomUUID();
    for (const headers of [asProc(), asSup()]) {
      expect((await t.http.post(`/api/finance/payments/${id}/verify`).set(headers)).status).toBe(403);
      expect((await t.http.post(`/api/finance/settlements/${id}/verify`).set(headers)).status).toBe(403);
      expect((await t.http.post(`/api/finance/settlements/${id}/complete`).set(headers)).status).toBe(403);
    }
  });

  it('S4b: finance passes the verify guard (404 on unknown payment)', async () => {
    const res = await t.http.post(`/api/finance/payments/${randomUUID()}/verify`).set(asFin());
    expect(res.status).toBe(404);
  });

  it('S4c: procurement cannot record payments or settlements', async () => {
    const id = randomUUID();
    const pay = await t.http.post('/api/finance/payments').set(asProc())
      .send({ orderId: id, amountMinor: 100, method: 'UPI', externalRef: 'x', paidAt: new Date().toISOString() });
    expect(pay.status).toBe(403);
    const settle = await t.http.post('/api/finance/settlements').set(asProc())
      .send({ orderId: id, supplierOrgId: id, grossMinor: 100 });
    expect(settle.status).toBe(403);
  });

  // ---------- S5: staff can NEVER execute partner logistics (ADR-012) ----------

  it('S5a: no ops role can assign or unassign partner drivers', async () => {
    const job = randomUUID();
    for (const headers of [asProc(), asFin(), asSup()]) {
      const assign = await t.http.post(`/api/logistics/jobs/${job}/assign-driver`).set(headers)
        .send({ driverUserId: randomUUID() });
      expect(assign.status).toBe(403);
      const unassign = await assignmentless(t, `/api/logistics/jobs/${job}/unassign-driver`, headers);
      expect(unassign).toBe(403);
    }
  });

  it('S5b: staff driver assignment via the legacy partner-assign endpoint is rejected', async () => {
    const res = await t.http.post(`/api/logistics/shipments/${randomUUID()}/assign`).set(asProc())
      .send({ logisticsOrgId: randomUUID(), driverUserId: randomUUID() });
    expect(res.status).toBe(403);
    expect(res.body?.error?.details?.code_detail).toBe('DRIVER_ASSIGNMENT_PARTNER_ONLY');
  });

  it('S5c: no ops role can mutate partner execution milestones or submit partner POD', async () => {
    const job = randomUUID();
    const attempts: [string, unknown][] = [
      [`/api/logistics/jobs/${job}/accept`, {}],
      [`/api/logistics/jobs/${job}/arrived-pickup`, {}],
      [`/api/logistics/jobs/${job}/pickup`, {}],
      [`/api/logistics/jobs/${job}/transit`, {}],
      [`/api/logistics/jobs/${job}/arrived-delivery`, {}],
      [`/api/logistics/jobs/${job}/deliver`, { deliveredQty: 1 }]
    ];
    for (const headers of [asProc(), asFin(), asSup()]) {
      for (const [path, body] of attempts) {
        const res = await t.http.post(path).set(headers).send(body as Record<string, unknown>);
        // 404 (job isolation — never reveal existence) or 403, never success, never 500.
        expect([403, 404]).toContain(res.status);
      }
    }
  });

  // ---------- S6: audited board export ----------

  it('S6: board export returns CSV and writes a tower.board_export audit event', async () => {
    const res = await t.http.get('/api/tower/board/export').set(asProc());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('discipline,category,severity');
    const audit = await pool.query(
      `SELECT 1 FROM core.audit_events WHERE action = 'tower.board_export' LIMIT 1`);
    expect(audit.rowCount).toBeGreaterThan(0);
  });
});

async function assignmentless(t: TestApp, path: string, headers: Record<string, string>): Promise<number> {
  const res = await t.http.post(path).set(headers).send({ reason: 'ops attempt' });
  return res.status;
}
