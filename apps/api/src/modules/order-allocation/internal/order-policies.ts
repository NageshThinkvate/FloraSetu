import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContextData } from '../../../common/request-context';

// Master v2.0 §3 order state machine.
export const ORDER_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PENDING_CONFIRMATION', 'CANCELLED'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['ALLOCATING', 'CANCELLED'],
  ALLOCATING: ['SUPPLY_CONFIRMED', 'CANCELLED'],
  SUPPLY_CONFIRMED: ['QC_PACK', 'CANCELLED'],
  QC_PACK: ['READY_FOR_DISPATCH', 'CANCELLED'],
  READY_FOR_DISPATCH: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED'],
  DELIVERED: ['ACCEPTANCE_PENDING'],
  ACCEPTANCE_PENDING: ['ACCEPTED', 'CLAIM_OPEN'],
  ACCEPTED: ['SETTLED', 'CLAIM_OPEN', 'CLOSED'],
  CLAIM_OPEN: ['ACCEPTED', 'SETTLED', 'CLOSED'],
  SETTLED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: []
};

export function assertOrderTransition(from: string, to: string): void {
  if (!(ORDER_TRANSITIONS[from] ?? []).includes(to)) {
    throw new ApiException(409, 'CONFLICT', `Order cannot transition ${from} -> ${to}`, {
      code_detail: 'ILLEGAL_TRANSITION'
    });
  }
}

// Supplier allocation (supplier obligation) lifecycle.
export const ALLOCATION_TRANSITIONS: Record<string, string[]> = {
  PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_FULFILMENT', 'CANCELLED'],
  IN_FULFILMENT: ['QC_PACK', 'CANCELLED'],
  QC_PACK: ['READY_FOR_DISPATCH', 'CANCELLED'],
  READY_FOR_DISPATCH: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED'],
  DELIVERED: ['SETTLED'],
  SETTLED: [],
  CANCELLED: []
};

// Per-line fulfilment progression.
export const LINE_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['LOT_CONFIRMED', 'SHORT', 'CANCELLED'],
  LOT_CONFIRMED: ['ALLOCATED', 'SHORT', 'CANCELLED'],
  ALLOCATED: ['PACKED', 'CANCELLED'],
  PACKED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED'],
  DELIVERED: [],
  SHORT: ['LOT_CONFIRMED', 'CANCELLED'],
  CANCELLED: []
};

export function assertLineTransition(from: string, to: string): void {
  if (!(LINE_TRANSITIONS[from] ?? []).includes(to)) {
    throw new ApiException(409, 'CONFLICT', `Allocation line cannot transition ${from} -> ${to}`, {
      code_detail: 'ILLEGAL_TRANSITION'
    });
  }
}

// Platform-operations only. order.manage is held by ORG_ADMIN for an org's OWN orders
// and must never grant cross-org (buyer-slice) visibility — tenant isolation §4.
export function isOps(ctx: RequestContextData): boolean {
  return ctx.permissions.includes('procurement.manage');
}
