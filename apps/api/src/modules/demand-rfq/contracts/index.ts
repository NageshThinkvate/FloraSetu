// Public contract surface of the DemandRfq bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface DemandRfqService {
  contextKey(): 'demand-rfq';
  requirementExists(requirementId: string): Promise<boolean>;
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
