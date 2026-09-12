import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ReferenceIdService } from '../../../common/pagination/reference-id.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { claimIdempotencyKey, completeIdempotencyKey, hashRequest } from '../../../common/idempotency/idempotency.service';
import { OrderAllocation_SERVICE, OrderAllocationService } from '../../order-allocation/contracts';
import { SupplyInventory_SERVICE, SupplyInventoryService } from '../../supply-inventory/contracts';
import { QualityTraceability_SERVICE, QualityTraceabilityService } from '../../quality-traceability/contracts';
import { CreatePackDto } from './dto';

@Injectable()
export class PackingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    @Inject(OrderAllocation_SERVICE) private readonly orders: OrderAllocationService,
    @Inject(SupplyInventory_SERVICE) private readonly supply: SupplyInventoryService,
    @Inject(QualityTraceability_SERVICE) private readonly quality: QualityTraceabilityService
  ) {}

  // §15: pilot packing evidence. packed <= allocated enforced via line state + lot balances.
  async create(dto: CreatePackDto, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const line = await this.orders.getAllocationLineState(dto.supplierAllocationLineId);
    if (!line || line.orderId !== dto.orderId) {
      throw new ApiException(404, 'NOT_FOUND', 'Allocation line not found');
    }
    const ops = ctx.permissions.includes('procurement.manage');
    if (line.supplierOrgId !== orgId && !ops) {
      throw new ApiException(404, 'NOT_FOUND', 'Allocation line not found');
    }
    if (line.fulfilmentStatus !== 'ALLOCATED') {
      throw new ApiException(409, 'CONFLICT', `Line is ${line.fulfilmentStatus}; packing requires ALLOCATED`, {
        code_detail: 'ILLEGAL_TRANSITION'
      });
    }
    if (line.packedQty + dto.packedQty > line.allocatedQty) {
      throw new ApiException(409, 'CONFLICT', 'Packed quantity exceeds allocated quantity', {
        code_detail: 'EXCEEDS_ALLOCATED', allocated: line.allocatedQty, alreadyPacked: line.packedQty
      });
    }
    const hash = hashRequest({ dto });
    const outcome = await this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'pack.create', idemKey, hash);
      if (claim.state === 'replay') {
        return claim;
      }
      const ref = await this.refIds.next(client, 'PCK');
      const pack = await client.query<{ id: string }>(
        `INSERT INTO logistics.pack_records
           (ref, org_id, order_id, lot_id, supplier_allocation_line_id, pack_type, bunch_count,
            carton_count, packed_qty, uom_id, label_ref, seal_ref, storage_condition_note, packed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [ref, orgId, dto.orderId, dto.lotId, dto.supplierAllocationLineId, dto.packType ?? null,
         dto.bunchCount ?? null, dto.cartonCount ?? null, dto.packedQty, dto.uomId,
         dto.labelRef ?? null, dto.sealRef ?? null, dto.storageConditionNote ?? null, ctx.userId]
      );
      await this.audit.record(client, {
        action: 'pack.create', objectType: 'pack_record', objectId: pack.rows[0].id, objectRef: ref,
        after: { lotId: dto.lotId, lineId: dto.supplierAllocationLineId, packedQty: dto.packedQty }
      });
      const body = { id: pack.rows[0].id, ref };
      // Lot balance + line fulfilment + custody join this transaction (atomic chain).
      await this.supply.applyPacking(dto.lotId, dto.packedQty, ctx.userId, client);
      if (line.packedQty + dto.packedQty >= line.allocatedQty) {
        await this.orders.applyLineFulfilment(dto.supplierAllocationLineId, 'PACKED', ctx.userId, client);
      }
      await this.quality.recordCustody({
        lotId: dto.lotId, orderId: dto.orderId, fromOrgId: orgId, toOrgId: null,
        eventType: 'PACKED', actorUserId: ctx.userId,
        conditionNote: dto.storageConditionNote ?? `Packed ${dto.packedQty} (${dto.packType ?? 'standard'})`
      }, client);
      await completeIdempotencyKey(client, orgId, 'pack.create', idemKey, 201, body);
      return { state: 'fresh' as const, responseBody: body };
    });
    if (outcome.state === 'replay') {
      return { ...outcome.responseBody as object, replayed: true };
    }
    return outcome.responseBody;
  }

  async listForOrder(orderId: string): Promise<{ items: unknown[] }> {
    const ctx = RequestContext.get();
    const snapshot = await this.orders.getOrderSnapshot(orderId);
    const ops = ctx.permissions.includes('procurement.manage');
    if (!snapshot || (ctx.orgId !== snapshot.buyerOrgId && !snapshot.supplierOrgIds.includes(ctx.orgId ?? '') && !ops)) {
      throw new ApiException(404, 'NOT_FOUND', 'Order not found');
    }
    const rows = await this.db.query(
      `SELECT * FROM logistics.pack_records WHERE order_id = $1 ORDER BY packed_at`, [orderId]);
    return { items: rows.rows };
  }
}
