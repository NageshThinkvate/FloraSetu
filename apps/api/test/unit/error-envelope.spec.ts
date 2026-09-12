// REQ-XCUT-01: standard error envelope.
import { ApiException, buildErrorEnvelope } from '../../src/common/errors/error-envelope';

describe('error envelope', () => {
  it('builds the standard shape with trace id', () => {
    const env = buildErrorEnvelope('NOT_FOUND', 'missing', 'trace-123', { id: 'x' });
    expect(env).toEqual({
      error: { code: 'NOT_FOUND', message: 'missing', trace_id: 'trace-123', details: { id: 'x' } }
    });
  });

  it('omits details when absent', () => {
    const env = buildErrorEnvelope('INTERNAL_ERROR', 'boom', 't');
    expect(env.error).not.toHaveProperty('details');
  });

  it('ApiException carries status + code', () => {
    const ex = new ApiException(409, 'OPTIMISTIC_LOCK_CONFLICT', 'stale');
    expect(ex.status).toBe(409);
    expect(ex.code).toBe('OPTIMISTIC_LOCK_CONFLICT');
  });
});
