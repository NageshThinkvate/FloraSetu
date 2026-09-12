// Public contract surface of the IdentityParty bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface IdentityPartyService {
  contextKey(): 'identity-party';
}

export const IdentityParty_SERVICE = 'IdentityParty_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type IdentityPartyEvent =
  | { v: 1; type: 'identity-party.scaffold.ready'; at: string };
