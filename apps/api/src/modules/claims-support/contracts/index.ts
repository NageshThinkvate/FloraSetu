// Public contract surface of the ClaimsSupport bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface ClaimsSupportService {
  contextKey(): 'claims-support';
  hasOpenClaim(orderId: string): Promise<boolean>;
  pilotExceptions(): Promise<Record<string, unknown[]>>;
}

export const ClaimsSupport_SERVICE = 'ClaimsSupport_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type ClaimsSupportEvent =
  | { v: 1; type: 'claim.submitted'; claimId: string; orderId: string; category: string; at: string }
  | { v: 1; type: 'claim.resolved'; claimId: string; outcome: string; at: string };
