import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../request-context';

export const TRACE_HEADER = 'x-trace-id';

export class TraceMiddleware {
  use = (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header(TRACE_HEADER);
    const traceId = incoming && incoming.length <= 64 ? incoming : randomUUID();
    res.setHeader(TRACE_HEADER, traceId);
    RequestContext.run(
      { traceId, actorType: 'anonymous', roles: [], permissions: [] },
      () => next()
    );
  };
}
