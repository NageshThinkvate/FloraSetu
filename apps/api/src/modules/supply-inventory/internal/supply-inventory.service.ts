import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../common/database/database.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { LotEvidence, LotSnapshot, ReserveInput, SupplyInventoryService } from '../contracts';
import { MediaService } from '../../../common/media/media.service';

@Injectable()
export class SupplyInventoryServiceImpl implements SupplyInventoryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService,
    private readonly media: MediaService
  ) {}

  contextKey(): 'supply-inventory' {
    return 'supply-inventory';
  }

  async getLotSnapshot(lotId: string): Promise<LotSnapshot | null> {
    const r = await this.db.query(
      `SELECT id, org_id, status, commodity_id, variety_id, uom_id, declared_qty, available_qty,
              allocated_qty, qc_accepted_qty, grade_profile_id, origin_type
       FROM supply.supply_lots WHERE id = $1`, [lotId]);
    if (r.rowCount === 0) {
      return null;
    }
    const l = r.rows[0];
    return {
      id: l.id, ref: null, orgId: l.org_id, status: l.status,
      commodityId: l.commodity_id, varietyId: l.variety_id, uomId: l.uom_id,
      declaredQty: l.declared_qty === null ? null : Number(l.declared_qty),
      availableQty: Number(l.available_qty), allocatedQty: Number(l.allocated_qty),
      qcAcceptedQty: l.qc_accepted_qty === null ? null : Number(l.qc_accepted_qty),
      gradeProfileId: l.grade_profile_id, originType: l.origin_type
    };
  }

  // ADR-011 Phase 3: evidence for the buyer's order evidence pack. Signed URLs are
  // minted here; the CALLER (order-allocation) performs object-level authorization.
  async getLotEvidence(lotId: string): Promise<LotEvidence | null> {
    const r = await this.db.query<{
      id: string; ref: string; status: string; quality_basis: string; declared_qty: string | null;
      uom_id: string | null; declared_stem_length_cm: string | null; bloom_stage: string | null;
      batch_ref: string | null; declaration_notes: string | null; declared_at: string | null;
      harvest_at: string | null; received_at: string | null; origin_type: string | null;
    }>(
      `SELECT id, ref, status, quality_basis, declared_qty, uom_id, declared_stem_length_cm,
              bloom_stage, batch_ref, declaration_notes, declared_at, harvest_at, received_at, origin_type
       FROM supply.supply_lots WHERE id = $1`, [lotId]);
    if (r.rowCount === 0) {
      return null;
    }
    const l = r.rows[0];
    const media = await this.db.query<{
      id: string; purpose: string; captured_at: string; media_object_id: string; content_type: string;
    }>(
      `SELECT lm.id, lm.purpose, lm.captured_at, lm.media_object_id, mo.content_type
       FROM supply.lot_media lm JOIN core.media_objects mo ON mo.id = lm.media_object_id
       WHERE lm.lot_id = $1 ORDER BY lm.captured_at`, [lotId]);
    const items = await Promise.all(media.rows.map(async (m) => ({
      id: m.id, purpose: m.purpose, contentType: m.content_type,
      capturedAt: m.captured_at, url: (await this.media.signRead(m.media_object_id, 300)).url
    })));
    return {
      id: l.id, ref: l.ref, status: l.status, qualityBasis: l.quality_basis,
      declaredQty: l.declared_qty === null ? null : Number(l.declared_qty), uomId: l.uom_id,
      declaredStemLengthCm: l.declared_stem_length_cm === null ? null : Number(l.declared_stem_length_cm),
      bloomStage: l.bloom_stage, batchRef: l.batch_ref, declarationNotes: l.declaration_notes,
      declaredAt: l.declared_at, harvestAt: l.harvest_at, receivedAt: l.received_at,
      originType: l.origin_type, media: items
    };
  }

  // ADR-001 + §13/§14: reservation and allocation commit inside the caller's transaction.
  async reserveAndAllocate(client: PoolClient, input: ReserveInput): Promise<{ reservationId: string }> {
    const locked = await client.query<{
      status: string; org_id: string; available_qty: string; reserved_qty: string; allocated_qty: string; uom_id: string;
    }>(`SELECT status, org_id, available_qty, reserved_qty, allocated_qty, uom_id
        FROM supply.supply_lots WHERE id = $1 FOR UPDATE`,
      [input.lotId]);
    const lot = locked.rows[0];
    if (!lot || !['AVAILABLE', 'RESERVED'].includes(lot.status)) {
      throw new ApiException(409, 'CONFLICT', 'Lot is not available for allocation', {
        code_detail: 'LOT_NOT_AVAILABLE'
      });
    }
    if (lot.org_id !== input.supplierOrgId) {
      throw new ApiException(409, 'CONFLICT', 'Lot does not belong to the allocated supplier', {
        code_detail: 'LOT_SUPPLIER_MISMATCH'
      });
    }
    if (lot.uom_id !== input.uomId) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Lot UoM does not match the order line UoM');
    }
    // ADR-001 frozen invariant: reserved + allocated <= available (available = gross QC pool).
    const free = Number(lot.available_qty) - Number(lot.reserved_qty) - Number(lot.allocated_qty);
    if (free < input.qty) {
      throw new ApiException(409, 'CONFLICT', `Lot has only ${free} allocatable`, {
        code_detail: 'OVERSOLD', available: free
      });
    }
    const reservation = await client.query<{ id: string }>(
      `INSERT INTO supply.inventory_reservations
         (lot_id, org_id, owner_ref, qty, status, order_id, supplier_allocation_line_id, uom_id, created_by)
       VALUES ($1,$2,$3,$4,'COMMITTED',$5,$6,$7,$8) RETURNING id`,
      [input.lotId, input.orderOrgId, input.ownerRef, input.qty, input.orderId, input.supplierAllocationLineId,
       input.uomId, input.createdBy]
    );
    await client.query(
      `UPDATE supply.supply_lots SET allocated_qty = allocated_qty + $2,
         status = CASE WHEN available_qty - reserved_qty - allocated_qty - $2 > 0 THEN 'AVAILABLE' ELSE 'RESERVED' END
       WHERE id = $1`,
      [input.lotId, input.qty]
    );
    await this.outbox.emit(client, {
      aggregateType: 'supply_lot', aggregateId: input.lotId, type: 'lot.allocated',
      payload: { lotId: input.lotId, orderId: input.orderId, qty: input.qty }
    });
    return { reservationId: reservation.rows[0].id };
  }

  async releaseForOrder(client: PoolClient, orderId: string, reason: string): Promise<void> {
    const open = await client.query<{ id: string; lot_id: string; qty: string }>(
      `SELECT id, lot_id, qty FROM supply.inventory_reservations
       WHERE order_id = $1 AND status IN ('HELD','COMMITTED') FOR UPDATE`, [orderId]);
    for (const r of open.rows) {
      await client.query(
        `UPDATE supply.inventory_reservations SET status = 'RELEASED', released_at = now(), release_reason = $2
         WHERE id = $1`, [r.id, reason]);
      await client.query(
        `UPDATE supply.supply_lots SET allocated_qty = GREATEST(allocated_qty - $2, 0), status = 'AVAILABLE'
         WHERE id = $1`, [r.lot_id, r.qty]);
    }
  }

  // §11: accepted -> available; rejected never available; held blocks allocation (HOLD).
  async applyQcResult(lotId: string, result: { accepted: number; rejected: number; held: number }, actorUserId: string) {
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ status: string; qc_submitted_qty: string }>(
        `SELECT status, qc_submitted_qty FROM supply.supply_lots WHERE id = $1 FOR UPDATE`, [lotId]);
      const lot = locked.rows[0];
      if (!lot || lot.status !== 'QC_PENDING') {
        throw new ApiException(409, 'CONFLICT', 'Lot is not awaiting QC', { code_detail: 'ILLEGAL_TRANSITION' });
      }
      const submitted = Number(lot.qc_submitted_qty);
      if (result.accepted + result.rejected + result.held !== submitted) {
        throw new ApiException(400, 'VALIDATION_FAILED',
          `QC outcome (${result.accepted}+${result.rejected}+${result.held}) must equal submitted ${submitted}`);
      }
      const status = result.held > 0 ? 'HOLD' : result.accepted > 0 ? 'AVAILABLE' : 'REJECTED';
      await client.query(
        `UPDATE supply.supply_lots SET qc_accepted_qty = $2, qc_rejected_qty = $3, qc_held_qty = $4,
           available_qty = $2, status = $5 WHERE id = $1`,
        [lotId, result.accepted, result.rejected, result.held, status]
      );
      await this.outbox.emit(client, {
        aggregateType: 'supply_lot', aggregateId: lotId, type: 'lot.qc_applied',
        payload: { lotId, ...result }
      });
      void actorUserId;
      return { status };
    });
  }

  async applyPacking(lotId: string, qty: number, actorUserId?: string, tx?: PoolClient): Promise<void> {
    await this.applyBalance(lotId, qty, 'packed', tx);
    void actorUserId;
  }

  async applyDispatch(lotId: string, qty: number, actorUserId?: string, tx?: PoolClient): Promise<void> {
    await this.applyBalance(lotId, qty, 'dispatched', tx);
    void actorUserId;
  }

  async applyDelivery(lotId: string, qty: number, actorUserId?: string, tx?: PoolClient): Promise<void> {
    await this.applyBalance(lotId, qty, 'delivered', tx);
    void actorUserId;
  }

  // When tx is provided the mutation joins the caller's transaction so multi-context
  // fulfilment chains (pack/dispatch/POD) commit or roll back atomically.
  private async applyBalance(lotId: string, qty: number, kind: 'packed' | 'dispatched' | 'delivered', tx?: PoolClient) {
    const run = async (client: PoolClient): Promise<void> => {
      const locked = await client.query<{
        status: string; packed_qty: string; dispatched_qty: string; delivered_qty: string; allocated_qty: string;
      }>(
        `SELECT status, packed_qty, dispatched_qty, delivered_qty, allocated_qty
         FROM supply.supply_lots WHERE id = $1 FOR UPDATE`, [lotId]);
      const lot = locked.rows[0];
      if (!lot) {
        throw new ApiException(404, 'NOT_FOUND', 'Lot not found');
      }
      if (lot.status === 'HOLD') {
        throw new ApiException(409, 'CONFLICT', 'Lot is on QC hold', { code_detail: 'LOT_ON_HOLD' });
      }
      if (kind === 'packed' && Number(lot.packed_qty) + qty > Number(lot.allocated_qty)) {
        throw new ApiException(409, 'CONFLICT', 'Packed quantity exceeds allocated quantity', { code_detail: 'EXCEEDS_ALLOCATED' });
      }
      if (kind === 'dispatched' && Number(lot.dispatched_qty) + qty > Number(lot.packed_qty)) {
        throw new ApiException(409, 'CONFLICT', 'Dispatch quantity exceeds packed quantity', { code_detail: 'EXCEEDS_PACKED' });
      }
      if (kind === 'delivered' && Number(lot.delivered_qty) + qty > Number(lot.dispatched_qty)) {
        throw new ApiException(409, 'CONFLICT', 'Delivered quantity exceeds dispatched quantity', { code_detail: 'EXCEEDS_DISPATCHED' });
      }
      const statusExpr = kind === 'packed'
        ? `CASE WHEN packed_qty + $2 >= allocated_qty AND allocated_qty > 0 THEN 'PACKED' ELSE status END`
        : kind === 'dispatched' ? `'DISPATCHED'` : `'DELIVERED'`;
      const extra = kind === 'dispatched' ? ', allocated_qty = GREATEST(allocated_qty - $2, 0)' : '';
      await client.query(
        `UPDATE supply.supply_lots SET ${kind}_qty = ${kind}_qty + $2, status = ${statusExpr}${extra}
         WHERE id = $1`,
        [lotId, qty]
      );
      await client.query(
        `UPDATE supply.inventory_reservations SET status = 'CONSUMED'
         WHERE lot_id = $1 AND status = 'COMMITTED' AND $2::text = 'dispatched'`, [lotId, kind]
      );
    };
    if (tx) {
      await run(tx);
      return;
    }
    await this.db.withTransaction(run);
  }

  async attachLotMedia(lotId: string, mediaObjectId: string, purpose: string, inspectionId: string | null, uploadedBy: string | undefined): Promise<void> {
    await this.db.query(
      `INSERT INTO supply.lot_media (lot_id, media_object_id, purpose, inspection_id, uploaded_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [lotId, mediaObjectId, purpose, inspectionId, uploadedBy ?? null]
    );
  }

  async listQcQueue(): Promise<LotSnapshot[]> {
    const r = await this.db.query(
      `SELECT id, org_id, status, commodity_id, variety_id, uom_id, declared_qty, available_qty,
              allocated_qty, qc_accepted_qty, grade_profile_id, origin_type
       FROM supply.supply_lots WHERE status = 'QC_PENDING' ORDER BY created_at LIMIT 100`);
    return r.rows.map((l) => ({
      id: l.id, ref: null, orgId: l.org_id, status: l.status,
      commodityId: l.commodity_id, varietyId: l.variety_id, uomId: l.uom_id,
      declaredQty: l.declared_qty === null ? null : Number(l.declared_qty),
      availableQty: Number(l.available_qty), allocatedQty: Number(l.allocated_qty),
      qcAcceptedQty: l.qc_accepted_qty === null ? null : Number(l.qc_accepted_qty),
      gradeProfileId: l.grade_profile_id, originType: l.origin_type
    }));
  }

  async pilotExceptions(): Promise<Record<string, unknown[]>> {    const [awaitingQc, onHold, packedNotDispatched] = await Promise.all([
      this.db.query(
        `SELECT id, org_id, declared_qty, created_at FROM supply.supply_lots
         WHERE status = 'QC_PENDING' ORDER BY created_at LIMIT 50`),
      this.db.query(
        `SELECT id, org_id, qc_held_qty FROM supply.supply_lots WHERE status = 'HOLD' LIMIT 50`),
      this.db.query(
        `SELECT id, org_id, packed_qty, dispatched_qty FROM supply.supply_lots
         WHERE status = 'PACKED' AND packed_qty > dispatched_qty LIMIT 50`)
    ]);
    return {
      lotAwaitingQc: awaitingQc.rows,
      qcHoldOrReject: onHold.rows,
      packedAwaitingDispatch: packedNotDispatched.rows
    };
  }
}
