import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { IdentityPartyService, OrgMemberSummary, OrgPublicProfile } from '../contracts';

@Injectable()
export class IdentityPartyServiceImpl implements IdentityPartyService {
  constructor(private readonly db: DatabaseService) {}

  contextKey(): 'identity-party' {
    return 'identity-party';
  }

  async orgExists(orgId: string): Promise<boolean> {
    const r = await this.db.query('SELECT 1 FROM identity.organizations WHERE id = $1', [orgId]);
    return (r.rowCount ?? 0) > 0;
  }

  async userExists(userId: string): Promise<boolean> {
    const r = await this.db.query('SELECT 1 FROM identity.users WHERE id = $1', [userId]);
    return (r.rowCount ?? 0) > 0;
  }

  async filterActiveOrgs(orgIds: string[], supplierSideOnly = false): Promise<string[]> {
    if (orgIds.length === 0) {
      return [];
    }
    const r = await this.db.query<{ id: string }>(
      `SELECT id FROM identity.organizations
       WHERE id = ANY($1) AND status = 'ACTIVE' AND deleted_at IS NULL
         AND ($2 = false OR type IN ('GROWER','GROWER_GROUP','IMPORTER','AGGREGATION_HUB',
              'WHOLESALER','QC_PARTNER','LOGISTICS_PROVIDER','COLD_CHAIN_PARTNER'))`,
      [orgIds, supplierSideOnly]
    );
    return r.rows.map((row) => row.id);
  }

  // ADR-004: open bank change with payout_freeze blocks new settlement payouts.
  async hasPayoutFreeze(orgId: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM identity.bank_change_requests
       WHERE org_id = $1 AND payout_freeze = true
         AND status IN ('PENDING_REVERIFICATION','APPROVED_FIRST') LIMIT 1`,
      [orgId]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async getOrgPublicProfiles(orgIds: string[]): Promise<OrgPublicProfile[]> {
    if (orgIds.length === 0) {
      return [];
    }
    const r = await this.db.query<{ id: string; name: string; ref: string; type: string; kyb_status: string }>(
      `SELECT id, name, ref, type, kyb_status FROM identity.organizations
       WHERE id = ANY($1) AND deleted_at IS NULL`,
      [orgIds]
    );
    return r.rows.map((o) => ({ orgId: o.id, name: o.name, ref: o.ref, type: o.type, kybStatus: o.kyb_status }));
  }

  // ADR-013 (Phase 6): staff org search for the control tower (public-safe fields only).
  async searchOrgsByName(q: string): Promise<OrgPublicProfile[]> {
    const r = await this.db.query<{ id: string; name: string; ref: string; type: string; kyb_status: string }>(
      `SELECT id, name, ref, type, kyb_status FROM identity.organizations
       WHERE name ILIKE $1 OR ref ILIKE $1 ORDER BY name LIMIT 10`,
      [`%${q}%`]);
    return r.rows.map((o) => ({ orgId: o.id, name: o.name, ref: o.ref, type: o.type, kybStatus: o.kyb_status }));
  }

  // ADR-012: driver assignment eligibility — ACTIVE membership AND ACTIVE user account.
  async isActiveMember(orgId: string, userId: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM identity.org_memberships m
       JOIN identity.users u ON u.id = m.user_id
       WHERE m.org_id = $1 AND m.user_id = $2 AND m.status = 'ACTIVE' AND u.status = 'ACTIVE'`,
      [orgId, userId]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async listActiveMembers(orgId: string): Promise<OrgMemberSummary[]> {
    const r = await this.db.query<{ id: string; ref: string; display_name: string; roles: string[] }>(
      `SELECT u.id, u.ref, u.display_name,
              COALESCE(array_agg(DISTINCT ro.name) FILTER (WHERE ro.name IS NOT NULL), '{}') AS roles
       FROM identity.org_memberships m
       JOIN identity.users u ON u.id = m.user_id
       LEFT JOIN identity.user_roles ur ON ur.org_id = m.org_id AND ur.user_id = m.user_id
       LEFT JOIN identity.roles ro ON ro.id = ur.role_id
       WHERE m.org_id = $1 AND m.status = 'ACTIVE' AND u.status = 'ACTIVE'
       GROUP BY u.id, u.ref, u.display_name
       ORDER BY u.display_name`,
      [orgId]
    );
    return r.rows.map((m) => ({ userId: m.id, ref: m.ref, displayName: m.display_name, roles: m.roles }));
  }

  async getUserDisplayNames(userIds: string[]): Promise<{ userId: string; displayName: string }[]> {
    if (userIds.length === 0) {
      return [];
    }
    const r = await this.db.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM identity.users WHERE id = ANY($1)`,
      [userIds]
    );
    return r.rows.map((u) => ({ userId: u.id, displayName: u.display_name }));
  }
}
