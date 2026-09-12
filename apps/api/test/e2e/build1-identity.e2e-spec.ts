// BUILD 1 GATE: Identity & Party — auth, tenancy, RBAC, KYB, bank dual-approval,
// suspension, IDOR, privilege escalation, rate limiting.
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import { bootTestApp, TestApp } from './helpers';

const password = 'Sup3rSecret99';

describe('GATE Build 1: identity, party, organizations & RBAC', () => {
  let t: TestApp;
  let pool: Pool;

  const email = (label: string) => `${label}.${randomUUID()}@test.florasetu.local`;

  const register = async (label: string): Promise<{ userId: string; accessToken: string; email: string }> => {
    const e = email(label);
    const res = await t.http.post('/api/auth/register').send({ email: e, password, displayName: label });
    expect(res.status).toBe(201);
    return { userId: res.body.userId, accessToken: res.body.accessToken, email: e };
  };

  const login = async (e: string, mfaCode?: string) =>
    t.http.post('/api/auth/login').send({ email: e, password, mfaCode });

  const createOrg = async (token: string, name: string, category: string) => {
    const res = await t.http.post('/api/orgs').set('Authorization', `Bearer ${token}`).send({ name, category });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  const makePlatformUser = async (label: string, role: string) => {
    const u = await register(label);
    await pool.query(
      `INSERT INTO identity.org_memberships (org_id, user_id, status)
       SELECT o.id, $1, 'ACTIVE' FROM identity.organizations o WHERE o.ref = 'TEST-PLATFORM'
       ON CONFLICT DO NOTHING`,
      [u.userId]
    );
    await pool.query(
      `INSERT INTO identity.user_roles (user_id, role_id, org_id)
       SELECT $1, r.id, o.id FROM identity.roles r, identity.organizations o
       WHERE r.name = $2 AND r.org_id IS NULL AND o.ref = 'TEST-PLATFORM'
       ON CONFLICT DO NOTHING`,
      [u.userId, role]
    );
    const platformOrg = await pool.query<{ id: string }>(`SELECT id FROM identity.organizations WHERE ref = 'TEST-PLATFORM'`);
    return { ...u, platformOrgId: platformOrg.rows[0].id };
  };

  let buyer: { userId: string; accessToken: string; email: string };
  let grower1: { userId: string; accessToken: string; email: string };
  let grower2: { userId: string; accessToken: string; email: string };
  let admin: { userId: string; accessToken: string; email: string; platformOrgId: string };
  let finance1: { userId: string; accessToken: string; email: string; platformOrgId: string };
  let finance2: { userId: string; accessToken: string; email: string; platformOrgId: string };
  let buyerOrgId: string;
  let grower1OrgId: string;
  let grower2OrgId: string;

  const asOrg = (token: string, orgId: string) => ({ Authorization: `Bearer ${token}`, 'x-org-id': orgId });

  beforeAll(async () => {
    t = await bootTestApp();
    pool = new Pool({ connectionString: t.config.databaseUrl });
    await pool.query(
      `INSERT INTO identity.organizations (ref, name, type) VALUES ('TEST-PLATFORM', 'Test Platform', 'PLATFORM_OPS')
       ON CONFLICT (ref) DO NOTHING`
    );
    [buyer, grower1, grower2] = [await register('buyer'), await register('grower1'), await register('grower2')];
    admin = await makePlatformUser('admin', 'PLATFORM_ADMIN');
    finance1 = await makePlatformUser('finance1', 'FINANCE_OPS');
    finance2 = await makePlatformUser('finance2', 'FINANCE_OPS');
    buyerOrgId = await createOrg(buyer.accessToken, 'Buyer Alpha', 'BUYER');
    grower1OrgId = await createOrg(grower1.accessToken, 'Grower One', 'GROWER');
    grower2OrgId = await createOrg(grower2.accessToken, 'Grower Two', 'GROWER');
  });

  afterAll(async () => {
    await pool.end();
    await t.app.close();
  });

  describe('auth: register / login / refresh / me / MFA', () => {
    it('registers, logs in, refreshes, reads me, logs out', async () => {
      const u = await register('flow');
      const me = await t.http.get('/api/auth/me').set('Authorization', `Bearer ${u.accessToken}`);
      expect(me.status).toBe(200);
      expect(me.body.email).toBe(u.email);

      const loginRes = await login(u.email);
      expect(loginRes.status).toBe(201);
      const refreshed = await t.http.post('/api/auth/refresh').send({ refreshToken: loginRes.body.refreshToken });
      expect(refreshed.status).toBe(201);
      expect(refreshed.body.accessToken).toBeDefined();
      // rotated: old refresh token no longer usable
      const reuse = await t.http.post('/api/auth/refresh').send({ refreshToken: loginRes.body.refreshToken });
      expect(reuse.status).toBe(401);
      const logout = await t.http.post('/api/auth/logout').send({ refreshToken: refreshed.body.refreshToken });
      expect(logout.status).toBe(201);
    });

    it('wrong password is rejected with the standard envelope', async () => {
      const res = await t.http.post('/api/auth/login').send({ email: buyer.email, password: 'wrong-pass-1' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.error.trace_id).toBeDefined();
    });

    it('MFA: enroll, verify, then login requires the code', async () => {
      const u = await register('mfa');
      const enroll = await t.http.post('/api/auth/mfa/enroll').set('Authorization', `Bearer ${u.accessToken}`).send({});
      expect(enroll.status).toBe(201);
      const code = authenticator.generate(enroll.body.secret);
      const verify = await t.http.post('/api/auth/mfa/verify').set('Authorization', `Bearer ${u.accessToken}`).send({ code });
      expect(verify.status).toBe(201);

      const noCode = await login(u.email);
      expect(noCode.status).toBe(401);
      expect(noCode.body.error.code).toBe('MFA_REQUIRED');
      const withCode = await login(u.email, authenticator.generate(enroll.body.secret));
      expect(withCode.status).toBe(201);
    });

    it('rate-limits repeated failed logins (lockout after 5)', async () => {
      const u = await register('ratelimit');
      let last = 0;
      for (let i = 0; i < 5; i++) {
        const res = await t.http.post('/api/auth/login').send({ email: u.email, password: 'bad-pass-000' });
        last = res.status;
      }
      expect(last).toBe(401);
      const locked = await t.http.post('/api/auth/login').send({ email: u.email, password: 'bad-pass-000' });
      expect(locked.status).toBe(429);
      expect(locked.body.error.code).toBe('RATE_LIMITED');
      // even the correct password is locked out now
      const stillLocked = await login(u.email);
      expect(stillLocked.status).toBe(429);
    });
  });

  describe('organization onboarding + category gating', () => {
    it('creates orgs across categories and lists them under /orgs/mine', async () => {
      const mine = await t.http.get('/api/orgs/mine').set('Authorization', `Bearer ${buyer.accessToken}`);
      expect(mine.status).toBe(200);
      expect(mine.body.items.map((o: { id: string }) => o.id)).toContain(buyerOrgId);
    });

    it('exporter/government categories are feature-gated', async () => {
      const res = await t.http
        .post('/api/orgs').set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ name: 'Exporter X', category: 'EXPORTER' });
      expect(res.status).toBe(403);
    });

    it('platform-internal categories require platform privileges', async () => {
      const res = await t.http
        .post('/api/orgs').set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ name: 'Fake Ops', category: 'PLATFORM_OPS' });
      expect(res.status).toBe(403);
      const okRes = await t.http
        .post('/api/orgs').set('Authorization', `Bearer ${admin.accessToken}`).set('x-org-id', admin.platformOrgId)
        .send({ name: 'Real Ops', category: 'PLATFORM_OPS' });
      expect(okRes.status).toBe(201);
    });
  });

  describe('tenant isolation + IDOR', () => {
    it('tenant A cannot read tenant B organization (404, existence hidden)', async () => {
      const res = await t.http.get(`/api/orgs/${grower1OrgId}`).set(asOrg(buyer.accessToken, buyerOrgId));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('tenant A cannot write tenant B organization', async () => {
      const res = await t.http
        .patch(`/api/orgs/${grower1OrgId}`).set(asOrg(buyer.accessToken, buyerOrgId)).send({ name: 'hijack' });
      expect(res.status).toBe(404);
    });

    it('IDOR: random org id is 404, members of other orgs are not listable', async () => {
      const random = await t.http.get(`/api/orgs/${randomUUID()}`).set(asOrg(buyer.accessToken, buyerOrgId));
      expect(random.status).toBe(404);
      const members = await t.http.get(`/api/orgs/${grower2OrgId}/members`).set(asOrg(grower1.accessToken, grower1OrgId));
      expect(members.status).toBe(404);
    });

    it('supplier cannot access another supplier commercial data (bank accounts)', async () => {
      const res = await t.http.get(`/api/orgs/${grower1OrgId}/bank/accounts`).set(asOrg(grower2.accessToken, grower2OrgId));
      expect(res.status).toBe(404);
    });

    it('membership in the caller org is required (foreign x-org-id rejected)', async () => {
      const res = await t.http.get(`/api/orgs/${grower1OrgId}`).set(asOrg(buyer.accessToken, grower1OrgId));
      expect(res.status).toBe(403);
    });
  });

  describe('role-aware authorization', () => {
    it('buyer cannot execute supplier-only action (payout profile)', async () => {
      const res = await t.http
        .post(`/api/orgs/${buyerOrgId}/bank/accounts`).set(asOrg(buyer.accessToken, buyerOrgId))
        .send({ accountRef: 'P', ifsc: 'HDFC0000001', accountNumber: '1234567890', holderName: 'Buyer Alpha' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('membership invite + accept + role assignment works; MEMBER cannot invite', async () => {
      const invitee = await register('invitee');
      const invite = await t.http
        .post(`/api/orgs/${grower1OrgId}/members`).set(asOrg(grower1.accessToken, grower1OrgId))
        .send({ email: invitee.email });
      expect(invite.status).toBe(201);
      const accept = await t.http
        .post(`/api/orgs/${grower1OrgId}/members/accept/${invite.body.membershipId}`)
        .set('Authorization', `Bearer ${invitee.accessToken}`);
      expect(accept.status).toBe(201);
      await t.http
        .post(`/api/orgs/${grower1OrgId}/members/${invitee.userId}/roles`)
        .set(asOrg(grower1.accessToken, grower1OrgId)).send({ role: 'MEMBER' });
      const forbidden = await t.http
        .post(`/api/orgs/${grower1OrgId}/members`).set(asOrg(invitee.accessToken, grower1OrgId))
        .send({ email: 'nobody@x.local' });
      expect(forbidden.status).toBe(403);
    });

    it('privilege escalation: org admin cannot grant PLATFORM_ADMIN; tampered tokens rejected', async () => {
      const res = await t.http
        .post(`/api/orgs/${grower1OrgId}/members/${grower1.userId}/roles`)
        .set(asOrg(grower1.accessToken, grower1OrgId)).send({ role: 'PLATFORM_ADMIN' });
      expect(res.status).toBe(403);
      const [payload, sig] = grower1.accessToken.split('.');
      const tamperedPayload = Buffer.from(JSON.stringify({ sub: admin.userId, type: 'access', exp: 9999999999 })).toString('base64url');
      const tampered = await t.http.get('/api/auth/me').set('Authorization', `Bearer ${tamperedPayload}.${sig}`);
      expect(tampered.status).toBe(401);
      expect(payload).toBeDefined();
    });
  });

  describe('KYB verification', () => {
    it('submit → IN_REVIEW → platform review → VERIFIED, with immutable history', async () => {
      const submit = await t.http
        .post(`/api/orgs/${grower1OrgId}/kyb/submit`).set(asOrg(grower1.accessToken, grower1OrgId))
        .send({ documents: [{ docType: 'GST', objectKey: `kyb/${randomUUID()}.pdf`, contentType: 'application/pdf', byteSize: 2048 }] });
      expect(submit.status).toBe(201);
      const review = await t.http
        .post(`/api/admin/kyb/${grower1OrgId}/review`).set(asOrg(admin.accessToken, admin.platformOrgId))
        .send({ decision: 'VERIFIED' });
      expect(review.status).toBe(201);
      const history = await t.http
        .get(`/api/orgs/${grower1OrgId}/kyb/history`).set(asOrg(grower1.accessToken, grower1OrgId));
      const statuses = history.body.items.map((h: { to_status: string }) => h.to_status);
      expect(statuses).toEqual(expect.arrayContaining(['IN_REVIEW', 'VERIFIED']));
      // non-privileged user cannot review
      const denied = await t.http
        .post(`/api/admin/kyb/${grower2OrgId}/review`).set(asOrg(grower1.accessToken, grower1OrgId))
        .send({ decision: 'VERIFIED' });
      expect(denied.status).toBe(403);
    });
  });

  describe('bank change: reverification, dual approval, audit (ADR-004)', () => {
    it('full flow: request → freeze → first approval → distinct second approval → final', async () => {
      const create = await t.http
        .post(`/api/orgs/${grower1OrgId}/bank/accounts`).set(asOrg(grower1.accessToken, grower1OrgId))
        .send({ accountRef: 'P', ifsc: 'SBIN0001234', accountNumber: '987654321012', holderName: 'Grower One' });
      expect(create.status).toBe(201);
      expect(create.body.status).toBe('PENDING_REVERIFICATION');
      const reqId = create.body.changeRequestId;

      // masked read-back
      const accounts = await t.http.get(`/api/orgs/${grower1OrgId}/bank/accounts`).set(asOrg(grower1.accessToken, grower1OrgId));
      expect(accounts.body.items[0].account_number).toMatch(/^\*{4}\d{4}$/);

      const first = await t.http
        .post(`/api/orgs/${grower1OrgId}/bank/change-requests/${reqId}/approve`)
        .set(asOrg(finance1.accessToken, finance1.platformOrgId));
      expect(first.status).toBe(201);
      expect(first.body.status).toBe('APPROVED_FIRST');

      // same approver twice → rejected (dual control)
      const dup = await t.http
        .post(`/api/orgs/${grower1OrgId}/bank/change-requests/${reqId}/approve`)
        .set(asOrg(finance1.accessToken, finance1.platformOrgId));
      expect(dup.status).toBe(409);

      const second = await t.http
        .post(`/api/orgs/${grower1OrgId}/bank/change-requests/${reqId}/approve`)
        .set(asOrg(finance2.accessToken, finance2.platformOrgId));
      expect(second.status).toBe(201);
      expect(second.body.status).toBe('APPROVED_FINAL');

      // supplier without bank.approve cannot approve
      const denied = await t.http
        .post(`/api/orgs/${grower1OrgId}/bank/change-requests/${reqId}/approve`)
        .set(asOrg(grower1.accessToken, grower1OrgId));
      expect(denied.status).toBe(403);

      // immutable audit trail + security stream + verification history
      const audits = await pool.query(
        `SELECT action FROM core.audit_events WHERE object_id = $1 ORDER BY occurred_at`, [reqId]);
      expect(audits.rows.map((r) => r.action)).toEqual([
        'bank.change.request', 'bank.change.approve.first', 'bank.change.approve.final'
      ]);
      const security = await pool.query(
        `SELECT event_type FROM core.security_audit_events WHERE detail->>'requestId' = $1`, [reqId]);
      expect(security.rowCount).toBeGreaterThanOrEqual(2);
      const history = await pool.query(
        `SELECT to_status FROM identity.verification_history WHERE subject_id = $1`, [reqId]);
      expect(history.rows.map((r) => r.to_status)).toEqual(
        ['PENDING_REVERIFICATION', 'APPROVED_FIRST', 'APPROVED_FINAL']);

      // freeze lifted after final approval
      const finalReq = await pool.query(`SELECT payout_freeze FROM identity.bank_change_requests WHERE id = $1`, [reqId]);
      expect(finalReq.rows[0].payout_freeze).toBe(false);
    });

    it('payout/settlement history is immutable even for platform admins', async () => {
      const settlement = await pool.query(
        `INSERT INTO payments.settlements (ref, org_id, amount_minor, currency)
         VALUES ($1, $2, 1000, 'INR') RETURNING id`,
        [`SET-TEST-${randomUUID().slice(0, 8)}`, grower1OrgId]
      );
      await expect(
        pool.query(`UPDATE payments.settlements SET amount_minor = 1 WHERE id = $1`, [settlement.rows[0].id])
      ).rejects.toThrow(/immutable record/);
      // and no API surface exists to mutate it
      const res = await t.http
        .patch(`/api/admin/settlements/${settlement.rows[0].id}`)
        .set(asOrg(admin.accessToken, admin.platformOrgId)).send({ amount_minor: 1 });
      expect(res.status).toBe(404);
    });
  });

  describe('suspension / restriction', () => {
    it('suspended org loses transactional privileges but keeps reads; lift restores', async () => {
      const restrict = await t.http
        .post(`/api/admin/orgs/${grower2OrgId}/restrict`).set(asOrg(admin.accessToken, admin.platformOrgId))
        .send({ reason: 'KYB mismatch' });
      expect(restrict.status).toBe(201);

      const write = await t.http
        .post(`/api/orgs/${grower2OrgId}/bank/accounts`).set(asOrg(grower2.accessToken, grower2OrgId))
        .send({ accountRef: 'P', ifsc: 'SBIN0001234', accountNumber: '111122223333', holderName: 'Grower Two' });
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe('ORG_SUSPENDED');

      const read = await t.http.get(`/api/orgs/${grower2OrgId}`).set(asOrg(grower2.accessToken, grower2OrgId));
      expect(read.status).toBe(200);

      // non-privileged cannot suspend
      const denied = await t.http
        .post(`/api/admin/orgs/${buyerOrgId}/restrict`).set(asOrg(grower1.accessToken, grower1OrgId))
        .send({ reason: 'nope' });
      expect(denied.status).toBe(403);

      const lift = await t.http
        .post(`/api/admin/orgs/${grower2OrgId}/lift`).set(asOrg(admin.accessToken, admin.platformOrgId)).send({});
      expect(lift.status).toBe(201);
      const after = await t.http
        .post(`/api/orgs/${grower2OrgId}/bank/accounts`).set(asOrg(grower2.accessToken, grower2OrgId))
        .send({ accountRef: 'P', ifsc: 'SBIN0001234', accountNumber: '111122223333', holderName: 'Grower Two' });
      expect(after.status).toBe(201);
    });

    it('audited support access: grant required, every read security-audited', async () => {
      const support = await makePlatformUser('support', 'SUPPORT_AGENT');
      // without grant → 404
      const noGrant = await t.http.get(`/api/admin/orgs/${buyerOrgId}`).set(asOrg(support.accessToken, support.platformOrgId));
      expect(noGrant.status).toBe(404);
      const grant = await t.http
        .post('/api/admin/support-sessions').set(asOrg(support.accessToken, support.platformOrgId))
        .send({ orgId: buyerOrgId, reason: 'ticket #1' });
      expect(grant.status).toBe(201);
      const read = await t.http.get(`/api/admin/orgs/${buyerOrgId}`).set(asOrg(support.accessToken, support.platformOrgId));
      expect(read.status).toBe(200);
      const sec = await pool.query(
        `SELECT event_type FROM core.security_audit_events
         WHERE detail->>'orgId' = $1 AND event_type LIKE 'support.access%' ORDER BY occurred_at`,
        [buyerOrgId]
      );
      expect(sec.rows.map((r) => r.event_type)).toEqual(
        expect.arrayContaining(['support.access.granted', 'support.access.read']));
    });
  });
});
