// Public contract surface of the QualityTraceability bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).
import { PoolClient } from 'pg';

export interface InspectionSnapshot {
  id: string;
  lotId: string;
  status: string;
  supplierOrgId: string | null;
  inspectorOrgId: string | null;
  acceptedQty: number | null;
  rejectedQty: number | null;
  heldQty: number | null;
  gradeProfileVersionNo: number | null;
}

export interface CustodyInput {
  lotId: string | null;
  orderId?: string | null;
  shipmentId?: string | null;
  fromOrgId: string | null;
  toOrgId: string | null;
  eventType: string;
  actorUserId?: string | null;
  locationText?: string | null;
  conditionNote?: string | null;
  temperatureC?: number | null;
  mediaObjectId?: string | null;
}

export interface QualityTraceabilityService {
  contextKey(): 'quality-traceability';
  getInspectionSnapshot(inspectionId: string): Promise<InspectionSnapshot | null>;
  // Append-only custody trail (§16) — DB rules make rows immutable.
  // Optional tx joins the caller's transaction (atomic fulfilment chains).
  recordCustody(input: CustodyInput, tx?: PoolClient): Promise<void>;
  pilotExceptions(): Promise<Record<string, unknown[]>>;
}

export const QualityTraceability_SERVICE = 'QualityTraceability_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type QualityTraceabilityEvent =
  | { v: 1; type: 'qc.completed'; inspectionId: string; lotId: string; accepted: number; rejected: number; held: number; at: string }
  | { v: 1; type: 'custody.recorded'; lotId: string | null; eventType: string; at: string };
