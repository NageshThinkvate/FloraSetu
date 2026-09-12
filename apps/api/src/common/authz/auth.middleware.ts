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
        ctx.orgId = claims.orgId;
        ctx.roles = claims.roles;
        ctx.permissions = claims.permissions;
      }
    }
    next();
  };
}
