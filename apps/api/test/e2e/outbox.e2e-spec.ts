// GATE REQ-ASYNC-01: domain write + outbox event share one transaction.
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { bootTestApp, ORG_A, TestApp } from './helpers';

describe('GATE: transactional outbox', () => {
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

  it('a committed write leaves exactly one unpublished outbox event', async () => {
    const res = await t.http
      .post('/api/_baseline/entries')
      .set('Authorization', `Bearer ${t.tokenFor(ORG_A, ['config.write'])}`)
      .set('Idempotency-Key', `outbox-${randomUUID()}`)
      .send({ key: `outbox.${randomUUID()}`, value: true });
    expect(res.status).toBe(201);

    const events = await pool.query(
      `SELECT type, aggregate_id FROM core.outbox_events
       WHERE aggregate_id = $1 AND type = 'baseline.entry.created.v1'`,
      [res.body.id]
    );
    expect(events.rowCount).toBe(1);
  });

  it('replayed requests emit no extra outbox events', async () => {
    const key = `outbox-${randomUUID()}`;
    const body = { key: `outbox.${randomUUID()}`, value: 2 };
    const auth = `Bearer ${t.tokenFor(ORG_A, ['config.write'])}`;
    const first = await t.http.post('/api/_baseline/entries').set('Authorization', auth).set('Idempotency-Key', key).send(body);
    await t.http.post('/api/_baseline/entries').set('Authorization', auth).set('Idempotency-Key', key).send(body);
    const events = await pool.query('SELECT id FROM core.outbox_events WHERE aggregate_id = $1', [first.body.id]);
    expect(events.rowCount).toBe(1);
  });
});
