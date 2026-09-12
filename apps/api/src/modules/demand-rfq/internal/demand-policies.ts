import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContextData } from '../../../common/request-context';

// Requirement lifecycle (Master v2.0 external states; internal transitions only).
export const REQUIREMENT_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['SOURCING', 'CANCELLED'],
  SOURCING: ['QUOTING', 'CANCELLED'],
  QUOTING: ['CLARIFICATION', 'EVALUATION', 'CANCELLED'],
  CLARIFICATION: ['QUOTING', 'EVALUATION', 'CANCELLED'],
  EVALUATION: ['AWARDED', 'PARTIALLY_AWARDED', 'CANCELLED'],
  PARTIALLY_AWARDED: ['AWARDED', 'CANCELLED', 'CLOSED'],
  AWARDED: ['CONVERTED', 'CLOSED', 'CANCELLED'],
  CONVERTED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: []
};

export function assertRequirementTransition(from: string, to: string): void {
  if (!(REQUIREMENT_TRANSITIONS[from] ?? []).includes(to)) {
    throw new ApiException(409, 'CONFLICT', `Requirement cannot transition ${from} -> ${to}`, {
      code_detail: 'ILLEGAL_TRANSITION'
    });
  }
}

export const RFQ_OPEN_STATUSES = ['PUBLISHED'];

// Tenant-scoped object access: cross-org existence is never revealed.
export function assertBuyerAccess(ctx: RequestContextData, orgId: string): void {
  if (ctx.orgId !== orgId) {
    throw new ApiException(404, 'NOT_FOUND', 'Not found');
  }
}

export function isOps(ctx: RequestContextData): boolean {
  return ctx.permissions.includes('procurement.manage');
}

// Ops may read across tenants for desk work; buyers are tenant-scoped.
export function assertBuyerOrOps(ctx: RequestContextData, orgId: string): void {
  if (ctx.orgId !== orgId && !isOps(ctx)) {
    throw new ApiException(404, 'NOT_FOUND', 'Not found');
  }
}

export const IDEMPOTENCY_HEADER = 'idempotency-key';
