// GATE REQ-XCUT-05: idempotency baseline against the real DB.
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { bootTestApp, ORG_A, TestApp } from './helpers';

describe('GATE: idempotency baseline', () => {
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

  it('same key + same body: one side effect, byte-identical replay', async () => {
    const key = `idem-${randomUUID()}`;
    const body = { key: `idem.${randomUUID()}`, value: { n: 1 } };
    const auth = `Bearer ${t.tokenFor(ORG_A, ['config.write'])}`;

    const first = await t.http.post('/api/_baseline/entries').set('Authorization', auth).set('Idempotency-Key', key).send(body);
    const second = await t.http.post('/api/_baseline/entries').set('Authorization', auth).set('Idempotency-Key', key).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);

    const rows = await pool.query('SELECT id FROM core.config_entries WHERE key = $1', [body.key]);
    expect(rows.rowCount).toBe(1);
  });

  it('same key + different body: 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const key = `idem-${randomUUID()}`;
    const auth = `Bearer ${t.tokenFor(ORG_A, ['config.write'])}`;
    await t.http.post('/api/_baseline/entries').set('Authorization', auth).set('Idempotency-Key', key)
      .send({ key: `a.${randomUUID()}`, value: 1 });
    const conflict = await t.http.post('/api/_baseline/entries').set('Authorization', auth).set('Idempotency-Key', key)
      .send({ key: `b.${randomUUID()}`, value: 2 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});
