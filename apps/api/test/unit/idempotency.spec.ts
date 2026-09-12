// REQ-XCUT-05: idempotency claim logic (unit-level, mocked client; e2e covers real DB).
import { claimIdempotencyKey, hashRequest } from '../../src/common/idempotency/idempotency.service';
import { ApiException } from '../../src/common/errors/error-envelope';

const clientFor = (insertCount: number, existing?: Record<string, unknown>) => ({
  query: jest
    .fn()
    .mockResolvedValueOnce({ rowCount: insertCount, rows: [] })
    .mockResolvedValueOnce({ rows: existing ? [existing] : [] })
});

describe('idempotency claim', () => {
  it('claims a fresh key', async () => {
    const client = clientFor(1);
    const res = await claimIdempotencyKey(client as never, 'o', 'ep', 'k', 'h');
    expect(res.state).toBe('claimed');
  });

  it('replays a completed key with identical payload', async () => {
    const client = clientFor(0, {
      request_hash: 'h', state: 'COMPLETED', response_status: 201, response_body: { id: 'x' }
    });
    const res = await claimIdempotencyKey(client as never, 'o', 'ep', 'k', 'h');
    expect(res).toEqual({ state: 'replay', responseStatus: 201, responseBody: { id: 'x' } });
  });

  it('rejects key reuse with a different payload (409)', async () => {
    const client = clientFor(0, { request_hash: 'other', state: 'COMPLETED' });
    await expect(claimIdempotencyKey(client as never, 'o', 'ep', 'k', 'h')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED'
    });
  });

  it('rejects while another request with the key is in progress (409)', async () => {
    const client = clientFor(0, { request_hash: 'h', state: 'IN_PROGRESS' });
    await expect(claimIdempotencyKey(client as never, 'o', 'ep', 'k', 'h')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_IN_PROGRESS'
    } as Partial<ApiException>);
  });

  it('hashes bodies deterministically', () => {
    expect(hashRequest({ a: 1 })).toBe(hashRequest({ a: 1 }));
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
  });
});
