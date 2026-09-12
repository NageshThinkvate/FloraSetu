import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { SUPPLIER_SIDE_ORG_TYPES } from './catalog-policies';

// Supplier-owned capability records ("products we handle"). Org-scoped object authz.
@Injectable()
export class CapabilitiesService {
  constructor(private readonly db: DatabaseService) {}

  async listMine(): Promise<{ items: unknown[] }> {
    const ctx = RequestContext.get();
    if (!ctx.orgId) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'X-Org-Id header required');
    }
    const result = await this.db.query(
      `SELECT cap.id, cap.status, cap.notes, cap.created_at, v.id AS variety_id, v.name AS variety,
              v.ref AS variety_ref, c.name AS commodity, c.ref AS commodity_ref
       FROM catalog.supplier_product_capabilities cap
       JOIN catalog.varieties v ON v.id = cap.variety_id
       JOIN catalog.commodities c ON c.id = v.commodity_id
       WHERE cap.org_id = $1 ORDER BY cap.created_at DESC`,
      [ctx.orgId]
    );
    return { items: result.rows };
  }

  async add(varietyId: string, notes?: string): Promise<{ id: string }> {
    const ctx = RequestContext.get();
    if (!ctx.orgId) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'X-Org-Id header required');
    }
    if (!ctx.orgType || !SUPPLIER_SIDE_ORG_TYPES.has(ctx.orgType)) {
      throw new ApiException(403, 'FORBIDDEN', 'Only supplier-side organizations manage capabilities');
    }
    const variety = await this.db.query<{ status: string }>(
      'SELECT status FROM catalog.varieties WHERE id = $1 AND deleted_at IS NULL',
      [varietyId]
    );
    if (variety.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Variety not found');
    }
    if (variety.rows[0].status !== 'ACTIVE') {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Inactive definitions cannot be selected for new use');
    }
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO catalog.supplier_product_capabilities (org_id, variety_id, notes, created_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT (org_id, variety_id) DO NOTHING RETURNING id`,
      [ctx.orgId, varietyId, notes ?? null, ctx.userId]
    );
    if (result.rowCount === 0) {
      throw new ApiException(409, 'CONFLICT', 'Capability already exists');
    }
    return { id: result.rows[0].id };
  }

  async remove(capabilityId: string): Promise<void> {
    const ctx = RequestContext.get();
    const result = await this.db.query(
      `DELETE FROM catalog.supplier_product_capabilities WHERE id = $1 AND org_id = $2`,
      [capabilityId, ctx.orgId]
    );
    if (result.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Capability not found');
    }
  }
}
