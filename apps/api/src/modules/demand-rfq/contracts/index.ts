// Public contract surface of the DemandRfq bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface DemandRfqService {
  contextKey(): 'demand-rfq';
  requirementExists(requirementId: string): Promise<boolean>;
  // Build 4 conversion handoff: full committed snapshot of a FINAL award — order-allocation
  // must never reconstruct terms from mutable catalog data (§2).
  getAwardSnapshot(awardId: string): Promise<AwardSnapshot | null>;
  // Mark the requirement CONVERTED once its order exists (terminal fulfilment handoff).
  markRequirementConverted(requirementId: string, orderId: string): Promise<void>;
  // Control tower: FINAL awards awaiting conversion (§24 "award not converted" queue).
  listFinalAwards(): Promise<{ id: string; ref: string; buyerOrgId: string; createdAt: string }[]>;
}

export interface AwardSnapshotLine {
  awardLineId: string;
  requirementLineId: string;
  quotationVersionId: string;
  supplierOrgId: string;
  awardedQty: number;
  uomId: string;
  unitPriceMinor: number;
  currency: string;
  acceptedSpec: Record<string, unknown> | null;
  hasDeviation: boolean;
}

export interface AwardSnapshot {
  awardId: string;
  ref: string;
  status: string;
  requirementId: string;
  requirementRef: string;
  eventId: string | null;
  rfqId: string;
  buyerOrgId: string;
  buyerConsent: Record<string, unknown> | null;
  conditions: string | null;
  deliveryDestination: string;
  deliveryRequirements: string | null;
  lines: AwardSnapshotLine[];
}

export const DemandRfq_SERVICE = 'DemandRfq_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type DemandRfqEvent =
  | { v: 1; type: 'demand.requirement.submitted'; requirementId: string; orgId: string; at: string }
  | { v: 1; type: 'demand.requirement.revised'; requirementId: string; versionNo: number; at: string }
  | { v: 1; type: 'rfq.published'; rfqId: string; requirementId: string; at: string }
  | { v: 1; type: 'rfq.revised'; rfqId: string; at: string }
  | { v: 1; type: 'rfq.invitation.sent'; rfqId: string; supplierOrgId: string; at: string }
  | { v: 1; type: 'rfq.clarification.posted'; rfqId: string; clarificationId: string; at: string }
  | { v: 1; type: 'quote.submitted'; quotationId: string; rfqId: string; supplierOrgId: string; at: string }
  | { v: 1; type: 'quote.revised'; quotationId: string; versionNo: number; at: string }
  | { v: 1; type: 'award.created'; awardId: string; rfqId: string; requirementId: string; at: string }
  | { v: 1; type: 'demand.cancelled'; entity: string; id: string; at: string };
