import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';

const SUPPORT_GRANT_MINUTES = 30;

@Injectable()
export class AdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService
  ) {}

  // Platform-level list: masked, non-sensitive fields only. KYC/bank data is never included.
  async listOrgs(): Promise<{ items: unknown[] }> {
    const result = await this.db.query(
      `SELECT id, ref, name, type, status, kyb_status, created_at
       FROM identity.organizations WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`
    );
    return { items: result.rows };
  }

  // Privileged single-org read: PLATFORM_ADMIN, or SUPPORT_AGENT with an active audited grant.
  async getOrgPrivileged(orgId: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const viaGrant = !ctx.roles.includes('PLATFORM_ADMIN');
    if (viaGrant) {
      const grant = await this.db.query(
        `SELECT 1 FROM identity.support_access_grants
         WHERE support_user_id = $1 AND org_id = $2 AND expires_at > now()`,
        [ctx.userId, orgId]
      );
      if (grant.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Organization not found');
      }
    }
    const result = await this.db.query(
      `SELECT o.id, o.ref, o.name, o.type, o.status, o.kyb_status, o.created_at,
              (SELECT count(*)::int FROM identity.org_memberships m WHERE m.org_id = o.id) AS member_count
       FROM identity.organizations o WHERE o.id = $1 AND o.deleted_at IS NULL`,
      [orgId]
    );
    if (result.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Organization not found');
    }
    if (viaGrant) {
      await this.audit.recordSecurity('support.access.read', 'WARN', { orgId });
    }
    return result.rows[0];
  }

  async restrict(orgId: string, reason: string): Promise<{ restrictionId: string }> {
    const ctx = RequestContext.get();
    const restrictionId = await this.db.withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE identity.organizations SET status = 'SUSPENDED', version = version + 1, updated_at = now()
         WHERE id = $1 AND status = 'ACTIVE' RETURNING id`,
        [orgId]
      );
      if (updated.rowCount === 0) {
        throw new ApiException(409, 'CONFLICT', 'Organization is not active');
      }
      const restriction = await client.query<{ id: string }>(
        `INSERT INTO identity.org_restrictions (org_id, restriction_type, reason, created_by)
         VALUES ($1, 'SUSPENSION', $2, $3) RETURNING id`,
        [orgId, reason, ctx.userId]
      );
      await this.audit.record(client, {
        action: 'org.suspend', objectType: 'organization', objectId: orgId, after: { reason }
      });
      return restriction.rows[0].id;
    });
    await this.audit.recordSecurity('privileged.org.suspend', 'HIGH', { orgId, reason });
    return { restrictionId };
  }

  async lift(orgId: string): Promise<void> {
    const ctx = RequestContext.get();
    await this.db.withTransaction(async (client) => {
      const lifted = await client.query(
        `UPDATE identity.org_restrictions SET lifted_at = now(), lifted_by = $2, version = version + 1
         WHERE org_id = $1 AND lifted_at IS NULL RETURNING id`,
        [orgId, ctx.userId]
      );
      if (lifted.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'No active restriction');
      }
      await client.query(
        `UPDATE identity.organizations SET status = 'ACTIVE', version = version + 1, updated_at = now() WHERE id = $1`,
        [orgId]
      );
      await this.audit.record(client, {
        action: 'org.unsuspend', objectType: 'organization', objectId: orgId
      });
    });
    await this.audit.recordSecurity('privileged.org.unsuspend', 'HIGH', { orgId });
  }

  async createSupportGrant(orgId: string, reason: string): Promise<{ grantId: string; expiresAt: string }> {
    const ctx = RequestContext.get();
    const org = await this.db.query('SELECT 1 FROM identity.organizations WHERE id = $1', [orgId]);
    if (org.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Organization not found');
    }
    const result = await this.db.query<{ id: string; expires_at: string }>(
      `INSERT INTO identity.support_access_grants (support_user_id, org_id, reason, expires_at)
       VALUES ($1, $2, $3, now() + interval '${SUPPORT_GRANT_MINUTES} minutes')
       RETURNING id, expires_at`,
      [ctx.userId, orgId, reason]
    );
    await this.audit.recordSecurity('support.access.granted', 'HIGH', { orgId, reason });
    return { grantId: result.rows[0].id, expiresAt: result.rows[0].expires_at };
  }

  async auditTrail(orgId?: string): Promise<{ items: unknown[] }> {
    const result = orgId
      ? await this.db.query(
          `SELECT action, object_type, object_id, actor_user_id, trace_id, occurred_at
           FROM core.audit_events WHERE org_id = $1 ORDER BY occurred_at DESC LIMIT 100`,
          [orgId]
        )
      : await this.db.query(
          `SELECT action, object_type, object_id, org_id, actor_user_id, trace_id, occurred_at
           FROM core.audit_events ORDER BY occurred_at DESC LIMIT 100`
        );
    return { items: result.rows };
  }
}
