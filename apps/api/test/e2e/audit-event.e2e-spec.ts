// GATE REQ-AUD-01: mutation writes one immutable audit row carrying the trace id.
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { bootTestApp, ORG_A, USER_A, TestApp } from './helpers';

describe('GATE: audit event', () => {
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

  it('a baseline write produces exactly one audit row with actor + trace id', async () => {
    const traceId = `trace-${randomUUID()}`;
    const res = await t.http
      .post('/api/_baseline/entries')
      .set('Authorization', `Bearer ${t.tokenFor(ORG_A, ['config.write'])}`)
      .set('Idempotency-Key', `audit-${randomUUID()}`)
      .set('x-trace-id', traceId)
      .send({ key: `audit.${randomUUID()}`, value: 1 });
    expect(res.status).toBe(201);

    const rows = await pool.query(
      `SELECT actor_user_id, org_id, action, object_id, trace_id FROM core.audit_events
       WHERE object_id = $1 AND action = 'config.entry.create'`,
      [res.body.id]
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({
      actor_user_id: USER_A,
      org_id: ORG_A,
      object_id: res.body.id,
      trace_id: traceId
    });
  });

  it('audit rows are immutable (trigger rejects UPDATE)', async () => {
    await expect(pool.query(`UPDATE core.audit_events SET action = 'tampered' WHERE true`)).rejects.toThrow(
      /immutable record/
    );
  });
});
