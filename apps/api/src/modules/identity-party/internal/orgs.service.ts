import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { FeatureFlagsService } from '../../../common/flags/feature-flags.service';
import { ReferenceIdService } from '../../../common/pagination/reference-id.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { assertOrgAccess, GATED_CATEGORIES, PLATFORM_CATEGORIES } from './policies';

@Injectable()
export class OrgsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly flags: FeatureFlagsService,
    private readonly refIds: ReferenceIdService
  ) {}

  async createOrg(input: {
    name: string;
    category: string;
    address?: { line1: string; line2?: string; city: string; state: string; postalCode: string; country?: string };
    contact?: { kind: 'EMAIL' | 'PHONE' | 'WHATSAPP'; value: string };
  }): Promise<{ id: string; ref: string }> {
    const ctx = RequestContext.get();
    if (!input?.name?.trim() || !input?.category) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'name and category are required');
    }
    if (PLATFORM_CATEGORIES.has(input.category) && !ctx.permissions.includes('org.create.platform')) {
      throw new ApiException(403, 'FORBIDDEN', 'Platform-internal categories require platform privileges');
    }
    if (GATED_CATEGORIES.has(input.category) && !(await this.flags.isEnabled('org.exporter_government'))) {
      throw new ApiException(403, 'FORBIDDEN', 'Exporter/government tenants are feature-gated');
    }
    return this.db.withTransaction(async (client) => {
      const ref = await this.refIds.next(client, 'ORG');
      const org = await client.query<{ id: string }>(
        `INSERT INTO identity.organizations (ref, name, type) VALUES ($1, $2, $3) RETURNING id`,
        [ref, input.name.trim(), input.category]
      );
      const orgId = org.rows[0].id;
      await client.query(
        `INSERT INTO identity.org_memberships (org_id, user_id, status) VALUES ($1, $2, 'ACTIVE')`,
        [orgId, ctx.userId]
      );
      await client.query(
        `INSERT INTO identity.user_roles (user_id, role_id, org_id)
         SELECT $1, r.id, $2 FROM identity.roles r WHERE r.name = 'ORG_ADMIN' AND r.org_id IS NULL`,
        [ctx.userId, orgId]
      );
      if (input.address) {
        await client.query(
          `INSERT INTO identity.addresses (org_id, line1, line2, city, state, postal_code, country)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [orgId, input.address.line1, input.address.line2 ?? null, input.address.city,
           input.address.state, input.address.postalCode, input.address.country ?? 'IN']
        );
      }
      if (input.contact) {
        await client.query(
          `INSERT INTO identity.contacts (org_id, kind, value, is_primary) VALUES ($1,$2,$3,true)`,
          [orgId, input.contact.kind, input.contact.value]
        );
      }
      await this.audit.record(client, {
        action: 'org.create', objectType: 'organization', objectId: orgId, objectRef: ref,
        after: { name: input.name, category: input.category }
      });
      await this.outbox.emit(client, {
        aggregateType: 'organization', aggregateId: orgId, type: 'party.org.created',
        payload: { orgId, ref, category: input.category }
      });
      return { id: orgId, ref };
    });
  }

  async myOrgs(userId: string): Promise<{ items: unknown[] }> {
    const result = await this.db.query(
      `SELECT o.id, o.ref, o.name, o.type, o.status, o.kyb_status, m.status AS membership_status
       FROM identity.org_memberships m JOIN identity.organizations o ON o.id = m.org_id
       WHERE m.user_id = $1 AND o.deleted_at IS NULL ORDER BY o.created_at`,
      [userId]
    );
    return { items: result.rows };
  }

  async getOrg(orgId: string): Promise<unknown> {
    assertOrgAccess(RequestContext.get(), orgId);
    const result = await this.db.query(
      `SELECT o.id, o.ref, o.name, o.type, o.status, o.kyb_status, o.created_at,
              (SELECT json_agg(a.*) FROM identity.addresses a WHERE a.org_id = o.id AND a.deleted_at IS NULL) AS addresses,
              (SELECT json_agg(c.*) FROM identity.contacts c WHERE c.org_id = o.id AND c.deleted_at IS NULL) AS contacts,
              (SELECT json_agg(b.*) FROM identity.organization_branches b WHERE b.org_id = o.id AND b.deleted_at IS NULL) AS branches
       FROM identity.organizations o WHERE o.id = $1 AND o.deleted_at IS NULL`,
      [orgId]
    );
    if (result.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Organization not found');
    }
    return result.rows[0];
  }

  async updateOrg(orgId: string, name: string): Promise<void> {
    assertOrgAccess(RequestContext.get(), orgId);
    await this.db.withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE identity.organizations SET name = $2, version = version + 1, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [orgId, name.trim()]
      );
      if (updated.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Organization not found');
      }
      await this.audit.record(client, {
        action: 'org.update', objectType: 'organization', objectId: orgId, after: { name }
      });
    });
  }

  async addBranch(orgId: string, name: string, addressId?: string): Promise<{ id: string; ref: string }> {
    assertOrgAccess(RequestContext.get(), orgId);
    return this.db.withTransaction(async (client) => {
      const ref = await this.refIds.next(client, 'BR');
      const result = await client.query<{ id: string }>(
        `INSERT INTO identity.organization_branches (ref, org_id, name, address_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [ref, orgId, name.trim(), addressId ?? null]
      );
      await this.audit.record(client, {
        action: 'org.branch.create', objectType: 'organization_branch', objectId: result.rows[0].id, objectRef: ref
      });
      return { id: result.rows[0].id, ref };
    });
  }

  async addContact(orgId: string, kind: 'EMAIL' | 'PHONE' | 'WHATSAPP', value: string): Promise<{ id: string }> {
    assertOrgAccess(RequestContext.get(), orgId);
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO identity.contacts (org_id, kind, value) VALUES ($1, $2, $3)
       ON CONFLICT (org_id, kind, value) DO NOTHING RETURNING id`,
      [orgId, kind, value.trim()]
    );
    if (result.rowCount === 0) {
      throw new ApiException(409, 'CONFLICT', 'Contact already exists');
    }
    return { id: result.rows[0].id };
  }
}
