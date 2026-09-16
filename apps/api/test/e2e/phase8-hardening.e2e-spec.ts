// PHASE 8 GATE: hardening — upload security (§32), security headers (§33),
// API error contract (§34). Feature freeze: no new business behavior here.
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { bootTestApp, TestApp } from './helpers';

const password = 'Sup3rSecret99';
const RUN = randomUUID().slice(0, 8);
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PDF_B64 = Buffer.from('%PDF-1.4 minimal').toString('base64');
const HTML_B64 = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');

describe('GATE Phase 8: hardening (upload security, headers, error contract)', () => {
  let t: TestApp;
  let pool: Pool;
  let buyerToken: string;
  let buyerOrg: string;

  beforeAll(async () => {
    t = await bootTestApp();
    pool = new Pool({ connectionString: t.config.databaseUrl });
    const reg = await t.http.post('/api/auth/register')
      .send({ email: `p8.${RUN}@test.florasetu.local`, password, displayName: 'P8 Buyer' });
    buyerToken = reg.body.accessToken as string;
    const org = await t.http.post('/api/orgs').set('Authorization', `Bearer ${buyerToken}`)
      .send({ name: `P8 Buyer ${RUN}`, category: 'BUYER' });
    buyerOrg = org.body.id as string;
  }, 120000);

  afterAll(async () => {
    await pool?.end();
    await t?.app.close();
  });

  const asBuyer = () => ({ Authorization: `Bearer ${buyerToken}`, 'x-org-id': buyerOrg });

  // ---------- §32: upload security ----------

  it('U1: scriptable/executable content types are rejected', async () => {
    const html = await t.http.post('/api/media').set(asBuyer())
      .send({ contentType: 'text/html', dataBase64: HTML_B64, bucket: 'pilot' });
    expect(html.status).toBe(400);
    const exe = await t.http.post('/api/media').set(asBuyer())
      .send({ contentType: 'application/x-msdownload', dataBase64: PNG_B64, bucket: 'pilot' });
    expect(exe.status).toBe(400);
    const svg = await t.http.post('/api/media').set(asBuyer())
      .send({ contentType: 'image/svg+xml', dataBase64: HTML_B64, bucket: 'pilot' });
    expect(svg.status).toBe(400);
  });

  it('U2: declared Content-Type must match the content signature (magic bytes)', async () => {
    // PNG bytes declared as JPEG → mismatch rejected.
    const mismatch = await t.http.post('/api/media').set(asBuyer())
      .send({ contentType: 'image/jpeg', dataBase64: PNG_B64, bucket: 'pilot' });
    expect(mismatch.status).toBe(400);
    // HTML bytes declared as PDF → rejected.
    const fakePdf = await t.http.post('/api/media').set(asBuyer())
      .send({ contentType: 'application/pdf', dataBase64: HTML_B64, bucket: 'pilot' });
    expect(fakePdf.status).toBe(400);
  });

  it('U3: allowlisted types with valid signatures upload successfully', async () => {
    const png = await t.http.post('/api/media').set(asBuyer())
      .send({ contentType: 'image/png', dataBase64: PNG_B64, bucket: 'pilot' });
    expect(png.status).toBe(201);
    const pdf = await t.http.post('/api/media').set(asBuyer())
      .send({ contentType: 'application/pdf', dataBase64: PDF_B64, bucket: 'kyb' });
    expect(pdf.status).toBe(201);
  });

  it('U4: oversized uploads are rejected', async () => {
    const big = Buffer.alloc(16 * 1024 * 1024, 1);
    big.write('%PDF');
    const res = await t.http.post('/api/media').set(asBuyer())
      .send({ contentType: 'application/pdf', dataBase64: big.toString('base64'), bucket: 'pilot' });
    expect(res.status).toBe(400);
  });

  it('U5: private media is never served without a valid signature', async () => {
    const up = await t.http.post('/api/media').set(asBuyer())
      .send({ contentType: 'image/png', dataBase64: PNG_B64, bucket: 'kyb' });
    expect(up.status).toBe(201);
    const key = up.body.objectKey as string;
    const unsigned = await t.http.get(`/api/media/raw/${key}`);
    expect(unsigned.status).toBe(404);
    const badSig = await t.http.get(`/api/media/raw/${key}?exp=9999999999&sig=deadbeef`);
    expect(badSig.status).toBe(404);
  });

  // ---------- §33: security headers ----------

  it('H1: baseline security headers are present on API responses', async () => {
    const res = await t.http.get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['content-security-policy-report-only']).toContain("default-src 'self'");
  });

  // ---------- §34: API error contract ----------

  it('H2: error envelope is consistent across authn/authz/validation/not-found', async () => {
    const unauthenticated = await t.http.get('/api/admin/orgs');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe('UNAUTHENTICATED');

    const forbidden = await t.http.get('/api/admin/orgs').set(asBuyer());
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    expect(typeof forbidden.body.error.message).toBe('string');

    const notFound = await t.http.get(`/api/claims/${randomUUID()}`).set(asBuyer());
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.code).toBe('NOT_FOUND');

    const invalid = await t.http.post('/api/media').set(asBuyer()).send({ nope: true });
    expect(invalid.status).toBe(400);
    expect(['VALIDATION_FAILED', 'BAD_REQUEST']).toContain(invalid.body.error.code);
    // Never leak internals.
    for (const body of [unauthenticated.body, forbidden.body, notFound.body, invalid.body]) {
      expect(JSON.stringify(body)).not.toMatch(/sql|stack|password|secret|token/i);
    }
  });
});
