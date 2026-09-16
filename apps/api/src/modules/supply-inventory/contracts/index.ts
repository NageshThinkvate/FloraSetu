// Public contract surface of the SupplyInventory bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).
import { PoolClient } from 'pg';

export interface ReserveInput {
  lotId: string;
  qty: number;
  uomId: string;
  orderId: string;
  orderOrgId: string;
  ownerRef: string;
  supplierAllocationLineId: string;
  supplierOrgId: string;
  createdBy: string | null;
}

export interface LotSnapshot {
  id: string;
  ref: string | null;
  orgId: string;
  status: string;
  commodityId: string | null;
  varietyId: string | null;
  uomId: string | null;
  declaredQty: number | null;
  availableQty: number;
  allocatedQty: number;
  qcAcceptedQty: number | null;
  gradeProfileId: string | null;
  originType: string | null;
}

export interface LotEvidenceMedia {
  id: string; purpose: string; contentType: string; capturedAt: string; url: string;
}

// ADR-011 evidence pack: buyer-facing supplier declaration + actual-lot/packing media.
export interface LotEvidence {
  id: string; ref: string; status: string; qualityBasis: string;
  declaredQty: number | null; uomId: string | null;
  declaredStemLengthCm: number | null; bloomStage: string | null; batchRef: string | null;
  declarationNotes: string | null; declaredAt: string | null;
  harvestAt: string | null; receivedAt: string | null; originType: string | null;
  media: LotEvidenceMedia[];
}

export interface SupplyInventoryService {
  contextKey(): 'supply-inventory';
  getLotSnapshot(lotId: string): Promise<LotSnapshot | null>;
  // ADR-001: reserve + allocate inside the caller's transaction (client) — never oversell.
  reserveAndAllocate(client: PoolClient, input: ReserveInput): Promise<{ reservationId: string }>;
  releaseForOrder(client: PoolClient, orderId: string, reason: string): Promise<void>;
  // QC outcome applies balances: accepted -> available; rejected never available (§11).
  applyQcResult(lotId: string, result: {
    accepted: number; rejected: number; held: number;
  }, actorUserId?: string): Promise<{ status: string }>;
  applyPacking(lotId: string, qty: number, actorUserId?: string, tx?: PoolClient): Promise<void>;
  applyDispatch(lotId: string, qty: number, actorUserId?: string, tx?: PoolClient): Promise<void>;
  applyDelivery(lotId: string, qty: number, actorUserId?: string, tx?: PoolClient): Promise<void>;
  // QC/inspection media attach (quality context writes through here — schema ownership).
  attachLotMedia(lotId: string, mediaObjectId: string, purpose: string, inspectionId: string | null, uploadedBy: string | undefined): Promise<void>;
  // QC queue: lots awaiting inspection (for the inspector worklist).
  listQcQueue(): Promise<LotSnapshot[]>;
  pilotExceptions(): Promise<Record<string, unknown[]>>;
  // ADR-011 evidence pack: declaration + actual-lot media with short-lived signed URLs.
  getLotEvidence(lotId: string): Promise<LotEvidence | null>;
}

export const SupplyInventory_SERVICE = 'SupplyInventory_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type SupplyInventoryEvent =
  | { v: 1; type: 'lot.created'; lotId: string; orgId: string; originType: string; at: string }
  | { v: 1; type: 'lot.qc_applied'; lotId: string; accepted: number; rejected: number; held: number; at: string }
  | { v: 1; type: 'lot.allocated'; lotId: string; orderId: string; qty: number; at: string };
