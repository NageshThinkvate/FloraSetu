// Public contract surface of the IdentityParty bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface OrgPublicProfile {
  orgId: string; name: string; ref: string; type: string; kybStatus: string;
}

// ADR-012 (Phase 5): same-org member summary for partner-side driver assignment.
export interface OrgMemberSummary {
  userId: string; ref: string; displayName: string; roles: string[];
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
  // ADR-012: true only when the user is an ACTIVE member of the org AND the user account is ACTIVE.
  isActiveMember(orgId: string, userId: string): Promise<boolean>;
  // ADR-012: ACTIVE members of one org (driver picker). Never cross-org.
  listActiveMembers(orgId: string): Promise<OrgMemberSummary[]>;
  // ADR-012: display names for execution timeline / assignment history actors.
  getUserDisplayNames(userIds: string[]): Promise<{ userId: string; displayName: string }[]>;
}

export const IdentityParty_SERVICE = 'IdentityParty_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type IdentityPartyEvent =
  | { v: 1; type: 'party.org.created'; orgId: string; ref: string; category: string; at: string }
  | { v: 1; type: 'party.user.registered'; userId: string; at: string }
  | { v: 1; type: 'party.kyb.updated'; orgId: string; toStatus: string; at: string }
  | { v: 1; type: 'party.bank.change.requested'; orgId: string; requestId: string; at: string };
