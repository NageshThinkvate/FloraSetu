import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ReferenceIdService } from '../../../common/pagination/reference-id.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import {
  CreateAliasDto, CreateCategoryDto, CreateColourDto, CreateConversionDto, CreateDefectTypeDto,
  CreateGradeProfileDto, CreateHandlingProfileDto, CreatePackDto, CreateProductDto,
  CreateQualityAttributeDto, CreateTransportRuleDto, CreateUomDto, CreateVarietyDto, LaunchFlagsDto
} from './dto';

type VersionedEntity = 'grade_profiles' | 'pack_definitions' | 'unit_conversions' | 'handling_profiles';

const VERSIONED_KEY: Record<VersionedEntity, string[]> = {
  grade_profiles: ['commodity_id', 'grade_code'],
  pack_definitions: ['code', "COALESCE(commodity_id, '00000000-0000-0000-0000-000000000000'::uuid)"],
  unit_conversions: ["COALESCE(commodity_id, '00000000-0000-0000-0000-000000000000'::uuid)", 'from_uom_id', 'to_uom_id'],
  handling_profiles: ['code', "COALESCE(commodity_id, '00000000-0000-0000-0000-000000000000'::uuid)"]
};

// Catalog administration: versioned master data, no silent destructive edits,
// no deletion of definitions that may be referenced historically.
@Injectable()
export class CatalogAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService
  ) {}

  private actor(): string {
    return RequestContext.get().userId!;
  }

  private assertDateRange(from: string, to?: string): void {
    if (to && new Date(to) <= new Date(from)) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'effectiveTo must be after effectiveFrom');
    }
  }

  private async publish(client: PoolClient, entity: string, id: string, versionNo: number): Promise<void> {
    await this.outbox.emit(client, {
      aggregateType: entity, aggregateId: id, type: 'catalog.standard.published',
      payload: { entity, id, versionNo }
    });
  }

  async createCategory(dto: CreateCategoryDto): Promise<unknown> {
    return this.db.withTransaction(async (client) => {
      const ref = await this.refIds.next(client, 'CAT');
      const result = await client.query(
        `INSERT INTO catalog.categories (ref, code, name, parent_id, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, ref, code, name, status`,
        [ref, dto.code, dto.name, dto.parentId ?? null, this.actor()]
      ).catch((err: Error) => {
        if (err.message.includes('categories_code_uidx')) {
          throw new ApiException(409, 'CONFLICT', 'Category code already exists');
        }
        throw err;
      });
      await this.audit.record(client, {
        action: 'catalog.category.create', objectType: 'category', objectId: result.rows[0].id, objectRef: ref,
        after: { code: dto.code, name: dto.name }
      });
      return result.rows[0];
    });
  }

  async createProduct(dto: CreateProductDto): Promise<unknown> {
    return this.db.withTransaction(async (client) => {
      const ref = await this.refIds.next(client, 'PRD');
      const seasonality = dto.seasonalityMonths ? { available_months: dto.seasonalityMonths } : null;
      const result = await client.query(
        `INSERT INTO catalog.commodities
           (ref, category_id, name, botanical_name, common_name, commercial_name, default_uom_id, preferred_order_uom_id, seasonality, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, ref, name`,
        [ref, dto.categoryId, dto.name, dto.botanicalName ?? null, dto.commonName ?? null,
         dto.commercialName ?? null, dto.defaultUomId ?? null, dto.preferredOrderUomId ?? null,
         seasonality ? JSON.stringify(seasonality) : null, this.actor()]
      );
      await this.audit.record(client, {
        action: 'catalog.product.create', objectType: 'commodity', objectId: result.rows[0].id,
        objectRef: ref, after: { name: dto.name }
      });
      await this.outbox.emit(client, {
        aggregateType: 'commodity', aggregateId: result.rows[0].id, type: 'catalog.product.created',
        payload: { commodityId: result.rows[0].id, ref }
      });
      return result.rows[0];
    });
  }

  async createAlias(dto: CreateAliasDto): Promise<unknown> {
    return this.db.withTransaction(async (client) => {
      const exists = await client.query(
        `SELECT commodity_id FROM catalog.product_aliases WHERE lower(alias) = lower($1) AND status = 'ACTIVE'`,
        [dto.alias]
      );
      if (exists.rowCount && exists.rowCount > 0) {
        throw new ApiException(409, 'CONFLICT', 'Alias already mapped to a canonical product', {
          commodityId: exists.rows[0].commodity_id
        });
      }
      const result = await client.query(
        `INSERT INTO catalog.product_aliases (commodity_id, alias, alias_type, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id, alias, alias_type`,
        [dto.commodityId, dto.alias.trim(), dto.aliasType, this.actor()]
      );
      await this.audit.record(client, {
        action: 'catalog.alias.create', objectType: 'product_alias', objectId: result.rows[0].id,
        after: { alias: dto.alias, commodityId: dto.commodityId }
      });
      return result.rows[0];
    });
  }

  async createColour(dto: CreateColourDto): Promise<unknown> {
    return this.db.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO catalog.colours (code, name, hex, created_by) VALUES ($1, $2, $3, $4)
         RETURNING id, code, name`,
        [dto.code, dto.name, dto.hex ?? null, this.actor()]
      ).catch((err: Error) => {
        if (err.message.includes('colours_code_key')) {
          throw new ApiException(409, 'CONFLICT', 'Colour code already exists');
        }
        throw err;
      });
      await this.audit.record(client, {
        action: 'catalog.colour.create', objectType: 'colour', objectId: result.rows[0].id,
        after: { code: dto.code }
      });
      return result.rows[0];
    });
  }

  async createVariety(dto: CreateVarietyDto): Promise<unknown> {
    if (dto.stemLengthCmMin !== undefined && dto.stemLengthCmMax !== undefined
        && dto.stemLengthCmMin > dto.stemLengthCmMax) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'stemLengthCmMin must not exceed stemLengthCmMax');
    }
    return this.db.withTransaction(async (client) => {
      const ref = await this.refIds.next(client, 'VAR');
      const result = await client.query(
        `INSERT INTO catalog.varieties
           (ref, commodity_id, name, colour_id, product_form, stem_length_cm_min, stem_length_cm_max, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, ref, name`,
        [ref, dto.commodityId, dto.name, dto.colourId ?? null, dto.productForm ?? null,
         dto.stemLengthCmMin ?? null, dto.stemLengthCmMax ?? null, this.actor()]
      );
      await this.audit.record(client, {
        action: 'catalog.variety.create', objectType: 'variety', objectId: result.rows[0].id,
        objectRef: ref, after: { name: dto.name, commodityId: dto.commodityId }
      });
      return result.rows[0];
    });
  }

  async createUom(dto: CreateUomDto): Promise<unknown> {
    return this.db.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO catalog.units_of_measure (code, name, created_by) VALUES ($1, $2, $3)
         RETURNING id, code, name`,
        [dto.code, dto.name, this.actor()]
      ).catch((err: Error) => {
        if (err.message.includes('units_of_measure_code_key')) {
          throw new ApiException(409, 'CONFLICT', 'UOM code already exists');
        }
        throw err;
      });
      await this.audit.record(client, {
        action: 'catalog.uom.create', objectType: 'unit_of_measure', objectId: result.rows[0].id,
        after: { code: dto.code }
      });
      return result.rows[0];
    });
  }

  async createQualityAttribute(dto: CreateQualityAttributeDto): Promise<unknown> {
    return this.db.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO catalog.quality_attributes (code, name, data_type, uom_id, allowed_values, description, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, code, name`,
        [dto.code, dto.name, dto.dataType, dto.uomId ?? null, dto.allowedValues ?? null,
         dto.description ?? null, this.actor()]
      ).catch((err: Error) => {
        if (err.message.includes('quality_attributes_code_key')) {
          throw new ApiException(409, 'CONFLICT', 'Attribute code already exists');
        }
        throw err;
      });
      await this.audit.record(client, {
        action: 'catalog.quality_attribute.create', objectType: 'quality_attribute', objectId: result.rows[0].id,
        after: { code: dto.code, dataType: dto.dataType }
      });
      return result.rows[0];
    });
  }

  async createDefectType(dto: CreateDefectTypeDto): Promise<unknown> {
    return this.db.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO catalog.defect_types (code, name, defect_class, description, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, code, name, defect_class`,
        [dto.code, dto.name, dto.defectClass, dto.description ?? null, this.actor()]
      ).catch((err: Error) => {
        if (err.message.includes('defect_types_code_key')) {
          throw new ApiException(409, 'CONFLICT', 'Defect code already exists');
        }
        throw err;
      });
      await this.audit.record(client, {
        action: 'catalog.defect_type.create', objectType: 'defect_type', objectId: result.rows[0].id,
        after: { code: dto.code, defectClass: dto.defectClass }
      });
      return result.rows[0];
    });
  }

  private async nextVersion(client: PoolClient, entity: VersionedEntity, keyValues: unknown[]): Promise<number> {
    const keys = VERSIONED_KEY[entity];
    const where = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
    const result = await client.query<{ max: number | null }>(
      `SELECT max(version_no) AS max FROM catalog.${entity} WHERE ${where}`,
      keyValues
    );
    return (result.rows[0].max ?? 0) + 1;
  }

  // Overlap of new window [from, to) with any ACTIVE version's window.
  private async assertNoActiveOverlap(
    client: PoolClient, entity: VersionedEntity, keyValues: unknown[], from: string, to?: string
  ): Promise<void> {
    const keys = VERSIONED_KEY[entity];
    const where = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
    const fromParam = keys.length + 1;
    const toParam = keys.length + 2;
    const clash = await client.query(
      `SELECT 1 FROM catalog.${entity} WHERE ${where} AND status = 'ACTIVE'
       AND effective_from < COALESCE($${toParam}::timestamptz, 'infinity'::timestamptz)
       AND (effective_to IS NULL OR effective_to > $${fromParam}::timestamptz) LIMIT 1`,
      [...keyValues, from, to ?? null]
    );
    if (clash.rowCount && clash.rowCount > 0) {
      throw new ApiException(409, 'CONFLICT', 'Overlapping active version exists', { code_detail: 'VERSION_OVERLAP' });
    }
  }

  async createGradeProfile(dto: CreateGradeProfileDto): Promise<unknown> {
    this.assertDateRange(dto.effectiveFrom, dto.effectiveTo);
    const attrs = dto.rules.map((r) => r.attribute);
    const known = await this.db.query(
      `SELECT code FROM catalog.quality_attributes WHERE code = ANY($1) AND status = 'ACTIVE'`,
      [attrs]
    );
    const knownSet = new Set(known.rows.map((r) => r.code));
    const unknown = attrs.filter((a) => !knownSet.has(a));
    if (unknown.length > 0) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Unknown quality attribute codes', { unknown });
    }
    return this.db.withTransaction(async (client) => {
      const versionNo = await this.nextVersion(client, 'grade_profiles', [dto.commodityId, dto.gradeCode]);
      const status = dto.activate ? 'ACTIVE' : 'DRAFT';
      if (status === 'ACTIVE') {
        await this.assertNoActiveOverlap(client, 'grade_profiles', [dto.commodityId, dto.gradeCode],
          dto.effectiveFrom, dto.effectiveTo);
      }
      const result = await client.query(
        `INSERT INTO catalog.grade_profiles
           (commodity_id, grade_code, version_no, rules, status, effective_from, effective_to,
            change_reason, created_by, validation_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, grade_code, version_no, status`,
        [dto.commodityId, dto.gradeCode, versionNo, JSON.stringify(dto.rules), status,
         dto.effectiveFrom, dto.effectiveTo ?? null, dto.changeReason ?? null, this.actor(),
         dto.validationStatus ?? 'DEMO']
      );
      await this.audit.record(client, {
        action: 'catalog.grade_profile.create', objectType: 'grade_profile', objectId: result.rows[0].id,
        after: { gradeCode: dto.gradeCode, versionNo, status, changeReason: dto.changeReason }
      });
      if (status === 'ACTIVE') {
        await this.publish(client, 'grade_profiles', result.rows[0].id, versionNo);
      }
      return result.rows[0];
    });
  }

  async createPack(dto: CreatePackDto): Promise<unknown> {
    this.assertDateRange(dto.effectiveFrom, dto.effectiveTo);
    const scope = dto.commodityId ?? '00000000-0000-0000-0000-000000000000';
    return this.db.withTransaction(async (client) => {
      const versionNo = await this.nextVersion(client, 'pack_definitions', [dto.code, scope]);
      const status = dto.activate ? 'ACTIVE' : 'DRAFT';
      if (status === 'ACTIVE') {
        await this.assertNoActiveOverlap(client, 'pack_definitions', [dto.code, scope],
          dto.effectiveFrom, dto.effectiveTo);
      }
      const result = await client.query(
        `INSERT INTO catalog.pack_definitions
           (commodity_id, code, name, level, contains_qty, contains_uom_id, parent_pack_id, preferred_order_uom_id, version_no,
            status, effective_from, effective_to, change_reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id, code, version_no, status`,
        [dto.commodityId ?? null, dto.code, dto.name, dto.level, dto.containsQty, dto.containsUomId,
         dto.parentPackId ?? null, dto.preferredOrderUomId ?? null, versionNo, status, dto.effectiveFrom, dto.effectiveTo ?? null,
         dto.changeReason ?? null, this.actor()]
      );
      await this.audit.record(client, {
        action: 'catalog.pack.create', objectType: 'pack_definition', objectId: result.rows[0].id,
        after: { code: dto.code, versionNo, status }
      });
      if (status === 'ACTIVE') {
        await this.publish(client, 'pack_definitions', result.rows[0].id, versionNo);
      }
      return result.rows[0];
    });
  }

  async createConversion(dto: CreateConversionDto): Promise<unknown> {
    this.assertDateRange(dto.effectiveFrom, dto.effectiveTo);
    if (dto.fromUomId === dto.toUomId) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'fromUomId and toUomId must differ');
    }
    const uoms = await this.db.query(
      `SELECT id FROM catalog.units_of_measure WHERE id = ANY($1) AND status = 'ACTIVE'`,
      [[dto.fromUomId, dto.toUomId]]
    );
    if (uoms.rowCount !== 2) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Unknown or inactive unit of measure', { code_detail: 'UNKNOWN_REFERENCE' });
    }
    const scope = dto.commodityId ?? '00000000-0000-0000-0000-000000000000';
    return this.db.withTransaction(async (client) => {
      // Circular-conversion guard: reject if a path toUom → … → fromUom already exists in scope.
      const graph = await client.query(
        `SELECT from_uom_id, to_uom_id FROM catalog.unit_conversions
         WHERE COALESCE(commodity_id, '00000000-0000-0000-0000-000000000000'::uuid) = $1 AND status = 'ACTIVE'`,
        [scope]
      );
      const edges = new Map<string, string[]>();
      for (const row of graph.rows) {
        edges.set(row.from_uom_id, [...(edges.get(row.from_uom_id) ?? []), row.to_uom_id]);
      }
      const reaches = (start: string, target: string, seen: Set<string>): boolean => {
        if (start === target) {
          return true;
        }
        if (seen.has(start)) {
          return false;
        }
        seen.add(start);
        return (edges.get(start) ?? []).some((n) => reaches(n, target, seen));
      };
      if (reaches(dto.toUomId, dto.fromUomId, new Set())) {
        throw new ApiException(400, 'VALIDATION_FAILED', 'Conversion would create a circular chain', {
          code_detail: 'CIRCULAR_CONVERSION'
        });
      }
      const versionNo = await this.nextVersion(client, 'unit_conversions', [scope, dto.fromUomId, dto.toUomId]);
      const status = dto.activate ? 'ACTIVE' : 'DRAFT';
      if (status === 'ACTIVE') {
        await this.assertNoActiveOverlap(client, 'unit_conversions', [scope, dto.fromUomId, dto.toUomId],
          dto.effectiveFrom, dto.effectiveTo);
      }
      const result = await client.query(
        `INSERT INTO catalog.unit_conversions
           (commodity_id, pack_definition_id, from_uom_id, to_uom_id, factor, version_no, status,
            effective_from, effective_to, change_reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, factor, version_no, status`,
        [dto.commodityId ?? null, dto.packDefinitionId ?? null, dto.fromUomId, dto.toUomId,
         dto.factor, versionNo, status, dto.effectiveFrom, dto.effectiveTo ?? null,
         dto.changeReason ?? null, this.actor()]
      );
      await this.audit.record(client, {
        action: 'catalog.conversion.create', objectType: 'unit_conversion', objectId: result.rows[0].id,
        after: { from: dto.fromUomId, to: dto.toUomId, factor: dto.factor, versionNo, status }
      });
      if (status === 'ACTIVE') {
        await this.publish(client, 'unit_conversions', result.rows[0].id, versionNo);
      }
      return result.rows[0];
    });
  }

  async createHandlingProfile(dto: CreateHandlingProfileDto): Promise<unknown> {
    this.assertDateRange(dto.effectiveFrom, dto.effectiveTo);
    if (dto.tempMinC !== undefined && dto.tempMaxC !== undefined && dto.tempMinC > dto.tempMaxC) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'tempMinC must not exceed tempMaxC');
    }
    if (dto.humidityMinPct !== undefined && dto.humidityMaxPct !== undefined
        && dto.humidityMinPct > dto.humidityMaxPct) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'humidityMinPct must not exceed humidityMaxPct');
    }
    const scope = dto.commodityId ?? '00000000-0000-0000-0000-000000000000';
    return this.db.withTransaction(async (client) => {
      const versionNo = await this.nextVersion(client, 'handling_profiles', [dto.code, scope]);
      const status = dto.activate ? 'ACTIVE' : 'DRAFT';
      if (status === 'ACTIVE') {
        await this.assertNoActiveOverlap(client, 'handling_profiles', [dto.code, scope],
          dto.effectiveFrom, dto.effectiveTo);
      }
      const result = await client.query(
        `INSERT INTO catalog.handling_profiles
           (commodity_id, code, version_no, temp_min_c, temp_max_c, humidity_min_pct, humidity_max_pct,
            light_sensitivity, ethylene_sensitivity, hydration_note, max_holding_hours, precooling_required,
            packaging_requirements, orientation_fragility_notes, transport_restrictions, handling_group_code,
            status, effective_from, effective_to, change_reason, created_by, validation_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         RETURNING id, code, version_no, status, validation_status`,
        [dto.commodityId ?? null, dto.code, versionNo, dto.tempMinC ?? null, dto.tempMaxC ?? null,
         dto.humidityMinPct ?? null, dto.humidityMaxPct ?? null, dto.lightSensitivity ?? null,
         dto.ethyleneSensitivity ?? null, dto.hydrationNote ?? null, dto.maxHoldingHours ?? null,
         dto.precoolingRequired ?? null, dto.packagingRequirements ?? null,
         dto.orientationFragilityNotes ?? null, dto.transportRestrictions ?? null,
         dto.handlingGroupCode ?? null, status, dto.effectiveFrom, dto.effectiveTo ?? null,
         dto.changeReason ?? null, this.actor(), dto.validationStatus]
      );
      await this.audit.record(client, {
        action: 'catalog.handling_profile.create', objectType: 'handling_profile', objectId: result.rows[0].id,
        after: { code: dto.code, versionNo, status, classification: dto.validationStatus }
      });
      if (status === 'ACTIVE') {
        await this.publish(client, 'handling_profiles', result.rows[0].id, versionNo);
      }
      return result.rows[0];
    });
  }

  async createTransportRule(dto: CreateTransportRuleDto): Promise<unknown> {
    this.assertDateRange(dto.effectiveFrom, dto.effectiveTo);
    if (dto.profileAId === dto.profileBId) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Profiles must differ');
    }
    const profiles = await this.db.query(
      `SELECT id FROM catalog.handling_profiles WHERE id = ANY($1)`,
      [[dto.profileAId, dto.profileBId]]
    );
    if (profiles.rowCount !== 2) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Unknown handling profile', { code_detail: 'UNKNOWN_REFERENCE' });
    }
    return this.db.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO catalog.transport_compatibility_rules
           (profile_a_id, profile_b_id, compatible, reason, version_no, status, effective_from, effective_to, created_by)
         VALUES ($1,$2,$3,$4,1,'ACTIVE',$5,$6,$7) RETURNING id, compatible`,
        [dto.profileAId, dto.profileBId, dto.compatible, dto.reason ?? null,
         dto.effectiveFrom, dto.effectiveTo ?? null, this.actor()]
      );
      await this.audit.record(client, {
        action: 'catalog.transport_rule.create', objectType: 'transport_rule', objectId: result.rows[0].id,
        after: { a: dto.profileAId, b: dto.profileBId, compatible: dto.compatible }
      });
      return result.rows[0];
    });
  }

  async updateLaunchFlags(commodityId: string, dto: LaunchFlagsDto): Promise<unknown> {
    return this.db.withTransaction(async (client) => {
      const before = await client.query(
        `SELECT launch_enabled, launch_cities FROM catalog.commodities WHERE id = $1 AND deleted_at IS NULL`,
        [commodityId]
      );
      if (before.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Product not found');
      }
      await client.query(
        `UPDATE catalog.commodities SET launch_enabled = $2, launch_cities = $3,
           version = version + 1, updated_at = now() WHERE id = $1`,
        [commodityId, dto.launchEnabled, dto.launchCities]
      );
      await this.audit.record(client, {
        action: 'catalog.launch_flags.update', objectType: 'commodity', objectId: commodityId,
        before: before.rows[0], after: { launchEnabled: dto.launchEnabled, launchCities: dto.launchCities }
      });
      return { id: commodityId, ...dto };
    });
  }

  async changeStatus(entity: VersionedEntity | 'commodities' | 'varieties', id: string, status: string, reason?: string): Promise<unknown> {
    return this.db.withTransaction(async (client) => {
      const before = await client.query(
        `SELECT status FROM catalog.${entity} WHERE id = $1`, [id]
      );
      if (before.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Definition not found');
      }
      const isVersioned = !['commodities', 'varieties'].includes(entity);
      await client.query(
        isVersioned
          ? `UPDATE catalog.${entity} SET status = $2, change_reason = COALESCE($3, change_reason) WHERE id = $1`
          : `UPDATE catalog.${entity} SET status = $2, updated_at = now(), version = version + 1 WHERE id = $1`,
        isVersioned ? [id, status, reason ?? null] : [id, status]
      );
      await this.audit.record(client, {
        action: `catalog.${entity}.status_change`, objectType: entity, objectId: id,
        before: { status: before.rows[0].status }, after: { status, reason }
      });
      return { id, status };
    });
  }

  async listVersions(entity: VersionedEntity): Promise<{ items: unknown[] }> {
    if (!VERSIONED_KEY[entity]) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Unknown versioned entity');
    }
    const result = await this.db.query(
      `SELECT * FROM catalog.${entity} ORDER BY created_at DESC LIMIT 200`
    );
    return { items: result.rows };
  }

  async listMasters(): Promise<unknown> {
    const [attrs, defects, uoms, colours] = await Promise.all([
      this.db.query(`SELECT id, code, name, data_type, status FROM catalog.quality_attributes ORDER BY code`),
      this.db.query(`SELECT id, code, name, defect_class, status FROM catalog.defect_types ORDER BY code`),
      this.db.query(`SELECT id, code, name, status, validation_status FROM catalog.units_of_measure ORDER BY code`),
      this.db.query(`SELECT id, code, name, hex, status FROM catalog.colours ORDER BY code`)
    ]);
    return { qualityAttributes: attrs.rows, defectTypes: defects.rows, units: uoms.rows, colours: colours.rows };
  }
}
