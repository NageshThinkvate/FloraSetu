// GATE REQ-SEC-02: tenant isolation baseline — org A never sees org B data.
import { bootTestApp, ORG_A, ORG_B, TestApp } from './helpers';
import { randomUUID } from 'crypto';

describe('GATE: tenant isolation', () => {
  let t: TestApp;
  let entryId: string;

  beforeAll(async () => {
    t = await bootTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('org A creates an entry', async () => {
    const res = await t.http
      .post('/api/_baseline/entries')
      .set('Authorization', `Bearer ${t.tokenFor(ORG_A, ['config.write'])}`)
      .set('Idempotency-Key', `iso-${randomUUID()}`)
      .send({ key: `iso.${randomUUID()}`, value: { owner: 'A' } });
    expect(res.status).toBe(201);
    entryId = res.body.id;
  });

  it('org B cannot read org A entry (404, existence hidden)', async () => {
    const res = await t.http
      .get(`/api/_baseline/entries/${entryId}`)
      .set('Authorization', `Bearer ${t.tokenFor(ORG_B, ['config.read'])}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.trace_id).toBeDefined();
  });

  it('org B list contains zero org A rows', async () => {
    const res = await t.http
      .get('/api/_baseline/entries')
      .set('Authorization', `Bearer ${t.tokenFor(ORG_B, ['config.read'])}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(entryId);
  });

  it('unauthenticated calls are rejected with the standard envelope', async () => {
    const res = await t.http.get('/api/_baseline/entries');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
