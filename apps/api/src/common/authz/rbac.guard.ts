import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../errors/error-envelope';
import { RequestContext } from '../request-context';

export const PERMISSIONS_KEY = 'required_permissions';
export const RequirePermission = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    const ctx = RequestContext.get();
    if (ctx.actorType !== 'user') {
      throw new ApiException(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    if (!required || required.length === 0) {
      return true;
    }
    const missing = required.filter((p) => !ctx.permissions.includes(p));
    if (missing.length > 0) {
      throw new ApiException(403, 'FORBIDDEN', 'Missing required permission', { missing });
    }
    return true;
  }
}
