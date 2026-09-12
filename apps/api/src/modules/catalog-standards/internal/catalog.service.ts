import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { ApiException } from '../../../common/errors/error-envelope';

// Read side of the catalog: canonical entities only, full-text + alias search.
@Injectable()
export class CatalogService {
  constructor(private readonly db: DatabaseService) {}

  async search(q: string, limit = 25): Promise<{ items: unknown[] }> {
    if (!q || q.trim().length < 2) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Query must be at least 2 characters');
    }
    const result = await this.db.query(
      `SELECT DISTINCT c.id, c.ref, c.name, c.common_name, c.commercial_name, c.botanical_name,
              c.status, c.validation_status, c.launch_enabled, c.launch_cities,
              cat.name AS category, m.matched_alias
       FROM catalog.commodities c
       JOIN catalog.categories cat ON cat.id = c.category_id
       LEFT JOIN LATERAL (
         SELECT a.alias AS matched_alias FROM catalog.product_aliases a
         WHERE a.commodity_id = c.id AND a.status = 'ACTIVE' AND a.alias ILIKE '%' || $1 || '%'
         ORDER BY length(a.alias) LIMIT 1
       ) m ON true
       WHERE c.status = 'ACTIVE' AND (
         to_tsvector('english', coalesce(c.name,'') || ' ' || coalesce(c.common_name,'') || ' ' ||
                    coalesce(c.commercial_name,'') || ' ' || coalesce(c.botanical_name,''))
           @@ websearch_to_tsquery('english', $1)
         OR c.name ILIKE '%' || $1 || '%'
         OR m.matched_alias IS NOT NULL
       )
       ORDER BY c.name LIMIT $2`,
      [q.trim(), limit]
    );
    return { items: result.rows };
  }

  async listCategories(): Promise<{ items: unknown[] }> {
    const result = await this.db.query(
      `SELECT id, code, name, parent_id, status, validation_status FROM catalog.categories
       WHERE deleted_at IS NULL ORDER BY code`
    );
    return { items: result.rows };
  }

  async listProducts(categoryCode?: string): Promise<{ items: unknown[] }> {
    const result = categoryCode
      ? await this.db.query(
          `SELECT c.id, c.ref, c.name, c.commercial_name, c.status, c.validation_status,
                  c.launch_enabled, c.launch_cities, cat.code AS category_code
           FROM catalog.commodities c JOIN catalog.categories cat ON cat.id = c.category_id
           WHERE c.deleted_at IS NULL AND cat.code = $1 ORDER BY c.name`,
          [categoryCode]
        )
      : await this.db.query(
          `SELECT c.id, c.ref, c.name, c.commercial_name, c.status, c.validation_status,
                  c.launch_enabled, c.launch_cities, cat.code AS category_code
           FROM catalog.commodities c JOIN catalog.categories cat ON cat.id = c.category_id
           WHERE c.deleted_at IS NULL ORDER BY c.name`
        );
    return { items: result.rows };
  }

  async getProduct(id: string): Promise<unknown> {
    const result = await this.db.query(
      `SELECT c.*, cat.code AS category_code, cat.name AS category_name
       FROM catalog.commodities c JOIN catalog.categories cat ON cat.id = c.category_id
       WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [id]
    );
    if (result.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Product not found');
    }
    const product = result.rows[0];
    const [aliases, varieties, grades, packs, conversions, handling, media] = await Promise.all([
      this.db.query(`SELECT id, alias, alias_type, status FROM catalog.product_aliases WHERE commodity_id = $1`, [id]),
      this.db.query(
        `SELECT v.id, v.ref, v.name, v.status, v.validation_status, v.product_form, v.commercial_use,
                v.stem_length_cm_min, v.stem_length_cm_max, co.code AS colour
         FROM catalog.varieties v LEFT JOIN catalog.colours co ON co.id = v.colour_id
         WHERE v.commodity_id = $1 AND v.deleted_at IS NULL`,
        [id]
      ),
      this.db.query(
        `SELECT id, grade_code, version_no, rules, status, effective_from, effective_to, validation_status
         FROM catalog.grade_profiles WHERE commodity_id = $1 ORDER BY grade_code, version_no DESC`,
        [id]
      ),
      this.db.query(
        `SELECT p.id, p.code, p.name, p.level, p.contains_qty, u.code AS uom, p.version_no, p.status,
                p.effective_from, p.effective_to, p.validation_status
         FROM catalog.pack_definitions p JOIN catalog.units_of_measure u ON u.id = p.contains_uom_id
         WHERE (p.commodity_id = $1 OR p.commodity_id IS NULL) AND p.status <> 'DRAFT' ORDER BY p.level, p.version_no DESC`,
        [id]
      ),
      this.db.query(
        `SELECT uc.id, fu.code AS from_uom, tu.code AS to_uom, uc.factor, uc.version_no, uc.status,
                uc.effective_from, uc.effective_to
         FROM catalog.unit_conversions uc
         JOIN catalog.units_of_measure fu ON fu.id = uc.from_uom_id
         JOIN catalog.units_of_measure tu ON tu.id = uc.to_uom_id
         WHERE (uc.commodity_id = $1 OR uc.commodity_id IS NULL) AND uc.status <> 'DRAFT'
         ORDER BY uc.version_no DESC`,
        [id]
      ),
      this.db.query(
        `SELECT id, code, version_no, temp_min_c, temp_max_c, humidity_min_pct, humidity_max_pct,
                ethylene_sensitivity, max_holding_hours, precooling_required, status,
                effective_from, effective_to, validation_status
         FROM catalog.handling_profiles WHERE (commodity_id = $1 OR commodity_id IS NULL)
         ORDER BY code, version_no DESC`,
        [id]
      ),
      this.db.query(
        `SELECT id, media_object_id, kind, alt_text FROM catalog.product_media
         WHERE commodity_id = $1 AND status = 'ACTIVE'`,
        [id]
      )
    ]);
    return {
      ...product,
      aliases: aliases.rows,
      varieties: varieties.rows,
      gradeProfiles: grades.rows,
      packDefinitions: packs.rows,
      unitConversions: conversions.rows,
      handlingProfiles: handling.rows,
      media: media.rows
    };
  }

  async getVariety(id: string): Promise<unknown> {
    const result = await this.db.query(
      `SELECT v.*, c.name AS commodity_name, c.ref AS commodity_ref, co.name AS colour_name
       FROM catalog.varieties v
       JOIN catalog.commodities c ON c.id = v.commodity_id
       LEFT JOIN catalog.colours co ON co.id = v.colour_id
       WHERE v.id = $1 AND v.deleted_at IS NULL`,
      [id]
    );
    if (result.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Variety not found');
    }
    return result.rows[0];
  }
}
