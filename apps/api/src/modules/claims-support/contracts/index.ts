// Public contract surface of the ClaimsSupport bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface ClaimsSupportService {
  contextKey(): 'claims-support';
}

export const ClaimsSupport_SERVICE = 'ClaimsSupport_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type ClaimsSupportEvent =
  | { v: 1; type: 'claims-support.scaffold.ready'; at: string };
