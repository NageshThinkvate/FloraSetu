// PHASE 2 GATE: workspace capabilities exposure (UX-ADR-001) + B2 notification feed.
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { bootTestApp, TestApp } from './helpers';

const password = 'Sup3rSecret99';

describe('GATE Phase 2: workspace capabilities + notification feed (B2)', () => {
  let t: TestApp;
  let pool: Pool;

  beforeAll(async () => {
    t = await bootTestApp();
    pool = new Pool({ connectionString: t.config.databaseUrl });
  });

  afterAll(async () => {
    await pool.end();
    await t.app.close();
  });

  const register = async (label: string): Promise<{ userId: string; accessToken: string }> => {
    const e = `${label}.${randomUUID()}@test.florasetu.local`;
    const res = await t.http.post('/api/auth/register').send({ email: e, password, displayName: label });
    expect(res.status).toBe(201);
    return { userId: res.body.userId as string, accessToken: res.body.accessToken as string };
  };

  const createOrg = async (token: string, name: string, category: string): Promise<string> => {
    const res = await t.http.post('/api/orgs').set('Authorization', `Bearer ${token}`).send({ name, category });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  it('P2-1: /auth/me exposes explicit org capabilities on memberships', async () => {
    const u = await register('p2caps');
    const orgId = await createOrg(u.accessToken, 'Caps Trading', 'WHOLESALER');
    await pool.query(`UPDATE identity.organizations SET capabilities = ARRAY['BUYER','SUPPLIER'] WHERE id = $1`, [orgId]);
    const me = await t.http.get('/api/auth/me').set('Authorization', `Bearer ${u.accessToken}`);
    expect(me.status).toBe(200);
    const membership = (me.body.memberships as { org_id: string; capabilities: string[] }[]).find(
      (m) => m.org_id === orgId
    );
    expect(membership).toBeDefined();
    expect(membership!.capabilities).toEqual(expect.arrayContaining(['BUYER', 'SUPPLIER']));
  });

  it('P2-2: org creation derives default capabilities from category (explicit, overridable)', async () => {
    const u = await register('p2defaults');
    const grower = await createOrg(u.accessToken, 'Default Grower', 'GROWER');
    const buyer = await createOrg(u.accessToken, 'Default Florist', 'FLORIST');
    const rows = await pool.query<{ id: string; capabilities: string[] }>(
      `SELECT id, capabilities FROM identity.organizations WHERE id = ANY($1::uuid[])`,
      [[grower, buyer]]
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r.capabilities]));
    expect(byId.get(grower)).toEqual(['SUPPLIER']);
    expect(byId.get(buyer)).toEqual(['BUYER']);
  });

  it('P2-3: notification feed is org-scoped with unread count and mark-read', async () => {
    const u = await register('p2notif');
    const orgId = await createOrg(u.accessToken, 'Notif Org', 'FLORIST');
    await pool.query(
      `INSERT INTO notifications.notifications (org_id, user_id, payload) VALUES ($1, NULL, $2)`,
      [orgId, JSON.stringify({ type: 'quote.received', rfqId: randomUUID() })]
    );
    const list = await t.http
      .get('/api/notifications')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .set('X-Org-Id', orgId);
    expect(list.status).toBe(200);
    expect(list.body.unreadCount).toBe(1);
    expect(list.body.items[0].type).toBe('quote.received');
    const id = list.body.items[0].id as string;
    const read = await t.http
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .set('X-Org-Id', orgId);
    expect(read.status).toBe(201);
    const again = await t.http
      .get('/api/notifications')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .set('X-Org-Id', orgId);
    expect(again.body.unreadCount).toBe(0);
  });

  it('P2-4: another organization cannot see or read foreign notifications', async () => {
    const u = await register('p2isolation');
    const orgA = await createOrg(u.accessToken, 'Notif A', 'FLORIST');
    const orgB = await createOrg(u.accessToken, 'Notif B', 'GROWER');
    await pool.query(
      `INSERT INTO notifications.notifications (org_id, user_id, payload) VALUES ($1, NULL, $2)`,
      [orgA, JSON.stringify({ type: 'order.allocated', orderId: randomUUID() })]
    );
    const listB = await t.http
      .get('/api/notifications')
      .set('Authorization', `Bearer ${u.accessToken}`)
      .set('X-Org-Id', orgB);
    expect(listB.status).toBe(200);
    expect(listB.body.items).toHaveLength(0);
    const foreignId = (
      await pool.query<{ id: string }>(`SELECT id FROM notifications.notifications WHERE org_id = $1`, [orgA])
    ).rows[0].id;
    const readForeign = await t.http
      .post(`/api/notifications/${foreignId}/read`)
      .set('Authorization', `Bearer ${u.accessToken}`)
      .set('X-Org-Id', orgB);
    expect(readForeign.status).toBe(404);
  });
});
