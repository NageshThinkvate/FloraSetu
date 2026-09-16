// Public contract surface of the OrderAllocation bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

import { PoolClient } from 'pg';

export interface OrderSnapshot {
  id: string;
  ref: string;
  status: string;
  buyerOrgId: string;
  awardId: string | null;
  requirementId: string | null;
  deliveryDestination: string | null;
  supplierOrgIds: string[];
  acceptedQty: number | null;
  disputedQty: number | null;
}

export interface OrderAllocationService {
  contextKey(): 'order-allocation';
  getOrderSnapshot(orderId: string): Promise<OrderSnapshot | null>;
  orderExistsForAward(awardId: string): Promise<boolean>;
  convertedAwardIds(): Promise<string[]>;
  // Buyer access proof for supplier lot media: true when the buyer's order is
  // (part-)fulfilled from this lot.
  buyerHasLotAllocation(buyerOrgId: string, lotId: string): Promise<boolean>;
  // State-machine entry points for other contexts (each validates the transition).
  markDispatched(orderId: string, actorUserId?: string, tx?: PoolClient): Promise<void>;
  markDelivered(orderId: string, actorUserId?: string, tx?: PoolClient): Promise<void>;
  markClaimOpened(orderId: string, actorUserId?: string): Promise<void>;
  markSettled(orderId: string, actorUserId?: string): Promise<void>;
  // Fulfilment line state updates from QC/pack/dispatch flows.
  applyLineFulfilment(supplierAllocationLineId: string, to: string, actorUserId?: string, tx?: PoolClient): Promise<void>;
  getAllocationLineState(supplierAllocationLineId: string): Promise<{
    id: string; orderId: string; allocationId: string; supplierOrgId: string;
    awardedQty: number; uomId: string; fulfilmentStatus: string; allocatedQty: number; packedQty: number;
  } | null>;
  pilotExceptions(): Promise<Record<string, unknown[]>>;
  // ADR-013 (Phase 6): staff control-tower monitor — cross-org read composition only;
  // never a mutation surface. Source state stays authoritative here.
  opsMonitor(): Promise<OpsOrderRow[]>;
  searchOrders(q: string): Promise<OpsOrderRow[]>;
}

export interface OpsOrderRow {
  id: string; ref: string; status: string; buyerOrgId: string;
  deliveryDestination: string | null; createdAt: string; updatedAt: string;
  acceptedQty: number | null; disputedQty: number | null; supplierOrgIds: string[];
}

export const OrderAllocation_SERVICE = 'OrderAllocation_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type OrderAllocationEvent =
  | { v: 1; type: 'order.created'; orderId: string; awardId: string; buyerOrgId: string; at: string }
  | { v: 1; type: 'order.transition'; orderId: string; from: string; to: string; at: string }
  | { v: 1; type: 'order.allocation.confirmed'; allocationId: string; supplierOrgId: string; at: string };
