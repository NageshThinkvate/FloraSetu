import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { MediaService } from '../../../common/media/media.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';

const SUPPORT_GRANT_MINUTES = 30;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export interface AuditFilters {
  orgId?: string;
  actorUserId?: string;
  action?: string;
  objectType?: string;
  objectId?: string;
  traceId?: string;
  from?: string;
  to?: string;
}

// Phase 7 (ADR-014): the Admin Control Plane governs organizations, KYB, users/access,
// configuration and audit inspection. It is NOT a universal transactional actor — no
// marketplace state is mutated here, and every privileged action is permission-checked,
// reasoned where required, and written to the immutable audit streams.
@Injectable()
export class AdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly media: MediaService
  ) {}

  // Platform-level list: masked, non-sensitive fields only. KYC/bank data is never included.
  async listOrgs(): Promise<{ items: unknown[] }> {
    const result = await this.db.query(
      `SELECT id, ref, name, type, status, kyb_status, capabilities, created_at
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
      `SELECT o.id, o.ref, o.name, o.type, o.status, o.kyb_status, o.capabilities, o.created_at,
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
    if (!reason?.trim()) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'A reason is required to suspend an organization');
    }
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

  // ---------- Phase 7 (ADR-014): control-plane overview ----------

  async overview(): Promise<unknown> {
    const [kyb, restrictions, suspendedUsers, bankFreeze, secEvents, recent] = await Promise.all([
      this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM identity.organizations WHERE kyb_status = 'IN_REVIEW' AND deleted_at IS NULL`),
      this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM identity.org_restrictions WHERE lifted_at IS NULL`),
      this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM identity.users WHERE status = 'SUSPENDED' AND deleted_at IS NULL`),
      this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM identity.bank_change_requests
         WHERE payout_freeze = true AND status IN ('PENDING_REVERIFICATION','APPROVED_FIRST')`),
      this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM core.security_audit_events WHERE occurred_at > now() - interval '24 hours'`),
      this.db.query(
        `SELECT action, object_type, object_ref, actor_user_id, occurred_at
         FROM core.audit_events ORDER BY occurred_at DESC LIMIT 10`)
    ]);
    return {
      kybPendingReview: kyb.rows[0].n,
      restrictedOrganizations: restrictions.rows[0].n,
      suspendedUsers: suspendedUsers.rows[0].n,
      payoutFreezingBankChanges: bankFreeze.rows[0].n,
      securityEventsLast24h: secEvents.rows[0].n,
      recentAdminActivity: recent.rows
    };
  }

  // ---------- Phase 7 (ADR-014): KYB review queue + evidence-first detail ----------

  async kybQueue(): Promise<{ items: unknown[] }> {
    const result = await this.db.query(
      `SELECT o.id, o.ref, o.name, o.type, o.kyb_status, o.updated_at,
              (SELECT count(*)::int FROM identity.documents d WHERE d.org_id = o.id) AS document_count,
              (SELECT max(d.created_at) FROM identity.documents d WHERE d.org_id = o.id) AS last_submitted_at,
              (SELECT vh.reason_code FROM identity.verification_history vh
                WHERE vh.org_id = o.id AND vh.subject_type = 'ORGANIZATION'
                ORDER BY vh.created_at DESC LIMIT 1) AS last_reason_code,
              (SELECT vh.created_at FROM identity.verification_history vh
                WHERE vh.org_id = o.id AND vh.subject_type = 'ORGANIZATION' AND vh.from_status = 'IN_REVIEW'
                ORDER BY vh.created_at DESC LIMIT 1) AS decided_at
       FROM identity.organizations o
       WHERE o.deleted_at IS NULL AND o.kyb_status IN ('IN_REVIEW','VERIFIED','REJECTED')
       ORDER BY CASE WHEN o.kyb_status = 'IN_REVIEW' THEN 0 ELSE 1 END, o.updated_at DESC
       LIMIT 200`
    );
    return { items: result.rows };
  }

  // Reviewer detail: org claims + submitted documents with short-lived signed URLs.
  // Authorization (kyb.review) happens at the controller BEFORE any URL is signed;
  // document access itself is recorded in the security audit stream.
  async kybReviewDetail(orgId: string): Promise<unknown> {
    const org = await this.db.query(
      `SELECT id, ref, name, type, status, kyb_status, created_at
       FROM identity.organizations WHERE id = $1 AND deleted_at IS NULL`,
      [orgId]
    );
    if (org.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Organization not found');
    }
    const docs = await this.db.query<{
      id: string; doc_type: string; status: string; created_at: string;
      content_type: string; byte_size: number; object_key: string;
    }>(
      `SELECT d.id, d.doc_type, d.status, d.created_at, m.content_type, m.byte_size, m.object_key
       FROM identity.documents d JOIN core.media_objects m ON m.id = d.media_object_id
       WHERE d.org_id = $1 ORDER BY d.created_at DESC`,
      [orgId]
    );
    const documents = await Promise.all(docs.rows.map(async (d) => ({
      id: d.id,
      docType: d.doc_type,
      status: d.status,
      contentType: d.content_type,
      byteSize: d.byte_size,
      uploadedAt: d.created_at,
      url: (await this.media.signRead(d.object_key, 300)).url
    })));
    const history = await this.db.query(
      `SELECT subject_type, from_status, to_status, reason_code, note, actor_user_id, created_at
       FROM identity.verification_history WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId]
    );
    if (documents.length > 0) {
      await this.audit.recordSecurity('kyb.document.access', 'WARN', { orgId, documentCount: documents.length });
    }
    return { org: org.rows[0], documents, history: history.rows };
  }

  // ---------- Phase 7 (ADR-014): user & access governance ----------

  async listUsers(q?: string, status?: string): Promise<{ items: unknown[] }> {
    const params: unknown[] = [];
    let where = 'u.deleted_at IS NULL';
    if (q?.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`);
      where += ` AND (lower(u.email) LIKE $${params.length} OR lower(u.display_name) LIKE $${params.length} OR lower(u.ref) LIKE $${params.length})`;
    }
    if (status) {
      params.push(status);
      where += ` AND u.status = $${params.length}`;
    }
    const result = await this.db.query(
      `SELECT u.id, u.ref, u.email, u.display_name, u.status, u.created_at,
              EXISTS (SELECT 1 FROM identity.mfa_enrollments m WHERE m.user_id = u.id AND m.status = 'ACTIVE') AS mfa_active,
              (SELECT json_agg(json_build_object(
                 'orgId', m.org_id, 'orgName', o.name, 'orgRef', o.ref, 'membershipStatus', m.status,
                 'roles', COALESCE((SELECT array_agg(ro.name) FROM identity.user_roles ur
                   JOIN identity.roles ro ON ro.id = ur.role_id
                   WHERE ur.user_id = m.user_id AND ur.org_id = m.org_id), '{}')))
               FROM identity.org_memberships m JOIN identity.organizations o ON o.id = m.org_id
               WHERE m.user_id = u.id) AS memberships
       FROM identity.users u WHERE ${where} ORDER BY u.created_at DESC LIMIT 200`,
      params
    );
    return { items: result.rows };
  }

  // admin.user.manage is deliberately narrow (ADR-014): suspend/reactivate only.
  // No IAM mutation, no MFA changes, no credential access, history preserved.
  async suspendUser(userId: string, reason: string): Promise<void> {
    const ctx = RequestContext.get();
    if (!reason?.trim()) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'A reason is required to suspend a user');
    }
    if (ctx.userId === userId) {
      throw new ApiException(409, 'CONFLICT', 'You cannot suspend your own account');
    }
    await this.db.withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE identity.users SET status = 'SUSPENDED', version = version + 1, updated_at = now()
         WHERE id = $1 AND status = 'ACTIVE' AND deleted_at IS NULL RETURNING id`,
        [userId]
      );
      if (updated.rowCount === 0) {
        throw new ApiException(409, 'CONFLICT', 'User is not active');
      }
      await this.audit.record(client, {
        action: 'admin.user.suspend', objectType: 'user', objectId: userId, after: { reason }
      });
    });
    await this.audit.recordSecurity('privileged.user.suspend', 'HIGH', { userId, reason });
  }

  async reactivateUser(userId: string): Promise<void> {
    await this.db.withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE identity.users SET status = 'ACTIVE', version = version + 1, updated_at = now()
         WHERE id = $1 AND status = 'SUSPENDED' AND deleted_at IS NULL RETURNING id`,
        [userId]
      );
      if (updated.rowCount === 0) {
        throw new ApiException(409, 'CONFLICT', 'User is not suspended');
      }
      await this.audit.record(client, {
        action: 'admin.user.reactivate', objectType: 'user', objectId: userId
      });
    });
    await this.audit.recordSecurity('privileged.user.reactivate', 'WARN', { userId });
  }

  // Read-only roles/permissions matrix (ADR-014): roles stay seeded/static — no IAM designer.
  async rolesMatrix(): Promise<{ items: unknown[] }> {
    const result = await this.db.query(
      `SELECT ro.name, ro.is_system, ro.mfa_required,
              COALESCE(json_agg(json_build_object('code', pe.code, 'description', pe.description)
                       ORDER BY pe.code) FILTER (WHERE pe.code IS NOT NULL), '[]') AS permissions
       FROM identity.roles ro
       LEFT JOIN identity.role_permissions rp ON rp.role_id = ro.id
       LEFT JOIN identity.permissions pe ON pe.id = rp.permission_id
       WHERE ro.org_id IS NULL
       GROUP BY ro.name, ro.is_system, ro.mfa_required ORDER BY ro.name`
    );
    return { items: result.rows };
  }

  // ---------- Phase 7 (ADR-014): security administration ----------

  async securityOverview(): Promise<unknown> {
    const [privileged, events, grants] = await Promise.all([
      this.db.query(
        `SELECT u.id, u.ref, u.email, u.display_name, u.status,
                EXISTS (SELECT 1 FROM identity.mfa_enrollments m WHERE m.user_id = u.id AND m.status = 'ACTIVE') AS mfa_active,
                (SELECT array_agg(DISTINCT ro2.name) FROM identity.user_roles ur2
                  JOIN identity.roles ro2 ON ro2.id = ur2.role_id
                  WHERE ur2.user_id = u.id AND ro2.name IN ('PLATFORM_ADMIN','FINANCE_OPS','KYB_REVIEWER')) AS privileged_roles
         FROM identity.users u
         JOIN identity.user_roles ur ON ur.user_id = u.id
         JOIN identity.roles ro ON ro.id = ur.role_id AND ro.name IN ('PLATFORM_ADMIN','FINANCE_OPS','KYB_REVIEWER')
         WHERE u.deleted_at IS NULL
         GROUP BY u.id, u.ref, u.email, u.display_name, u.status
         ORDER BY u.created_at DESC LIMIT 100`),
      this.db.query(
        `SELECT event_type, severity, org_id, actor_user_id, trace_id, occurred_at
         FROM core.security_audit_events ORDER BY occurred_at DESC LIMIT 50`),
      this.db.query(
        `SELECT g.id, u.email AS support_email, o.name AS org_name, o.ref AS org_ref,
                g.reason, g.expires_at, g.created_at
         FROM identity.support_access_grants g
         JOIN identity.users u ON u.id = g.support_user_id
         JOIN identity.organizations o ON o.id = g.org_id
         ORDER BY g.created_at DESC LIMIT 50`)
    ]);
    return {
      privilegedUsers: privileged.rows,
      securityEvents: events.rows,
      supportGrants: grants.rows
    };
  }

  // ---------- Phase 7 (ADR-014): audit inspection (immutable; read/export only) ----------

  private auditQuery(filters: AuditFilters): { text: string; params: unknown[] } {
    const params: unknown[] = [];
    const clauses: string[] = [];
    const add = (clause: string, value: unknown): void => {
      params.push(value);
      clauses.push(clause.replace('$$', `$${params.length}`));
    };
    if (filters.orgId) { add('org_id = $$', filters.orgId); }
    if (filters.actorUserId) { add('actor_user_id = $$', filters.actorUserId); }
    if (filters.action) { add('action = $$', filters.action); }
    if (filters.objectType) { add('object_type = $$', filters.objectType); }
    if (filters.objectId) { add('object_id = $$', filters.objectId); }
    if (filters.traceId) { add('trace_id = $$', filters.traceId); }
    if (filters.from) { add('occurred_at >= $$', filters.from); }
    if (filters.to) { add('occurred_at <= $$', filters.to); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return {
      text: `SELECT id, action, object_type, object_id, object_ref, org_id, actor_user_id, actor_roles, trace_id, occurred_at
             FROM core.audit_events ${where} ORDER BY occurred_at DESC LIMIT 500`,
      params
    };
  }

  async auditTrail(filters: AuditFilters): Promise<{ items: unknown[] }> {
    const { text, params } = this.auditQuery(filters);
    const result = await this.db.query(text, params);
    return { items: result.rows };
  }

  // Authorized export: no credentials, secrets, tokens or bank data exist in this stream.
  async auditCsv(filters: AuditFilters): Promise<string> {
    const { text, params } = this.auditQuery(filters);
    const result = await this.db.query<Record<string, unknown>>(text, params);
    const esc = (v: unknown): string => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) {
        s = `'${s}`;
      }
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = result.rows.map((r) => [
      r.id, r.occurred_at, r.action, r.object_type, r.object_ref ?? '', r.object_id,
      r.org_id ?? '', r.actor_user_id ?? '', (r.actor_roles as string[] ?? []).join('|'), r.trace_id ?? ''
    ].map(esc).join(','));
    const csv = [
      'id,occurred_at,action,object_type,object_ref,object_id,org_id,actor_user_id,actor_roles,trace_id',
      ...rows
    ].join('\n');
    await this.db.withTransaction(async (client) => {
      await this.audit.record(client, {
        action: 'admin.audit_export', objectType: 'audit_log', objectId: NIL_UUID, objectRef: 'audit_export',
        after: { rows: result.rows.length, filters }
      });
    });
    return csv;
  }
}
