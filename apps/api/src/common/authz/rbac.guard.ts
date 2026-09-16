import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiException } from '../errors/error-envelope';
import { RequestContext } from '../request-context';
import { OrgContextService } from './org-context.service';

export const PERMISSIONS_KEY = 'required_permissions';
export const RequirePermission = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

// Privileges a suspended/restricted org loses; read permissions stay available.
export const TRANSACTIONAL_PERMISSIONS = new Set([
  'org.write', 'branch.write', 'contact.write', 'member.invite',
  'role.manage', 'kyb.submit', 'bank.write', 'config.write',
  'event.write', 'demand.write', 'demand.submit', 'rfq.publish',
  'quote.submit', 'award.create',
  // Build 4 pilot fulfilment writes
  'order.manage', 'inventory.reserve', 'inventory.allocate', 'lot.write',
  'qc.inspect', 'pack.manage', 'dispatch.manage', 'delivery.accept',
  'payment.record', 'payment.verify', 'settlement.record', 'settlement.verify',
  'claim.create', 'claim.manage',
  // ADR-012 (Phase 5): partner logistics execution privileges
  'logistics.execute', 'logistics.assign_driver'
]);

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly orgContext: OrgContextService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    const ctx = RequestContext.get();
    if (ctx.actorType !== 'user') {
      throw new ApiException(401, 'UNAUTHENTICATED', 'Authentication required');
    }

    // Real login tokens carry only `sub`; org context is resolved from the DB
    // using the X-Org-Id header. Dev/test tokens may carry full claims already.
    if (!ctx.orgId) {
      const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
      const orgHeader = req.headers['x-org-id'];
      if (orgHeader) {
        await this.orgContext.resolve(ctx, orgHeader);
      }
    }

    if (!required || required.length === 0) {
      return true;
    }
    const missing = required.filter((p) => !ctx.permissions.includes(p));
    if (missing.length > 0) {
      throw new ApiException(403, 'FORBIDDEN', 'Missing required permission', { missing });
    }
    if (ctx.orgStatus && ctx.orgStatus !== 'ACTIVE' && required.some((p) => TRANSACTIONAL_PERMISSIONS.has(p))) {
      throw new ApiException(403, 'ORG_SUSPENDED', 'Organization is suspended; transactional privileges revoked', {
        orgStatus: ctx.orgStatus
      });
    }
    return true;
  }
}
