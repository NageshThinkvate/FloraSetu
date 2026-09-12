import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../request-context';
import { DevTokenVerifier } from './token-verifier';

export class AuthMiddleware {
  private readonly verifier: DevTokenVerifier;

  constructor(secret: string) {
    this.verifier = new DevTokenVerifier(secret);
  }

  use = (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.header('authorization');
    if (header?.startsWith('Bearer ')) {
      const claims = this.verifier.verify(header.slice(7));
      if (claims) {
        const ctx = RequestContext.get();
        ctx.actorType = 'user';
        ctx.userId = claims.sub;
        // Dev/test tokens may carry full context; real login tokens carry sub only —
        // org context is then resolved from DB by the RBAC guard (x-org-id header).
        if (claims.orgId) {
          ctx.orgId = claims.orgId;
          ctx.roles = claims.roles ?? [];
          ctx.permissions = claims.permissions ?? [];
        }
      }
    }
    next();
  };
}
