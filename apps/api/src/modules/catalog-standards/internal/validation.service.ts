import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../../../config/configuration';
import { APP_CONFIG } from '../../../common/database/database.module';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';

export type ProtectedEntity = 'grade_profiles' | 'pack_definitions' | 'unit_conversions' | 'handling_profiles';
const ENTITIES = new Set<ProtectedEntity>(['grade_profiles', 'pack_definitions', 'unit_conversions', 'handling_profiles']);
// OD-08: validator must be a separate authorized reviewer from the proposer on these.
const SELF_APPROVAL_BLOCKED = new Set<ProtectedEntity>(['grade_profiles', 'handling_profiles', 'unit_conversions']);

@Injectable()
export class ValidationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  private assertEntity(entity: string): asserts entity is ProtectedEntity {
    if (!ENTITIES.has(entity as ProtectedEntity)) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Unsupported entity for validation workflow');
    }
  }

  private async load(entity: ProtectedEntity, id: string) {
    const result = await this.db.query(
      `SELECT * FROM catalog.${entity} WHERE id = $1`, [id]
    );
    if (result.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Definition not found');
    }
    return result.rows[0] as Record<string, unknown> & {
      id: string; status: string; validation_status: string; version_no: number;
      requested_by: string | null; effective_from: string; effective_to: string | null;
    };
  }

  async requestValidation(entity: string, id: string): Promise<unknown> {
    this.assertEntity(entity);
    const actor = RequestContext.get().userId!;
    return this.db.withTransaction(async (client) => {
      const row = await this.load(entity, id);
      if (!['DEMO', 'REJECTED'].includes(row.validation_status)) {
        throw new ApiException(409, 'CONFLICT', `Cannot request validation from ${row.validation_status}`);
      }
      await client.query(
        `UPDATE catalog.${entity} SET validation_status = 'PENDING_REVIEW', requested_by = $2, requested_at = now(),
           rejection_reason = NULL WHERE id = $1`,
        [id, actor]
      );
      await this.audit.record(client, {
        action: `catalog.${entity}.validation.request`, objectType: entity, objectId: id,
        before: { validationStatus: row.validation_status }, after: { validationStatus: 'PENDING_REVIEW' }
      });
      return { id, validationStatus: 'PENDING_REVIEW' };
    });
  }

  async reviewValidation(
    entity: string, id: string,
    decision: 'VALIDATED' | 'REJECTED',
    input: { reference?: string; notes?: string; rejectionReason?: string }
  ): Promise<unknown> {
    this.assertEntity(entity);
    const actor = RequestContext.get().userId!;
    if (decision === 'REJECTED' && !input.rejectionReason) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'rejectionReason is required when rejecting');
    }
    return this.db.withTransaction(async (client) => {
      const row = await this.load(entity, id);
      if (row.validation_status !== 'PENDING_REVIEW') {
        throw new ApiException(409, 'CONFLICT', `Version is ${row.validation_status}, not PENDING_REVIEW`);
      }
      if (SELF_APPROVAL_BLOCKED.has(entity) && row.requested_by === actor) {
        throw new ApiException(403, 'FORBIDDEN', 'Validator must be a separate reviewer from the proposer', {
          code_detail: 'SELF_APPROVAL'
        });
      }
      await client.query(
        `UPDATE catalog.${entity}
         SET validation_status = $2, reviewed_by = $3, reviewed_at = now(),
             validation_reference = $4, reviewer_notes = $5, rejection_reason = $6
         WHERE id = $1`,
        [id, decision, actor, input.reference ?? null, input.notes ?? null,
         decision === 'REJECTED' ? input.rejectionReason! : null]
      );
      await this.audit.record(client, {
        action: `catalog.${entity}.validation.review`, objectType: entity, objectId: id,
        before: { validationStatus: 'PENDING_REVIEW' },
        after: { validationStatus: decision, reference: input.reference, rejectionReason: input.rejectionReason }
      });
      return { id, validationStatus: decision };
    });
  }

  // Production commercial use requires ACTIVE + VALIDATED + in effective window,
  // unless this non-production environment explicitly enables demo masters.
  async commercialCheck(entity: string, id: string): Promise<unknown> {
    this.assertEntity(entity);
    const row = await this.load(entity, id);
    const reasons: string[] = [];
    if (row.status !== 'ACTIVE') {
      reasons.push(`status is ${row.status}`);
    }
    const now = Date.now();
    if (new Date(row.effective_from).getTime() > now
        || (row.effective_to && new Date(row.effective_to).getTime() <= now)) {
      reasons.push('outside effective window');
    }
    const demoAllowed = this.config.catalogAllowDemoMasters;
    const validationOk = row.validation_status === 'VALIDATED'
      || (demoAllowed && row.validation_status === 'DEMO');
    if (!validationOk) {
      reasons.push(`validation_status is ${row.validation_status}`);
    }
    return {
      entity, id, versionNo: row.version_no,
      usable: reasons.length === 0,
      status: row.status,
      validationStatus: row.validation_status,
      demoMastersAllowedInThisEnvironment: demoAllowed,
      reasons
    };
  }

  // OD-07 foundation: explicit commercial UoM is mandatory at the transaction boundary.
  // preferred_order_uom_id may preselect in UI but never replaces the submitted uom_id.
  async validateCommercialLine(input: { commodityId: string; uomId?: string }): Promise<unknown> {
    const product = await this.db.query<{ preferred_order_uom_id: string | null }>(
      `SELECT preferred_order_uom_id FROM catalog.commodities WHERE id = $1 AND deleted_at IS NULL`,
      [input.commodityId]
    );
    if (product.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Product not found');
    }
    if (!input.uomId) {
      throw new ApiException(400, 'VALIDATION_FAILED',
        'Explicit uomId is required on commercial lines; preferred UoM never substitutes it',
        { code_detail: 'UOM_REQUIRED' });
    }
    const uom = await this.db.query(
      `SELECT 1 FROM catalog.units_of_measure WHERE id = $1 AND status = 'ACTIVE'`, [input.uomId]);
    if (uom.rowCount === 0) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Unknown or inactive unit of measure', { code_detail: 'UNKNOWN_REFERENCE' });
    }
    return {
      commodityId: input.commodityId,
      submittedUomId: input.uomId,
      preferredOrderUomId: product.rows[0].preferred_order_uom_id,
      valid: true
    };
  }

  // OD-07 foundation: supplier quote normalization preserves originals + conversion version.
  async normalizePreview(input: {
    commodityId: string; qty: number; uomId: string; targetUomId: string;
  }): Promise<unknown> {
    if (input.qty <= 0) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'qty must be positive');
    }
    const conv = await this.db.query<{ id: string; factor: string; version_no: number }>(
      `SELECT uc.id, uc.factor, uc.version_no FROM catalog.unit_conversions uc
       WHERE uc.commodity_id = $1 AND uc.from_uom_id = $2 AND uc.to_uom_id = $3
         AND uc.status = 'ACTIVE' AND uc.effective_from <= now()
         AND (uc.effective_to IS NULL OR uc.effective_to > now())
       ORDER BY uc.version_no DESC LIMIT 1`,
      [input.commodityId, input.uomId, input.targetUomId]
    );
    if (conv.rowCount === 0) {
      throw new ApiException(400, 'VALIDATION_FAILED',
        'No active version-controlled conversion for this product and UoM pair', { code_detail: 'NO_CONVERSION' });
    }
    const factor = Number(conv.rows[0].factor);
    return {
      originalQty: input.qty,
      originalUomId: input.uomId,
      conversionVersionId: conv.rows[0].id,
      conversionVersionNo: conv.rows[0].version_no,
      conversionFactor: factor,
      normalizedQty: input.qty * factor,
      normalizedUomId: input.targetUomId
    };
  }
}
