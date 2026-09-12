import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ReferenceIdService } from '../../../common/pagination/reference-id.service';
import { MediaService } from '../../../common/media/media.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext, RequestContextData } from '../../../common/request-context';
import { claimIdempotencyKey, completeIdempotencyKey, hashRequest } from '../../../common/idempotency/idempotency.service';
import { CatalogStandards_SERVICE, CatalogStandardsService } from '../../catalog-standards/contracts';
import { OrderAllocation_SERVICE, OrderAllocationService } from '../../order-allocation/contracts';
import { AddLotMediaDto, CreateHarvestLotDto, CreateStockLotDto, LotCoreDto, ResolveHoldDto } from './dto';

@Injectable()
export class LotsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    private readonly media: MediaService,
    @Inject(CatalogStandards_SERVICE) private readonly catalog: CatalogStandardsService,
    @Inject(OrderAllocation_SERVICE) private readonly orders: OrderAllocationService
  ) {}

  private async validateMasters(dto: LotCoreDto) {
    // Server-side commercial-master eligibility (Guardrail B) for physical lots too.
    await this.catalog.assertCommercialLine({
      commodityId: dto.commodityId,
      varietyId: dto.varietyId,
      gradeProfileId: dto.gradeProfileId,
      uomId: dto.uomId
    });
    return this.catalog.getActiveHandlingProfile(dto.commodityId);
  }

  // Wholesaler/importer entry: physical stock received — no farm/forecast invented (§5).
  async createStockLot(dto: CreateStockLotDto, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const handling = await this.validateMasters(dto);
    const hash = hashRequest({ kind: 'stock', dto });
    return this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'lot.create', idemKey, hash);
      if (claim.state === 'replay') {
        return claim.responseBody;
      }
      const ref = await this.refIds.next(client, 'LOT');
      const lot = await client.query<{ id: string }>(
        `INSERT INTO supply.supply_lots
           (ref, org_id, variety_id, commodity_id, uom_id, status, source_flow, origin_type, origin_detail,
            colour_code, grade_profile_id, declared_qty, available_qty, received_at,
            handling_profile_id, handling_profile_version_no, created_by)
         VALUES ($1,$2,$3,$4,$5,'STOCK_RECEIVED','STOCK_ENTRY',$6,$7,$8,$9,$10,0,$11,$12,$13,$14) RETURNING id`,
        [ref, orgId, dto.varietyId ?? null, dto.commodityId, dto.uomId, dto.originType, dto.originDetail ?? null,
         dto.colourCode ?? null, dto.gradeProfileId ?? null, dto.declaredQty, dto.receivedAt,
         handling?.id ?? null, handling?.versionNo ?? null, ctx.userId]
      );
      await this.audit.record(client, {
        action: 'lot.create', objectType: 'supply_lot', objectId: lot.rows[0].id, objectRef: ref,
        after: { flow: 'STOCK_ENTRY', originType: dto.originType, declaredQty: dto.declaredQty }
      });
      await this.outbox.emit(client, {
        aggregateType: 'supply_lot', aggregateId: lot.rows[0].id, type: 'lot.created',
        payload: { lotId: lot.rows[0].id, orgId, originType: dto.originType }
      });
      const body = { id: lot.rows[0].id, ref, status: 'STOCK_RECEIVED' };
      await completeIdempotencyKey(client, orgId, 'lot.create', idemKey, 201, body);
      return body;
    });
  }

  // Grower entry: harvest record -> physical lot (§5, forecast optional for pilot).
  async createHarvestLot(dto: CreateHarvestLotDto, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const handling = await this.validateMasters(dto);
    const hash = hashRequest({ kind: 'harvest', dto });
    return this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'lot.create', idemKey, hash);
      if (claim.state === 'replay') {
        return claim.responseBody;
      }
      const ref = await this.refIds.next(client, 'LOT');
      const lot = await client.query<{ id: string }>(
        `INSERT INTO supply.supply_lots
           (ref, org_id, variety_id, commodity_id, uom_id, status, source_flow, origin_type, origin_detail,
            colour_code, grade_profile_id, declared_qty, available_qty, harvest_at,
            handling_profile_id, handling_profile_version_no, created_by)
         VALUES ($1,$2,$3,$4,$5,'HARVESTED','HARVEST_FLOW',$6,$7,$8,$9,$10,0,$11,$12,$13,$14) RETURNING id`,
        [ref, orgId, dto.varietyId ?? null, dto.commodityId, dto.uomId, dto.originType, dto.originDetail ?? null,
         dto.colourCode ?? null, dto.gradeProfileId ?? null, dto.declaredQty, dto.harvestedAt,
         handling?.id ?? null, handling?.versionNo ?? null, ctx.userId]
      );
      await client.query(
        `INSERT INTO supply.harvest_records
           (org_id, commodity_id, variety_id, qty, uom_id, harvested_at, farm_name, farm_block, notes, lot_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [orgId, dto.commodityId, dto.varietyId ?? null, dto.declaredQty, dto.uomId, dto.harvestedAt,
         dto.farmName ?? null, dto.farmBlock ?? null, dto.notes ?? null, lot.rows[0].id, ctx.userId]
      );
      await this.audit.record(client, {
        action: 'lot.create', objectType: 'supply_lot', objectId: lot.rows[0].id, objectRef: ref,
        after: { flow: 'HARVEST_FLOW', originType: dto.originType, declaredQty: dto.declaredQty }
      });
      await this.outbox.emit(client, {
        aggregateType: 'supply_lot', aggregateId: lot.rows[0].id, type: 'lot.created',
        payload: { lotId: lot.rows[0].id, orgId, originType: dto.originType }
      });
      const body = { id: lot.rows[0].id, ref, status: 'HARVESTED' };
      await completeIdempotencyKey(client, orgId, 'lot.create', idemKey, 201, body);
      return body;
    });
  }

  async listMine(): Promise<{ items: unknown[] }> {
    const orgId = RequestContext.requireOrgId();
    const result = await this.db.query(
      `SELECT id, variety_id, commodity_id, status, source_flow, origin_type, declared_qty,
              available_qty, reserved_qty, allocated_qty, packed_qty, dispatched_qty, delivered_qty,
              qc_accepted_qty, qc_rejected_qty, qc_held_qty, harvest_at, received_at, created_at,
              (SELECT count(*)::int FROM supply.lot_media m WHERE m.lot_id = supply_lots.id) AS media_count
       FROM supply.supply_lots WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId]
    );
    return { items: result.rows };
  }

  private async authorizeLot(ctx: RequestContextData, lot: { id: string; org_id: string }): Promise<void> {
    // Cross-org visibility is platform-operations only — org-scoped permissions
    // (order.manage, pack.manage, qc.*) never open another org's lots (§4).
    if (ctx.orgId === lot.org_id || ctx.permissions.includes('procurement.manage')) {
      return;
    }
    // Buyer whose order is fulfilled from this lot may view it (traceability §14).
    if (ctx.orgId && await this.orders.buyerHasLotAllocation(ctx.orgId, lot.id)) {
      return;
    }
    throw new ApiException(404, 'NOT_FOUND', 'Lot not found');
  }

  async get(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const lot = await this.db.query<{ id: string; org_id: string; [k: string]: unknown }>(
      `SELECT * FROM supply.supply_lots WHERE id = $1`, [id]);
    if (lot.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Lot not found');
    }
    await this.authorizeLot(ctx, lot.rows[0] as { id: string; org_id: string });
    const [media, reservations] = await Promise.all([
      this.db.query(
        `SELECT id, media_object_id, purpose, inspection_id, uploaded_by, captured_at
         FROM supply.lot_media WHERE lot_id = $1 ORDER BY captured_at`, [id]),
      this.db.query(
        `SELECT id, order_id, qty, status, created_at FROM supply.inventory_reservations
         WHERE lot_id = $1 ORDER BY created_at`, [id])
    ]);
    return { ...lot.rows[0], media: media.rows, reservations: reservations.rows };
  }

  async addMedia(lotId: string, dto: AddLotMediaDto): Promise<unknown> {
    const ctx = RequestContext.get();
    const lot = await this.db.query<{ id: string; org_id: string }>(
      `SELECT id, org_id FROM supply.supply_lots WHERE id = $1`, [lotId]);
    if (lot.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Lot not found');
    }
    const isOwner = ctx.orgId === lot.rows[0].org_id;
    const isInspector = ctx.permissions.includes('qc.inspect') || ctx.permissions.includes('procurement.manage');
    if (!isOwner && !isInspector) {
      throw new ApiException(404, 'NOT_FOUND', 'Lot not found');
    }
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO supply.lot_media (lot_id, media_object_id, purpose, inspection_id, uploaded_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [lotId, dto.mediaObjectId, dto.purpose ?? 'LOT_PHOTO', dto.inspectionId ?? null, ctx.userId]
    );
    return { id: row.rows[0].id, lotId };
  }

  // Signed short-lived URLs, minted only after object-level authorization (§8/§9).
  async getMedia(id: string): Promise<{ items: unknown[] }> {
    const ctx = RequestContext.get();
    const lot = await this.db.query<{ id: string; org_id: string }>(
      `SELECT id, org_id FROM supply.supply_lots WHERE id = $1`, [id]);
    if (lot.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Lot not found');
    }
    await this.authorizeLot(ctx, lot.rows[0]);
    const media = await this.db.query(
      `SELECT id, media_object_id, purpose, inspection_id, captured_at FROM supply.lot_media
       WHERE lot_id = $1 ORDER BY captured_at`, [id]);
    const items = await Promise.all(media.rows.map(async (m) => ({
      ...m,
      url: (await this.media.signRead(m.media_object_id, 300)).url
    })));
    return { items };
  }

  async submitForQc(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ org_id: string; status: string; declared_qty: string }>(
        `SELECT org_id, status, declared_qty FROM supply.supply_lots WHERE id = $1 FOR UPDATE`, [id]);
      const lot = locked.rows[0];
      if (!lot || ctx.orgId !== lot.org_id) {
        throw new ApiException(404, 'NOT_FOUND', 'Lot not found');
      }
      if (!['STOCK_RECEIVED', 'HARVESTED'].includes(lot.status)) {
        throw new ApiException(409, 'CONFLICT', `Lot is ${lot.status}; QC submission not allowed`, {
          code_detail: 'ILLEGAL_TRANSITION'
        });
      }
      await client.query(
        `UPDATE supply.supply_lots SET status = 'QC_PENDING', qc_submitted_qty = declared_qty WHERE id = $1`, [id]);
      await this.audit.record(client, {
        action: 'lot.submit_qc', objectType: 'supply_lot', objectId: id,
        after: { submittedQty: lot.declared_qty }
      });
      return { id, status: 'QC_PENDING', submittedQty: Number(lot.declared_qty) };
    });
  }

  // QC-hold resolution: held quantity is released to available or written off as rejected.
  async resolveHold(id: string, dto: ResolveHoldDto): Promise<unknown> {
    const ctx = RequestContext.get();
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ org_id: string; status: string; qc_held_qty: string }>(
        `SELECT org_id, status, qc_held_qty FROM supply.supply_lots WHERE id = $1 FOR UPDATE`, [id]);
      const lot = locked.rows[0];
      const ops = ctx.permissions.includes('procurement.manage') || ctx.permissions.includes('qc.inspect');
      if (!lot || (ctx.orgId !== lot.org_id && !ops)) {
        throw new ApiException(404, 'NOT_FOUND', 'Lot not found');
      }
      if (lot.status !== 'HOLD') {
        throw new ApiException(409, 'CONFLICT', `Lot is ${lot.status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      const held = Number(lot.qc_held_qty);
      if (dto.toAvailableQty + dto.toRejectedQty !== held) {
        throw new ApiException(400, 'VALIDATION_FAILED', `Resolution must account for held quantity ${held}`);
      }
      await client.query(
        `UPDATE supply.supply_lots SET qc_held_qty = 0, qc_rejected_qty = qc_rejected_qty + $2,
           available_qty = available_qty + $3, qc_accepted_qty = qc_accepted_qty + $3,
           status = CASE WHEN (available_qty + $3) > 0 THEN 'AVAILABLE' ELSE 'REJECTED' END
         WHERE id = $1`,
        [id, dto.toRejectedQty, dto.toAvailableQty]
      );
      await this.audit.record(client, {
        action: 'lot.resolve_hold', objectType: 'supply_lot', objectId: id,
        after: { toAvailable: dto.toAvailableQty, toRejected: dto.toRejectedQty, reason: dto.reason ?? null }
      });
      return { id, status: 'RESOLVED' };
    });
  }
}
