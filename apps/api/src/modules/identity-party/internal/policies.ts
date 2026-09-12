import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContextData } from '../../../common/request-context';

export const SUPPLIER_SIDE_CATEGORIES = new Set([
  'GROWER', 'GROWER_GROUP', 'IMPORTER', 'AGGREGATION_HUB',
  'WHOLESALER', 'QC_PARTNER', 'LOGISTICS_PROVIDER', 'COLD_CHAIN_PARTNER'
]);
export const GATED_CATEGORIES = new Set(['EXPORTER', 'GOVERNMENT']);
export const PLATFORM_CATEGORIES = new Set(['PLATFORM_OPS', 'FINANCE', 'ADMIN']);
export const ORG_ASSIGNABLE_ROLES = new Set(['ORG_ADMIN', 'MEMBER']);
export const PLATFORM_PRIVILEGED_ROLES = new Set(['PLATFORM_ADMIN', 'FINANCE_OPS', 'SUPPORT_AGENT', 'KYB_REVIEWER']);

// Object-level authz: org-scoped routes require the caller's resolved org context to match.
// Cross-org existence is never revealed — 404, not 403 (IDOR protection).
export function assertOrgAccess(ctx: RequestContextData, orgId: string): void {
  if (ctx.orgId === orgId) {
    return;
  }
  throw new ApiException(404, 'NOT_FOUND', 'Organization not found');
}

// For masked operational reads (e.g. finance reviewing bank change requests):
// org members or platform privileged roles only.
export function assertOrgAccessOrPlatform(ctx: RequestContextData, orgId: string): void {
  if (ctx.orgId === orgId || isPlatformPrivileged(ctx)) {
    return;
  }
  throw new ApiException(404, 'NOT_FOUND', 'Organization not found');
}

export function assertSupplierSide(ctx: RequestContextData): void {
  if (!ctx.orgType || !SUPPLIER_SIDE_CATEGORIES.has(ctx.orgType)) {
    throw new ApiException(403, 'FORBIDDEN', 'Action is restricted to supplier-side organizations', {
      code_detail: 'SUPPLIER_ONLY'
    });
  }
}

export function isPlatformPrivileged(ctx: RequestContextData): boolean {
  return ctx.roles.some((r) => PLATFORM_PRIVILEGED_ROLES.has(r));
}

export function maskAccountNumber(value: string): string {
  return `****${value.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}
