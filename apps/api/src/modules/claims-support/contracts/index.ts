// Public contract surface of the ClaimsSupport bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface ClaimsSupportService {
  contextKey(): 'claims-support';
  hasOpenClaim(orderId: string): Promise<boolean>;
  pilotExceptions(): Promise<Record<string, unknown[]>>;
  // ADR-013 (Phase 6): staff claim search — reference-first, no raw UUID workflows.
  searchClaims(q: string): Promise<{ id: string; ref: string; orderId: string | null; status: string; category: string }[]>;
}

export const ClaimsSupport_SERVICE = 'ClaimsSupport_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type ClaimsSupportEvent =
  | { v: 1; type: 'claim.submitted'; claimId: string; orderId: string; category: string; at: string }
  | { v: 1; type: 'claim.resolved'; claimId: string; outcome: string; at: string };
