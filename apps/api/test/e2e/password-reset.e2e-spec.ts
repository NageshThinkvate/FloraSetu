// Public-site/auth polish gate: password-recovery security contract (owner directive).
// AUTH-P5 neutral anti-enumeration · AUTH-P7 expired token · AUTH-P8 single-use ·
// AUTH-P10 server-side policy · AUTH-P13 rate limiting · session revocation on reset.
import { Pool } from 'pg';
import { createHash, randomUUID } from 'crypto';
import { bootTestApp, TestApp } from './helpers';

const password = 'Sup3rSecret99';
const RUN = randomUUID().slice(0, 8);

describe('GATE: password recovery (public-site/auth polish)', () => {
  let t: TestApp;
  let pool: Pool;
  const email = `p8reset.${RUN}@test.florasetu.local`;
  let userId: string;

  beforeAll(async () => {
    t = await bootTestApp();
    pool = new Pool({ connectionString: t.config.databaseUrl });
    const reg = await t.http.post('/api/auth/register').send({ email, password, displayName: 'Reset User' });
    expect([200, 201]).toContain(reg.status);
    userId = reg.body.userId as string;
  }, 120000);

  afterAll(async () => {
    await pool?.end();
    await t?.app.close();
  });

  it('P5: known and unknown emails produce the same neutral response shape', async () => {
    const known = await t.http.post('/api/auth/forgot-password').send({ email });
    const unknown = await t.http.post('/api/auth/forgot-password').send({ email: `nobody.${RUN}@test.florasetu.local` });
    expect(known.status).toBe(201);
    expect(unknown.status).toBe(201);
    expect(known.body.ok).toBe(true);
    expect(unknown.body.ok).toBe(true);
    // Unknown accounts never receive a token; neither response reveals existence via status or ok flag.
    const tokens = await pool.query(`SELECT count(*)::int AS n FROM identity.password_reset_tokens`);
    expect(tokens.rows[0].n).toBe(1);
  });

  it('P6: malformed email is handled safely (no 500, no token)', async () => {
    const res = await t.http.post('/api/auth/forgot-password').send({ email: 'not-an-email' });
    expect([200, 201, 400]).toContain(res.status);
    const tokens = await pool.query(`SELECT count(*)::int AS n FROM identity.password_reset_tokens`);
    expect(tokens.rows[0].n).toBe(1);
  });

  it('full flow: token resets password, is single-use, sessions revoked, policy enforced', async () => {
    const row = await pool.query<{ token_hash: string }>(
      `SELECT token_hash FROM identity.password_reset_tokens ORDER BY created_at DESC LIMIT 1`);
    // Recover the raw token via the non-production dev channel (no email provider in pilot).
    const req = await t.http.post('/api/auth/forgot-password').send({ email });
    const token = req.body.devResetToken as string;
    expect(typeof token).toBe('string');
    expect(createHash('sha256').update(token).digest('hex')).not.toBe(row.rows[0].token_hash); // latest token is a new row

    // P10: server-side policy — weak password rejected.
    const weak = await t.http.post('/api/auth/reset-password').send({ token, password: 'short' });
    expect(weak.status).toBe(400);

    // Issue a session first so we can prove revocation.
    const login = await t.http.post('/api/auth/login').send({ email, password });
    expect([200, 201]).toContain(login.status);
    const refreshToken = login.body.refreshToken as string;

    const reset = await t.http.post('/api/auth/reset-password').send({ token, password: 'NewPassw0rd2026' });
    expect(reset.status).toBe(201);

    // P8: the same token cannot be reused.
    const reuse = await t.http.post('/api/auth/reset-password').send({ token, password: 'An0therPass2026' });
    expect(reuse.status).toBe(400);

    // Sessions revoked: the pre-reset refresh token no longer works.
    const refresh = await t.http.post('/api/auth/refresh').send({ refreshToken });
    expect(refresh.status).toBe(401);

    // Old password fails; new password works.
    expect((await t.http.post('/api/auth/login').send({ email, password })).status).toBe(401);
    const relogin = await t.http.post('/api/auth/login').send({ email, password: 'NewPassw0rd2026' });
    expect([200, 201]).toContain(relogin.status);
  });

  it('P7: expired/invalid tokens cannot change a password', async () => {
    const invalid = await t.http.post('/api/auth/reset-password')
      .send({ token: randomUUID().replace(/-/g, ''), password: 'ValidPass2026x' });
    expect(invalid.status).toBe(400);
    const req = await t.http.post('/api/auth/forgot-password').send({ email });
    const token = req.body.devResetToken as string;
    await pool.query(`UPDATE identity.password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL`);
    const expired = await t.http.post('/api/auth/reset-password')
      .send({ token, password: 'ValidPass2026x' });
    expect(expired.status).toBe(400);
  });

  it('P13: reset requests are rate-limited per email', async () => {
    const target = `p8flood.${RUN}@test.florasetu.local`;
    let last = 0;
    for (let i = 0; i < 12; i += 1) {
      const res = await t.http.post('/api/auth/forgot-password').send({ email: target });
      last = res.status;
      if (last === 429) {
        break;
      }
    }
    expect(last).toBe(429);
  });

  it('P12: the raw token is never written to the audit stream', async () => {
    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM core.audit_events
       WHERE action LIKE 'auth.password_reset.%' AND (after::text LIKE '%devResetToken%' OR after::text LIKE '%token_hash%')`);
    expect(audit.rows[0].n).toBe(0);
  });
});
