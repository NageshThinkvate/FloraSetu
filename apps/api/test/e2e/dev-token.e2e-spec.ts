// GATE REQ-SEC-01: dev-token endpoint is reachable over HTTP for anonymous callers
// (guarded by NODE_ENV, not by RBAC) — regression coverage for guard-scope bug.
import { bootTestApp, ORG_A, TestApp } from './helpers';

describe('GATE: dev-token over HTTP', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('mints a usable bearer token without prior auth', async () => {
    const mint = await t.http
      .post('/api/_baseline/dev-token')
      .send({ sub: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', orgId: ORG_A, permissions: ['config.read'] });
    expect(mint.status).toBe(200);
    expect(mint.body.token).toBeDefined();

    const list = await t.http
      .get('/api/_baseline/entries')
      .set('Authorization', `Bearer ${mint.body.token}`);
    expect(list.status).toBe(200);
  });
});
