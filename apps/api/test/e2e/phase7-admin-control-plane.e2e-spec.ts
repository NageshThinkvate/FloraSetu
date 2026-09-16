// PHASE 7 GATE (ADR-014): Admin Control Plane authorization boundary.
// Covers directive §43 mandatory security tests + acceptance scenarios A1–A22:
// KYB queue/review/correction (A1–A7), organization governance (A8–A11),
// access governance (A12–A15), config/flags (A16–A19), audit (A20–A22),
// plus Admin-is-not-a-marketplace-actor regressions (logistics/claims/IDOR/escalation).
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { bootTestApp, TestApp } from './helpers';

const password = 'Sup3rSecret99';
const RUN = randomUUID().slice(0, 8);

interface User { userId: string; accessToken: string; platformOrgId?: string }

describe('GATE Phase 7: admin control plane (ADR-014)', () => {
  let t: TestApp;
  let pool: Pool;

  const email = (label: string) => `p7.${label}.${RUN}@test.florasetu.local`;
  const register = async (label: string): Promise<User> => {
    const res = await t.http.post('/api/auth/register').send({ email: email(label), password, displayName: `P7 ${label}` });
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
  const createOrg = async (token: string, name: string, category: string): Promise<string> => {
    const res = await t.http.post('/api/orgs').set('Authorization', `Bearer ${token}`).send({ name, category });
    expect([200, 201]).toContain(res.status);
    return res.body.id as string;
  };
  const asOrg = (token: string, orgId: string) => ({ Authorization: `Bearer ${token}`, 'x-org-id': orgId });

  let admin: User; let reviewer: User; let proc: User; let fin: User; let sup: User;
  let buyer: User; let buyerOrg: string;
  const asAdmin = () => asOrg(admin.accessToken, admin.platformOrgId as string);
  const asReviewer = () => asOrg(reviewer.accessToken, reviewer.platformOrgId as string);
  const asProc = () => asOrg(proc.accessToken, proc.platformOrgId as string);
  const asFin = () => asOrg(fin.accessToken, fin.platformOrgId as string);
  const asSup = () => asOrg(sup.accessToken, sup.platformOrgId as string);
  const asBuyer = () => asOrg(buyer.accessToken, buyerOrg);

  beforeAll(async () => {
    t = await bootTestApp();
    pool = new Pool({ connectionString: t.config.databaseUrl });
    admin = await makePlatformUser('admin', 'PLATFORM_ADMIN');
    reviewer = await makePlatformUser('reviewer', 'KYB_REVIEWER');
    proc = await makePlatformUser('proc', 'PROCUREMENT_OPS');
    fin = await makePlatformUser('fin', 'FINANCE_OPS');
    sup = await makePlatformUser('sup', 'SUPPORT_AGENT');
    buyer = await register('buyer');
    buyerOrg = await createOrg(buyer.accessToken, `P7 Buyer ${RUN}`, 'BUYER');
  }, 120000);

  afterAll(async () => {
    await pool?.end();
    await t?.app.close();
  });

  // ---------- §43: Admin surface access denial ----------

  it('S1: marketplace users cannot read the admin surface; staff keep accepted masked-read only', async () => {
    for (const path of ['/api/admin/orgs', '/api/admin/users', '/api/admin/roles']) {
      expect((await t.http.get(path).set(asBuyer())).status).toBe(403);
    }
    // admin.org.read is an accepted Build-1/3 masked-read grant for staff roles.
    for (const headers of [asProc(), asFin(), asSup()]) {
      expect((await t.http.get('/api/admin/orgs').set(headers)).status).toBe(200);
      expect((await t.http.get('/api/admin/roles').set(headers)).status).toBe(200);
      // User governance stays PLATFORM_ADMIN-only (admin.user.read, migration 017).
      expect((await t.http.get('/api/admin/users').set(headers)).status).toBe(403);
    }
  });

  it('S2: support cannot reach super-admin configuration, flags, users or security', async () => {
    expect((await t.http.get('/api/admin/config').set(asSup())).status).toBe(403);
    expect((await t.http.patch('/api/admin/config/LOT_EVIDENCE_MIN_PHOTOS').set(asSup()).send({ value: 9 })).status).toBe(403);
    expect((await t.http.post('/api/admin/flags/INDEPENDENT_INSPECTION_ENABLED').set(asSup()).send({ enabled: true })).status).toBe(403);
    expect((await t.http.get('/api/admin/security').set(asSup())).status).toBe(403);
  });

  it('S3: procurement cannot manage platform roles or users via API payload', async () => {
    expect((await t.http.get('/api/admin/users').set(asProc())).status).toBe(403);
    expect((await t.http.post(`/api/admin/users/${randomUUID()}/suspend`).set(asProc()).send({ reason: 'x' })).status).toBe(403);
    expect((await t.http.get('/api/admin/config').set(asProc())).status).toBe(403);
  });

  it('S4: finance cannot gain admin rights through API payload', async () => {
    // Masked overview read is covered by the accepted admin.org.read grant…
    expect((await t.http.get('/api/admin/overview').set(asFin())).status).toBe(200);
    // …but user governance mutations stay PLATFORM_ADMIN-only.
    expect((await t.http.post(`/api/admin/users/${randomUUID()}/reactivate`).set(asFin())).status).toBe(403);
    expect((await t.http.post(`/api/admin/users/${randomUUID()}/suspend`).set(asFin()).send({ reason: 'x' })).status).toBe(403);
    expect((await t.http.patch('/api/admin/config/LOT_EVIDENCE_MIN_PHOTOS').set(asFin()).send({ value: 9 })).status).toBe(403);
    expect((await t.http.post('/api/admin/flags/INDEPENDENT_INSPECTION_ENABLED').set(asFin()).send({ enabled: true })).status).toBe(403);
  });

  // ---------- A1–A7: KYB acceptance ----------

  it('A1: submitted KYB appears in the authorized reviewer queue only', async () => {
    const submit = await t.http.post(`/api/orgs/${buyerOrg}/kyb/submit`).set(asBuyer())
      .send({ documents: [{ docType: 'GST', objectKey: `kyb/${randomUUID()}.pdf`, contentType: 'application/pdf', byteSize: 2048 }] });
    expect(submit.status).toBe(201);
    const queue = await t.http.get('/api/admin/kyb-queue').set(asReviewer());
    expect(queue.status).toBe(200);
    const row = (queue.body.items as { id: string; kyb_status: string; document_count: number }[])
      .find((r) => r.id === buyerOrg);
    expect(row?.kyb_status).toBe('IN_REVIEW');
    expect(row?.document_count).toBeGreaterThan(0);
    expect((await t.http.get('/api/admin/kyb-queue').set(asBuyer())).status).toBe(403);
  });

  it('A2: reviewer opens evidence via protected signed access; unauthorized users denied', async () => {
    const detail = await t.http.get(`/api/admin/kyb/${buyerOrg}/detail`).set(asReviewer());
    expect(detail.status).toBe(200);
    const docs = detail.body.documents as { docType: string; url: string }[];
    expect(docs.length).toBeGreaterThan(0);
    expect(docs[0].url).toContain('/api/media/raw/');
    expect(docs[0].url).toContain('sig=');
    // No unsigned access to the raw object; no unauthorized detail access.
    const rawKey = docs[0].url.split('/api/media/raw/')[1].split('?')[0];
    const unsigned = await t.http.get(`/api/media/raw/${rawKey}`).set(asReviewer());
    expect([403, 404]).toContain(unsigned.status);
    expect((await t.http.get(`/api/admin/kyb/${buyerOrg}/detail`).set(asBuyer())).status).toBe(403);
    expect((await t.http.get(`/api/admin/kyb/${buyerOrg}/detail`).set(asSup())).status).toBe(403);
  });

  it('A3: correction request keeps REJECTED state with structured reason; org sees it', async () => {
    const review = await t.http.post(`/api/admin/kyb/${buyerOrg}/review`).set(asReviewer())
      .send({ decision: 'REJECTED', reasonCode: 'CORRECTION_REQUIRED', note: 'GST certificate illegible — re-upload a clear scan' });
    expect(review.status).toBe(201);
    const history = await t.http.get(`/api/orgs/${buyerOrg}/kyb/history`).set(asBuyer());
    expect(history.status).toBe(200);
    const latest = (history.body.items as { to_status: string; reason_code: string | null; note: string | null }[])[0];
    expect(latest.to_status).toBe('REJECTED');
    expect(latest.reason_code).toBe('CORRECTION_REQUIRED');
    expect(latest.note).toContain('illegible');
  });

  it('A4: resubmission after correction resumes review without deleting prior history', async () => {
    const resubmit = await t.http.post(`/api/orgs/${buyerOrg}/kyb/submit`).set(asBuyer())
      .send({ documents: [{ docType: 'GST', objectKey: `kyb/${randomUUID()}.pdf`, contentType: 'application/pdf', byteSize: 4096 }] });
    expect(resubmit.status).toBe(201);
    const history = await t.http.get(`/api/orgs/${buyerOrg}/kyb/history`).set(asBuyer());
    const statuses = (history.body.items as { to_status: string }[]).map((h) => h.to_status);
    expect(statuses.filter((s) => s === 'IN_REVIEW').length).toBeGreaterThanOrEqual(2);
    expect(statuses).toContain('REJECTED');
  });

  it('A5: authorized approval transitions through the controlled action with audit', async () => {
    const review = await t.http.post(`/api/admin/kyb/${buyerOrg}/review`).set(asReviewer())
      .send({ decision: 'VERIFIED' });
    expect(review.status).toBe(201);
    const org = await t.http.get(`/api/admin/orgs/${buyerOrg}`).set(asAdmin());
    expect(org.body.kyb_status).toBe('VERIFIED');
    const audit = await pool.query(
      `SELECT 1 FROM core.audit_events WHERE action = 'org.kyb.review' AND object_id = $1`, [buyerOrg]);
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('A6: rejection without a structured reason is blocked; correction without a note is blocked', async () => {
    const other = await register('buyer2');
    const otherOrg = await createOrg(other.accessToken, `P7 Buyer2 ${RUN}`, 'BUYER');
    await t.http.post(`/api/orgs/${otherOrg}/kyb/submit`).set(asOrg(other.accessToken, otherOrg))
      .send({ documents: [{ docType: 'PAN', objectKey: `kyb/${randomUUID()}.pdf`, contentType: 'application/pdf', byteSize: 1024 }] });
    const noReason = await t.http.post(`/api/admin/kyb/${otherOrg}/review`).set(asReviewer())
      .send({ decision: 'REJECTED' });
    expect(noReason.status).toBe(400);
    const noNote = await t.http.post(`/api/admin/kyb/${otherOrg}/review`).set(asReviewer())
      .send({ decision: 'REJECTED', reasonCode: 'CORRECTION_REQUIRED' });
    expect(noNote.status).toBe(400);
    const badCode = await t.http.post(`/api/admin/kyb/${otherOrg}/review`).set(asReviewer())
      .send({ decision: 'REJECTED', reasonCode: 'MADE_UP_CODE', note: 'x' });
    expect(badCode.status).toBe(400);
  });

  it('A7: support/procurement/unrelated roles cannot call the review endpoint', async () => {
    for (const headers of [asSup(), asProc(), asFin(), asBuyer()]) {
      const res = await t.http.post(`/api/admin/kyb/${randomUUID()}/review`).set(headers)
        .send({ decision: 'VERIFIED' });
      expect(res.status).toBe(403);
    }
  });

  // ---------- A8–A11: organization governance ----------

  it('A8: authorized admin suspends an organization with reason; state + audit recorded', async () => {
    const res = await t.http.post(`/api/admin/orgs/${buyerOrg}/restrict`).set(asAdmin())
      .send({ reason: 'Document fraud investigation' });
    expect(res.status).toBe(201);
    const org = await t.http.get(`/api/admin/orgs/${buyerOrg}`).set(asAdmin());
    expect(org.body.status).toBe('SUSPENDED');
    const audit = await pool.query(
      `SELECT 1 FROM core.audit_events WHERE action = 'org.suspend' AND object_id = $1`, [buyerOrg]);
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('A9: suspension without a reason is blocked', async () => {
    const other = await register('buyer3');
    const otherOrg = await createOrg(other.accessToken, `P7 Buyer3 ${RUN}`, 'BUYER');
    const res = await t.http.post(`/api/admin/orgs/${otherOrg}/restrict`).set(asAdmin()).send({ reason: '' });
    expect(res.status).toBe(400);
  });

  it('A10: reactivation is audited and history retained', async () => {
    const res = await t.http.post(`/api/admin/orgs/${buyerOrg}/lift`).set(asAdmin());
    expect(res.status).toBe(201);
    const org = await t.http.get(`/api/admin/orgs/${buyerOrg}`).set(asAdmin());
    expect(org.body.status).toBe('ACTIVE');
    const restrictions = await pool.query(
      `SELECT lifted_at FROM identity.org_restrictions WHERE org_id = $1`, [buyerOrg]);
    expect(restrictions.rows[0].lifted_at).not.toBeNull();
    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM core.audit_events WHERE object_id = $1 AND action IN ('org.suspend','org.unsuspend')`, [buyerOrg]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it('A11: cross-tenant admin data access is denied (IDOR-safe)', async () => {
    expect((await t.http.get(`/api/admin/orgs/${buyerOrg}`).set(asBuyer())).status).toBe(403);
    expect((await t.http.get(`/api/admin/orgs/${randomUUID()}`).set(asAdmin())).status).toBe(404);
  });

  // ---------- A12–A15: access governance ----------

  it('A12/A13/A14: org roles assignable; platform roles and self-escalation denied', async () => {
    const member = await register('member');
    await pool.query(
      `INSERT INTO identity.org_memberships (org_id, user_id, status) VALUES ($1, $2, 'ACTIVE') ON CONFLICT DO NOTHING`,
      [buyerOrg, member.userId]);
    const ok = await t.http.post(`/api/orgs/${buyerOrg}/members/${member.userId}/roles`).set(asBuyer())
      .send({ role: 'MEMBER' });
    expect([200, 201]).toContain(ok.status);
    for (const role of ['FINANCE_OPS', 'PLATFORM_ADMIN', 'PROCUREMENT_OPS', 'SUPPORT_AGENT']) {
      const denied = await t.http.post(`/api/orgs/${buyerOrg}/members/${member.userId}/roles`).set(asBuyer())
        .send({ role });
      expect(denied.status).toBe(403);
    }
  });

  it('A15: privileged roles carry the MFA-required flag in the read-only matrix', async () => {
    const res = await t.http.get('/api/admin/roles').set(asAdmin());
    expect(res.status).toBe(200);
    const admin = (res.body.items as { name: string; mfa_required: boolean }[]).find((r) => r.name === 'PLATFORM_ADMIN');
    expect(admin?.mfa_required).toBe(true);
    // Roles page is read-only: no mutation routes exist.
    expect((await t.http.post('/api/admin/roles').set(asAdmin()).send({ name: 'X' })).status).toBe(404);
    expect((await t.http.patch('/api/admin/roles').set(asAdmin()).send({})).status).toBe(404);
  });

  // ---------- A16–A19: configuration & feature flags ----------

  it('A16: authorized config change retains old/new value, actor and timestamp', async () => {
    const res = await t.http.patch('/api/admin/config/LOT_EVIDENCE_MIN_PHOTOS').set(asAdmin())
      .send({ value: 3, reason: 'Pilot evidence tightening' });
    expect(res.status).toBe(200);
    const config = await t.http.get('/api/admin/config').set(asAdmin());
    const row = (config.body.items as { key: string; value: string }[]).find((c) => c.key === 'LOT_EVIDENCE_MIN_PHOTOS');
    expect(row?.value).toBe('3');
    const audit = await pool.query(
      `SELECT before, after, actor_user_id FROM core.audit_events WHERE action = 'admin.config.update' AND object_ref = 'LOT_EVIDENCE_MIN_PHOTOS' ORDER BY occurred_at DESC LIMIT 1`);
    expect(audit.rows[0].before.value).toBe('2');
    expect(audit.rows[0].actor_user_id).toBe(admin.userId);
    // restore
    await t.http.patch('/api/admin/config/LOT_EVIDENCE_MIN_PHOTOS').set(asAdmin()).send({ value: 2, reason: 'restore' });
  });

  it('A17: unauthorized config change is denied', async () => {
    expect((await t.http.patch('/api/admin/config/LOT_EVIDENCE_MIN_PHOTOS').set(asProc()).send({ value: 9 })).status).toBe(403);
    expect((await t.http.patch('/api/admin/config/LOT_EVIDENCE_MIN_PHOTOS').set(asBuyer()).send({ value: 9 })).status).toBe(403);
    expect((await t.http.patch('/api/admin/config/NO_SUCH_KEY').set(asAdmin()).send({ value: 1 })).status).toBe(404);
  });

  it('A18: feature-flag change is effective-dated and audited', async () => {
    const res = await t.http.post('/api/admin/flags/INDEPENDENT_INSPECTION_ENABLED').set(asAdmin())
      .send({ enabled: false, reason: 'remains disabled for pilot' });
    expect(res.status).toBe(201);
    const flags = await t.http.get('/api/admin/flags').set(asAdmin());
    const rows = (flags.body.items as { key: string; enabled: boolean; valid_to: string | null }[])
      .filter((f) => f.key === 'INDEPENDENT_INSPECTION_ENABLED');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const audit = await pool.query(
      `SELECT 1 FROM core.audit_events WHERE action = 'admin.flag.update' AND object_ref = 'INDEPENDENT_INSPECTION_ENABLED'`);
    expect(audit.rowCount).toBeGreaterThan(0);
    expect((await t.http.post('/api/admin/flags/NO_SUCH_FLAG').set(asAdmin()).send({ enabled: true })).status).toBe(404);
  });

  it('A19: a flag being ON never bypasses domain authorization', async () => {
    await t.http.post('/api/admin/flags/INDEPENDENT_INSPECTION_ENABLED').set(asAdmin())
      .send({ enabled: true, reason: 'A19 verification' });
    const denied = await t.http.post('/api/quality/inspections').set(asBuyer())
      .send({ lotId: randomUUID(), scope: 'FULL' });
    expect(denied.status).toBe(403);
    await t.http.post('/api/admin/flags/INDEPENDENT_INSPECTION_ENABLED').set(asAdmin())
      .send({ enabled: false, reason: 'A19 restore' });
  });

  // ---------- A20–A22: audit inspection ----------

  it('A20: authorized auditor searches by action/object/date', async () => {
    const res = await t.http.get('/api/admin/audit?action=org.kyb.review&objectType=organization').set(asAdmin());
    expect(res.status).toBe(200);
    const items = res.body.items as { action: string; object_type: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.action === 'org.kyb.review' && i.object_type === 'organization')).toBe(true);
    expect((await t.http.get('/api/admin/audit').set(asBuyer())).status).toBe(403);
  });

  it('A21: audit events cannot be edited or deleted — no API path, DB trigger enforces', async () => {
    expect((await t.http.post('/api/admin/audit').set(asAdmin()).send({})).status).toBe(404);
    expect((await t.http.delete(`/api/admin/audit/${randomUUID()}`).set(asAdmin())).status).toBe(404);
    await expect(pool.query(`UPDATE core.audit_events SET action = 'tampered' LIMIT 1`)).rejects.toThrow();
    await expect(pool.query(`DELETE FROM core.audit_events LIMIT 1`)).rejects.toThrow();
  });

  it('A22: authorized audit export is permission-safe and itself audited', async () => {
    const res = await t.http.get('/api/admin/audit/export?action=org.kyb.review').set(asAdmin());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('id,occurred_at,action');
    expect(res.text).not.toContain('password');
    const audit = await pool.query(
      `SELECT 1 FROM core.audit_events WHERE action = 'admin.audit_export'`);
    expect(audit.rowCount).toBeGreaterThan(0);
    expect((await t.http.get('/api/admin/audit/export').set(asSup())).status).toBe(403);
  });

  // ---------- §43: Admin is not a marketplace actor ----------

  it('S5: admin cannot assign partner drivers, mutate milestones, or submit partner POD', async () => {
    const job = randomUUID();
    expect((await t.http.post(`/api/logistics/jobs/${job}/assign-driver`).set(asAdmin())
      .send({ driverUserId: randomUUID() })).status).toBe(403);
    const milestones: [string, unknown][] = [
      [`/api/logistics/jobs/${job}/pickup`, {}],
      [`/api/logistics/jobs/${job}/transit`, {}],
      [`/api/logistics/jobs/${job}/deliver`, { deliveredQty: 1 }],
      [`/api/logistics/jobs/${job}/arrived-pickup`, {}],
      [`/api/logistics/jobs/${job}/arrived-delivery`, {}]
    ];
    for (const [path, body] of milestones) {
      const res = await t.http.post(path).set(asAdmin()).send(body as Record<string, unknown>);
      expect([403, 404]).toContain(res.status);
    }
  });

  it('S6: admin cannot perform unsupported claim financial resolution', async () => {
    // claim.manage transitions are state-machine-bound: illegal jumps are rejected.
    const res = await t.http.post(`/api/claims/${randomUUID()}/transition`).set(asAdmin())
      .send({ to: 'FINANCIAL_ADJUSTMENT', adjustmentMinor: 100 });
    expect([404, 409]).toContain(res.status);
  });

  it('S7: suspended user cannot act — login blocked, live tokens lose org context', async () => {
    const victim = await register('victim');
    const victimOrg = await createOrg(victim.accessToken, `P7 Victim ${RUN}`, 'BUYER');
    const before = await t.http.get('/api/orgs/mine').set('Authorization', `Bearer ${victim.accessToken}`);
    expect(before.status).toBe(200);
    const suspend = await t.http.post(`/api/admin/users/${victim.userId}/suspend`).set(asAdmin())
      .send({ reason: 'Fraud investigation' });
    expect(suspend.status).toBe(201);
    const login = await t.http.post('/api/auth/login').send({ email: email('victim'), password });
    expect(login.status).toBe(403);
    const orgCall = await t.http.get(`/api/orgs/${victimOrg}`).set(asOrg(victim.accessToken, victimOrg));
    expect(orgCall.status).toBe(403);
    const reactivate = await t.http.post(`/api/admin/users/${victim.userId}/reactivate`).set(asAdmin());
    expect(reactivate.status).toBe(201);
    const after = await t.http.post('/api/auth/login').send({ email: email('victim'), password });
    expect([200, 201]).toContain(after.status);
  });

  it('S8: suspend requires reason; self-suspension blocked; non-admin cannot suspend', async () => {
    expect((await t.http.post(`/api/admin/users/${randomUUID()}/suspend`).set(asAdmin()).send({ reason: '' })).status).toBe(400);
    expect((await t.http.post(`/api/admin/users/${admin.userId}/suspend`).set(asAdmin()).send({ reason: 'self' })).status).toBe(409);
    expect((await t.http.post(`/api/admin/users/${randomUUID()}/suspend`).set(asReviewer()).send({ reason: 'x' })).status).toBe(403);
  });

  it('S9: bank/payout dual control holds for admin actors (no self-approval)', async () => {
    // Bank accounts are supplier-side only (Build 1) — use a GROWER org.
    const grower = await register('grower');
    const growerOrg = await createOrg(grower.accessToken, `P7 Grower ${RUN}`, 'GROWER');
    const create = await t.http.post(`/api/orgs/${growerOrg}/bank/accounts`).set(asOrg(grower.accessToken, growerOrg))
      .send({ accountRef: 'P7', ifsc: 'SBIN0001234', accountNumber: '987654321012', holderName: 'P7 Grower' });
    expect(create.status).toBe(201);
    const reqId = create.body.changeRequestId as string;
    const first = await t.http.post(`/api/orgs/${growerOrg}/bank/change-requests/${reqId}/approve`).set(asAdmin());
    expect(first.status).toBe(201);
    const second = await t.http.post(`/api/orgs/${growerOrg}/bank/change-requests/${reqId}/approve`).set(asAdmin());
    expect(second.status).toBe(409);
  });

  it('S10: general staff search never exposes bank documents or sensitive types', async () => {
    const res = await t.http.get('/api/tower/search?q=bank').set(asProc());
    expect(res.status).toBe(200);
    const types = (res.body.items as { type: string }[]).map((i) => i.type);
    for (const type of types) {
      expect(['order', 'requirement', 'claim', 'shipment', 'organization']).toContain(type);
    }
  });

  it('S11: overview aggregates governance signals for authorized admins only', async () => {
    const res = await t.http.get('/api/admin/overview').set(asAdmin());
    expect(res.status).toBe(200);
    expect(typeof res.body.kybPendingReview).toBe('number');
    expect(typeof res.body.restrictedOrganizations).toBe('number');
    expect(Array.isArray(res.body.recentAdminActivity)).toBe(true);
    expect((await t.http.get('/api/admin/overview').set(asReviewer())).status).toBe(200);
    expect((await t.http.get('/api/admin/overview').set(asBuyer())).status).toBe(403);
  });
});
