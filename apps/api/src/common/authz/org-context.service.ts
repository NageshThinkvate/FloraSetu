import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ApiException } from '../errors/error-envelope';
import { RequestContextData } from '../request-context';

// Resolves a user's context inside an org from the DB (multi-org membership model):
// membership must be ACTIVE; roles + permissions are loaded per request (least privilege).
@Injectable()
export class OrgContextService {
  constructor(private readonly db: DatabaseService) {}

  async resolve(ctx: RequestContextData, orgId: string): Promise<void> {
    const membership = await this.db.query(
      `SELECT m.status AS membership_status, o.status AS org_status, o.type AS org_type
       FROM identity.org_memberships m
       JOIN identity.organizations o ON o.id = m.org_id
       WHERE m.org_id = $1 AND m.user_id = $2 AND o.deleted_at IS NULL`,
      [orgId, ctx.userId]
    );
    const row = membership.rows[0];
    if (!row || row.membership_status !== 'ACTIVE') {
      throw new ApiException(403, 'FORBIDDEN', 'Not an active member of this organization');
    }
    const restriction = await this.db.query(
      `SELECT 1 FROM identity.org_restrictions WHERE org_id = $1 AND lifted_at IS NULL LIMIT 1`,
      [orgId]
    );
    const grants = await this.db.query(
      `SELECT array_agg(DISTINCT pe.code) AS perms, array_agg(DISTINCT ro.name) AS role_names
       FROM identity.user_roles ur
       JOIN identity.roles ro ON ro.id = ur.role_id
       LEFT JOIN identity.role_permissions rp ON rp.role_id = ro.id
       LEFT JOIN identity.permissions pe ON pe.id = rp.permission_id
       WHERE ur.user_id = $1 AND ur.org_id = $2`,
      [ctx.userId, orgId]
    );
    ctx.orgId = orgId;
    ctx.orgType = row.org_type;
    ctx.orgStatus = restriction.rowCount && restriction.rowCount > 0 ? 'SUSPENDED' : row.org_status;
    ctx.permissions = (grants.rows[0]?.perms ?? []).filter(Boolean);
    ctx.roles = (grants.rows[0]?.role_names ?? []).filter(Boolean);
  }
}
