// Public contract surface of the IdentityParty bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface OrgPublicProfile {
  orgId: string; name: string; ref: string; type: string; kybStatus: string;
}

export interface IdentityPartyService {
  contextKey(): 'identity-party';
  orgExists(orgId: string): Promise<boolean>;
  userExists(userId: string): Promise<boolean>;
  // Managed sourcing filter: subset of orgIds that are ACTIVE (optionally by type).
  filterActiveOrgs(orgIds: string[], supplierSideOnly?: boolean): Promise<string[]>;
  // ADR-004: true when the org has an open payout-freezing bank change.
  hasPayoutFreeze(orgId: string): Promise<boolean>;
  // B3/Phase 3: public-safe org profile for commercial surfaces (offers, evidence).
  getOrgPublicProfiles(orgIds: string[]): Promise<OrgPublicProfile[]>;
}

export const IdentityParty_SERVICE = 'IdentityParty_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type IdentityPartyEvent =
  | { v: 1; type: 'party.org.created'; orgId: string; ref: string; category: string; at: string }
  | { v: 1; type: 'party.user.registered'; userId: string; at: string }
  | { v: 1; type: 'party.kyb.updated'; orgId: string; toStatus: string; at: string }
  | { v: 1; type: 'party.bank.change.requested'; orgId: string; requestId: string; at: string };
