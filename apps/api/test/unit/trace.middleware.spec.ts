// REQ-XCUT-02: trace-ID middleware generates/propagates correlation ids.
import { TraceMiddleware, TRACE_HEADER } from '../../src/common/tracing/trace.middleware';
import { RequestContext } from '../../src/common/request-context';

function mockRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    }
  };
}

describe('trace middleware', () => {
  it('generates a trace id and exposes the context downstream', () => {
    const mw = new TraceMiddleware();
    const res = mockRes();
    let seen: string | undefined;
    mw.use({ header: () => undefined } as never, res as never, () => {
      seen = RequestContext.get().traceId;
    });
    expect(res.headers[TRACE_HEADER]).toBeDefined();
    expect(seen).toBe(res.headers[TRACE_HEADER]);
  });

  it('honours an incoming trace id', () => {
    const mw = new TraceMiddleware();
    const res = mockRes();
    mw.use({ header: (k: string) => (k === TRACE_HEADER ? 'incoming-1' : undefined) } as never, res as never, () => undefined);
    expect(res.headers[TRACE_HEADER]).toBe('incoming-1');
  });
});
