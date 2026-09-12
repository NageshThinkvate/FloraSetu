import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { CatalogStandardsService } from '../contracts';

@Injectable()
export class CatalogStandardsServiceImpl implements CatalogStandardsService {
  constructor(private readonly db: DatabaseService) {}

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
}
