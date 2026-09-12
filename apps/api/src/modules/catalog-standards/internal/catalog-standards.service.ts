import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { CatalogStandardsService } from '../contracts';
import { ApiException } from '../../../common/errors/error-envelope';
import { AppConfig } from '../../../config/configuration';
import { APP_CONFIG } from '../../../common/database/database.module';

@Injectable()
export class CatalogStandardsServiceImpl implements CatalogStandardsService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  contextKey(): 'catalog-standards' {
    return 'catalog-standards';
  }

  async commodityExists(commodityId: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM catalog.commodities WHERE id = $1 AND deleted_at IS NULL`, [commodityId]);
    return (r.rowCount ?? 0) > 0;
  }

  async varietyExists(varietyId: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM catalog.varieties WHERE id = $1 AND deleted_at IS NULL`, [varietyId]);
    return (r.rowCount ?? 0) > 0;
  }

  // Versioned, product-scoped conversion: resolves the ACTIVE conversion in force now.
  async convert(commodityId: string | null, fromUomCode: string, toUomCode: string, qty: number): Promise<number | null> {
    const result = await this.db.query<{ factor: string }>(
      `SELECT uc.factor FROM catalog.unit_conversions uc
       JOIN catalog.units_of_measure fu ON fu.id = uc.from_uom_id
       JOIN catalog.units_of_measure tu ON tu.id = uc.to_uom_id
       WHERE COALESCE(uc.commodity_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = COALESCE($1, '00000000-0000-0000-0000-000000000000'::uuid)
         AND fu.code = $2 AND tu.code = $3 AND uc.status = 'ACTIVE'
         AND uc.effective_from <= now() AND (uc.effective_to IS NULL OR uc.effective_to > now())
       ORDER BY uc.version_no DESC LIMIT 1`,
      [commodityId, fromUomCode, toUomCode]
    );
    if (result.rowCount === 0) {
      return null;
    }
    return qty * Number(result.rows[0].factor);
  }

  // GUARDRAIL B + OD-07/OD-08: authoritative server-side eligibility for a commercial line.
  async assertCommercialLine(input: {
    commodityId: string;
    varietyId?: string | null;
    gradeProfileId?: string | null;
    packDefinitionId?: string | null;
    uomId: string;
  }): Promise<{ masterSnapshot: Record<string, unknown> }> {
    const product = await this.db.query(
      `SELECT id, ref, name, status, validation_status FROM catalog.commodities
       WHERE id = $1 AND deleted_at IS NULL`, [input.commodityId]);
    if (product.rowCount === 0) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Unknown product', { code_detail: 'UNKNOWN_REFERENCE' });
    }
    const p = product.rows[0];
    if (p.status !== 'ACTIVE' || !(p.validation_status === 'VALIDATED'
        || (this.config.catalogAllowDemoMasters && p.validation_status === 'DEMO'))) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Product master is not eligible for commercial use',
        { code_detail: 'MASTER_NOT_COMMERCIAL', status: p.status, validationStatus: p.validation_status });
    }
    const snapshot: Record<string, unknown> = {
      commodity: { id: p.id, ref: p.ref, name: p.name, validationStatus: p.validation_status }
    };

    if (input.varietyId) {
      const v = await this.db.query(
        `SELECT id, ref, name, commodity_id, status, validation_status FROM catalog.varieties
         WHERE id = $1 AND deleted_at IS NULL`, [input.varietyId]);
      if (v.rowCount === 0 || v.rows[0].commodity_id !== input.commodityId) {
        throw new ApiException(400, 'VALIDATION_FAILED', 'Variety not found for product', { code_detail: 'UNKNOWN_REFERENCE' });
      }
      if (v.rows[0].status !== 'ACTIVE') {
        throw new ApiException(400, 'VALIDATION_FAILED', 'Variety is not active', { code_detail: 'MASTER_INACTIVE' });
      }
      snapshot.variety = { id: v.rows[0].id, ref: v.rows[0].ref, name: v.rows[0].name };
    }

    // Versioned masters: must be ACTIVE + VALIDATED + inside effective window (fail closed).
    const checkVersioned = async (table: 'grade_profiles' | 'pack_definitions', id: string, label: string) => {
      const r = await this.db.query(
        `SELECT id, version_no, status, validation_status, effective_from, effective_to, commodity_id
         FROM catalog.${table} WHERE id = $1`, [id]);
      if (r.rowCount === 0) {
        throw new ApiException(400, 'VALIDATION_FAILED', `Unknown ${label}`, { code_detail: 'UNKNOWN_REFERENCE' });
      }
      const row = r.rows[0];
      if (row.commodity_id && row.commodity_id !== input.commodityId) {
        throw new ApiException(400, 'VALIDATION_FAILED', `${label} does not belong to product`, { code_detail: 'MASTER_MISMATCH' });
      }
      if (row.status !== 'ACTIVE') {
        throw new ApiException(400, 'VALIDATION_FAILED', `${label} is ${row.status}`, { code_detail: 'MASTER_INACTIVE' });
      }
      if (row.validation_status !== 'VALIDATED'
          && !(this.config.catalogAllowDemoMasters && row.validation_status === 'DEMO')) {
        throw new ApiException(400, 'VALIDATION_FAILED', `${label} is not VALIDATED`, {
          code_detail: 'MASTER_NOT_VALIDATED', validationStatus: row.validation_status
        });
      }
      const now = Date.now();
      if (new Date(row.effective_from).getTime() > now) {
        throw new ApiException(400, 'VALIDATION_FAILED', `${label} not yet effective`, { code_detail: 'NOT_YET_EFFECTIVE' });
      }
      if (row.effective_to && new Date(row.effective_to).getTime() <= now) {
        throw new ApiException(400, 'VALIDATION_FAILED', `${label} expired`, { code_detail: 'MASTER_EXPIRED' });
      }
      return row;
    };
    if (input.gradeProfileId) {
      const g = await checkVersioned('grade_profiles', input.gradeProfileId, 'grade profile');
      snapshot.gradeProfile = { id: g.id, versionNo: g.version_no, validationStatus: g.validation_status };
    }
    if (input.packDefinitionId) {
      const pk = await checkVersioned('pack_definitions', input.packDefinitionId, 'pack definition');
      snapshot.packDefinition = { id: pk.id, versionNo: pk.version_no };
    }

    const uom = await this.db.query(
      `SELECT id, code, status FROM catalog.units_of_measure WHERE id = $1`, [input.uomId]);
    if (uom.rowCount === 0 || uom.rows[0].status !== 'ACTIVE') {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Unknown or inactive unit of measure', { code_detail: 'UNKNOWN_REFERENCE' });
    }
    snapshot.uom = { id: uom.rows[0].id, code: uom.rows[0].code };
    return { masterSnapshot: snapshot };
  }

  // OD-07: normalization only through an ACTIVE, version-controlled conversion; never invented.
  async normalize(commodityId: string, fromUomId: string, toUomId: string, qty: number) {
    const r = await this.db.query<{ id: string; factor: string; version_no: number }>(
      `SELECT id, factor, version_no FROM catalog.unit_conversions
       WHERE commodity_id = $1 AND from_uom_id = $2 AND to_uom_id = $3
         AND status = 'ACTIVE' AND validation_status IN ('VALIDATED'${this.config.catalogAllowDemoMasters ? ",'DEMO'" : ''})
         AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
       ORDER BY version_no DESC LIMIT 1`,
      [commodityId, fromUomId, toUomId]
    );
    if (r.rowCount === 0) {
      return null;
    }
    const factor = Number(r.rows[0].factor);
    return {
      factor,
      conversionVersionId: r.rows[0].id,
      conversionVersionNo: r.rows[0].version_no,
      normalizedQty: qty * factor
    };
  }

  async findCapableSuppliers(commodityIds: string[]): Promise<string[]> {
    if (commodityIds.length === 0) {
      return [];
    }
    const r = await this.db.query<{ org_id: string }>(
      `SELECT DISTINCT cap.org_id FROM catalog.supplier_product_capabilities cap
       JOIN catalog.varieties v ON v.id = cap.variety_id
       WHERE cap.status = 'ACTIVE' AND v.commodity_id = ANY($1)`,
      [commodityIds]
    );
    return r.rows.map((row) => row.org_id);
  }

  // QC: grade-profile snapshot including version — inspections must pin the version used.
  async getGradeProfileSnapshot(gradeProfileId: string) {
    const r = await this.db.query(
      `SELECT id, version_no, rules, status, validation_status FROM catalog.grade_profiles WHERE id = $1`,
      [gradeProfileId]
    );
    if (r.rowCount === 0) {
      return null;
    }
    const row = r.rows[0];
    return {
      id: row.id, versionNo: row.version_no, rules: row.rules,
      status: row.status, validationStatus: row.validation_status
    };
  }

  async getActiveHandlingProfile(commodityId: string) {
    const r = await this.db.query(
      `SELECT id, version_no FROM catalog.handling_profiles
       WHERE (commodity_id = $1 OR commodity_id IS NULL) AND status = 'ACTIVE'
         AND effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
       ORDER BY version_no DESC LIMIT 1`,
      [commodityId]
    );
    if (r.rowCount === 0) {
      return null;
    }
    return { id: r.rows[0].id, versionNo: r.rows[0].version_no };
  }
}
