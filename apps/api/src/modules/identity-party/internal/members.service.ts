import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { assertOrgAccess, maskEmail, ORG_ASSIGNABLE_ROLES } from './policies';

@Injectable()
export class MembersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService
  ) {}

  async list(orgId: string): Promise<{ items: unknown[] }> {
    assertOrgAccess(RequestContext.get(), orgId);
    const result = await this.db.query(
      `SELECT m.id AS membership_id, m.status, u.id AS user_id, u.ref AS user_ref, u.display_name,
              COALESCE(array_agg(ro.name) FILTER (WHERE ro.name IS NOT NULL), '{}') AS roles
       FROM identity.org_memberships m
       JOIN identity.users u ON u.id = m.user_id
       LEFT JOIN identity.user_roles ur ON ur.org_id = m.org_id AND ur.user_id = m.user_id
       LEFT JOIN identity.roles ro ON ro.id = ur.role_id
       WHERE m.org_id = $1
       GROUP BY m.id, m.status, u.id, u.ref, u.display_name`,
      [orgId]
    );
    return { items: result.rows };
  }

  async invite(orgId: string, email: string): Promise<{ membershipId: string }> {
    assertOrgAccess(RequestContext.get(), orgId);
    const normalized = email.trim().toLowerCase();
    const user = await this.db.query<{ id: string }>('SELECT id FROM identity.users WHERE email = $1', [normalized]);
    if (user.rowCount === 0) {
      // Do not reveal whether the email exists on the platform.
      throw new ApiException(404, 'NOT_FOUND', 'No such user');
    }
    return this.db.withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO identity.org_memberships (org_id, user_id, status) VALUES ($1, $2, 'INVITED')
         ON CONFLICT (org_id, user_id) DO NOTHING RETURNING id`,
        [orgId, user.rows[0].id]
      );
      if (inserted.rowCount === 0) {
        throw new ApiException(409, 'CONFLICT', 'User is already a member');
      }
      await this.audit.record(client, {
        action: 'org.member.invite', objectType: 'org_membership', objectId: inserted.rows[0].id,
        after: { invitedEmail: maskEmail(normalized) }
      });
      return { membershipId: inserted.rows[0].id };
    });
  }

  async accept(userId: string, membershipId: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE identity.org_memberships SET status = 'ACTIVE'
       WHERE id = $1 AND user_id = $2 AND status = 'INVITED' RETURNING id`,
      [membershipId, userId]
    );
    if (result.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Invitation not found');
    }
  }

  async assignRole(orgId: string, userId: string, roleName: string): Promise<void> {
    assertOrgAccess(RequestContext.get(), orgId);
    if (!ORG_ASSIGNABLE_ROLES.has(roleName)) {
      // Privilege-escalation protection: platform privileged roles are never org-assignable.
      throw new ApiException(403, 'FORBIDDEN', 'This role cannot be assigned at organization level');
    }
    await this.db.withTransaction(async (client) => {
      const member = await client.query(
        `SELECT 1 FROM identity.org_memberships WHERE org_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
        [orgId, userId]
      );
      if (member.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Membership not found');
      }
      const inserted = await client.query(
        `INSERT INTO identity.user_roles (user_id, role_id, org_id)
         SELECT $1, r.id, $2 FROM identity.roles r WHERE r.name = $3 AND r.org_id IS NULL
         ON CONFLICT (user_id, role_id, org_id) DO NOTHING RETURNING id`,
        [userId, orgId, roleName]
      );
      if (inserted.rowCount === 0) {
        throw new ApiException(409, 'CONFLICT', 'Role already assigned');
      }
      await this.audit.record(client, {
        action: 'org.role.assign', objectType: 'user_role', objectId: inserted.rows[0].id,
        after: { userId, roleName }
      });
    });
  }

  async removeRole(orgId: string, userId: string, roleName: string): Promise<void> {
    assertOrgAccess(RequestContext.get(), orgId);
    if (!ORG_ASSIGNABLE_ROLES.has(roleName)) {
      throw new ApiException(403, 'FORBIDDEN', 'This role cannot be managed at organization level');
    }
    await this.db.query(
      `DELETE FROM identity.user_roles
       WHERE user_id = $1 AND org_id = $2
         AND role_id IN (SELECT id FROM identity.roles WHERE name = $3 AND org_id IS NULL)`,
      [userId, orgId, roleName]
    );
  }
}
