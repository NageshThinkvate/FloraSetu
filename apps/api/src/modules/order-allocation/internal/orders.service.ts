import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ReferenceIdService } from '../../../common/pagination/reference-id.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { claimIdempotencyKey, completeIdempotencyKey, hashRequest } from '../../../common/idempotency/idempotency.service';
import { DemandRfq_SERVICE, DemandRfqService } from '../../demand-rfq/contracts';
import { SupplyInventory_SERVICE, SupplyInventoryService } from '../../supply-inventory/contracts';
import { LogisticsColdchain_SERVICE, LogisticsColdchainService } from '../../logistics-coldchain/contracts';
import { assertOrderTransition, isOps } from './order-policies';
import { AcceptDeliveryDto, AllocateLotDto, ShortfallDto, TransitionOrderDto } from './dto';

const MANUAL_TRANSITIONS = ['ALLOCATING', 'QC_PACK', 'READY_FOR_DISPATCH', 'CLOSED', 'CANCELLED'];

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    @Inject(DemandRfq_SERVICE) private readonly demand: DemandRfqService,
    @Inject(SupplyInventory_SERVICE) private readonly supply: SupplyInventoryService,
    @Inject(LogisticsColdchain_SERVICE) private readonly logistics: LogisticsColdchainService
  ) {}

  // §2/§30: award -> order conversion. Idempotent (key + one-order-per-award unique index).
  async convertAward(awardId: string, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const snapshot = await this.demand.getAwardSnapshot(awardId);
    if (!snapshot || snapshot.status !== 'FINAL') {
      throw new ApiException(404, 'NOT_FOUND', 'Award not found');
    }
    if (snapshot.buyerOrgId !== orgId && !isOps(ctx)) {
      throw new ApiException(404, 'NOT_FOUND', 'Award not found');
    }
    const hash = hashRequest({ awardId });
    const outcome = await this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'order.convert', idemKey, hash);
      if (claim.state === 'replay') {
        return claim;
      }
      const existing = await client.query<{ id: string; ref: string; status: string }>(
        `SELECT id, ref, status FROM ordering.orders WHERE award_id = $1 AND deleted_at IS NULL`, [awardId]);
      if (existing.rowCount && existing.rowCount > 0) {
        const body = { id: existing.rows[0].id, ref: existing.rows[0].ref, status: existing.rows[0].status, existing: true };
        await completeIdempotencyKey(client, orgId, 'order.convert', idemKey, 201, body);
        return { state: 'fresh' as const, responseBody: body };
      }
      const ref = await this.refIds.next(client, 'ORD');
      const total = snapshot.lines.reduce((sum, l) => sum + l.awardedQty * l.unitPriceMinor, 0);
      let orderId: string;
      try {
        const order = await client.query<{ id: string }>(
          `INSERT INTO ordering.orders
             (ref, buyer_org_id, source_type, source_id, total_minor, currency, status,
              requirement_id, award_id, delivery_destination)
           VALUES ($1,$2,'AWARD',$3,$4,$5,'PENDING_CONFIRMATION',$6,$7,$8) RETURNING id`,
          [ref, snapshot.buyerOrgId, awardId, total, snapshot.lines[0]?.currency ?? 'INR',
           snapshot.requirementId, awardId, snapshot.deliveryDestination]
        );
        orderId = order.rows[0].id;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          const dup = await client.query<{ id: string; ref: string; status: string }>(
            `SELECT id, ref, status FROM ordering.orders WHERE award_id = $1`, [awardId]);
          const body = { id: dup.rows[0].id, ref: dup.rows[0].ref, status: dup.rows[0].status, existing: true };
          await completeIdempotencyKey(client, orgId, 'order.convert', idemKey, 201, body);
          return { state: 'fresh' as const, responseBody: body };
        }
        throw e;
      }
      // Order lines carry committed spec snapshots — never reconstructed from mutable masters.
      const lineIds = new Map<string, string>();
      for (const line of snapshot.lines) {
        const ol = await client.query<{ id: string }>(
          `INSERT INTO ordering.order_lines
             (order_id, variety_id, qty, agreed_unit_price_minor, currency,
              requirement_line_id, award_line_id, uom_id, spec_snapshot)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [orderId, line.acceptedSpec?.varietyId ?? null, line.awardedQty, line.unitPriceMinor,
           line.currency, line.requirementLineId, line.awardLineId, line.uomId,
           JSON.stringify({
             ...line.acceptedSpec,
             quotationVersionId: line.quotationVersionId,
             hasDeviation: line.hasDeviation,
             buyerConsent: line.hasDeviation ? snapshot.buyerConsent : null
           })]
        );
        lineIds.set(line.awardLineId, ol.rows[0].id);
      }
      const bySupplier = new Map<string, typeof snapshot.lines>();
      for (const line of snapshot.lines) {
        const arr = bySupplier.get(line.supplierOrgId) ?? [];
        arr.push(line);
        bySupplier.set(line.supplierOrgId, arr);
      }
      for (const [supplierOrgId, lines] of bySupplier) {
        const allocRef = await this.refIds.next(client, 'SAL');
        const alloc = await client.query<{ id: string }>(
          `INSERT INTO ordering.supplier_allocations
             (ref, order_id, supplier_org_id, delivery_commitment, commercial_snapshot)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [allocRef, orderId, supplierOrgId, snapshot.deliveryRequirements,
           JSON.stringify({
             conditions: snapshot.conditions,
             deliveryRequirements: snapshot.deliveryRequirements,
             lines: lines.map((l) => ({
               quotationVersionId: l.quotationVersionId, unitPriceMinor: l.unitPriceMinor, currency: l.currency
             }))
           })]
        );
        for (const line of lines) {
          await client.query(
            `INSERT INTO ordering.supplier_allocation_lines
               (allocation_id, order_line_id, quotation_version_id, awarded_qty, uom_id,
                unit_price_minor, currency, accepted_spec)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [alloc.rows[0].id, lineIds.get(line.awardLineId), line.quotationVersionId,
             line.awardedQty, line.uomId, line.unitPriceMinor, line.currency,
             JSON.stringify(line.acceptedSpec ?? {})]
          );
        }
      }
      await this.recordHistory(client, orderId, null, 'PENDING_CONFIRMATION', ctx.userId, 'award conversion');
      await this.audit.record(client, {
        action: 'order.convert', objectType: 'order', objectId: orderId, objectRef: ref,
        after: { awardId, requirementId: snapshot.requirementId, suppliers: bySupplier.size, totalMinor: total }
      });
      await this.outbox.emit(client, {
        aggregateType: 'order', aggregateId: orderId, type: 'order.created',
        payload: { orderId, awardId, buyerOrgId: snapshot.buyerOrgId }
      });
      const body = { id: orderId, ref, status: 'PENDING_CONFIRMATION', suppliers: bySupplier.size, totalMinor: total };
      await completeIdempotencyKey(client, orgId, 'order.convert', idemKey, 201, body);
      return { state: 'fresh' as const, responseBody: body, orderId, requirementId: snapshot.requirementId };
    });
    const { orderId, requirementId } = outcome as unknown as { orderId?: string; requirementId?: string };
    if (orderId && requirementId) {
      await this.demand.markRequirementConverted(requirementId, orderId).catch(() => undefined);
    }
    return outcome.responseBody;
  }

  async listMine(): Promise<{ items: unknown[] }> {
    const orgId = RequestContext.requireOrgId();
    const result = await this.db.query(
      `SELECT o.id, o.ref, o.status, o.total_minor, o.currency, o.delivery_destination, o.created_at,
              (SELECT count(*)::int FROM ordering.supplier_allocations sa WHERE sa.order_id = o.id) AS suppliers,
              (SELECT count(*)::int FROM ordering.order_lines ol WHERE ol.order_id = o.id) AS lines
       FROM ordering.orders o
       WHERE o.buyer_org_id = $1 AND o.deleted_at IS NULL ORDER BY o.created_at DESC`,
      [orgId]
    );
    return { items: result.rows };
  }

  async get(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const order = await this.db.query(
      `SELECT * FROM ordering.orders WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (order.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Order not found');
    }
    const row = order.rows[0];
    const isBuyer = ctx.orgId === row.buyer_org_id;
    if (!isBuyer && !isOps(ctx)) {
      // Supplier: own allocation slice only (§4 — never competitor data).
      const own = await this.db.query(
        `SELECT sa.id, sa.ref, sa.status, sa.delivery_commitment
         FROM ordering.supplier_allocations sa WHERE sa.order_id = $1 AND sa.supplier_org_id = $2`,
        [id, ctx.orgId]
      );
      if (own.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Order not found');
      }
      const lines = await this.db.query(
        `SELECT sal.id, sal.order_line_id, sal.awarded_qty, sal.uom_id, sal.unit_price_minor, sal.currency,
                sal.accepted_spec, sal.fulfilment_status
         FROM ordering.supplier_allocation_lines sal
         JOIN ordering.supplier_allocations sa ON sa.id = sal.allocation_id
         WHERE sa.order_id = $1 AND sa.supplier_org_id = $2`,
        [id, ctx.orgId]
      );
      const lotAllocs = await this.db.query(
        `SELECT a.id, a.lot_id, a.qty, a.supplier_allocation_line_id, a.status
         FROM ordering.allocations a
         JOIN ordering.supplier_allocation_lines sal ON sal.id = a.supplier_allocation_line_id
         JOIN ordering.supplier_allocations sa ON sa.id = sal.allocation_id
         WHERE sa.order_id = $1 AND sa.supplier_org_id = $2`,
        [id, ctx.orgId]
      );
      return {
        id: row.id, ref: row.ref, status: row.status, delivery_destination: row.delivery_destination,
        allocation: own.rows[0], lines: lines.rows, lotAllocations: lotAllocs.rows
      };
    }
    const [lines, allocations, allocLines, history, lotAllocs] = await Promise.all([
      this.db.query(`SELECT * FROM ordering.order_lines WHERE order_id = $1`, [id]),
      this.db.query(
        `SELECT id, ref, supplier_org_id, status, delivery_commitment FROM ordering.supplier_allocations
         WHERE order_id = $1`, [id]),
      this.db.query(
        `SELECT sal.*, sa.supplier_org_id FROM ordering.supplier_allocation_lines sal
         JOIN ordering.supplier_allocations sa ON sa.id = sal.allocation_id WHERE sa.order_id = $1`, [id]),
      this.db.query(
        `SELECT from_status, to_status, actor_user_id, reason, changed_at
         FROM ordering.order_status_history WHERE order_id = $1 ORDER BY changed_at`, [id]),
      this.db.query(
        `SELECT a.id, a.order_line_id, a.lot_id, a.qty, a.supplier_allocation_line_id, a.status
         FROM ordering.allocations a
         WHERE a.order_line_id IN (SELECT id FROM ordering.order_lines WHERE order_id = $1)`, [id])
    ]);
    return {
      ...row, lines: lines.rows, allocations: allocations.rows, allocationLines: allocLines.rows,
      lotAllocations: lotAllocs.rows, history: history.rows
    };
  }

  async listMyAllocations(): Promise<{ items: unknown[] }> {
    const orgId = RequestContext.requireOrgId();
    const result = await this.db.query(
      `SELECT sa.id, sa.ref, sa.status, sa.delivery_commitment, sa.created_at,
              o.id AS order_id, o.ref AS order_ref, o.delivery_destination,
              (SELECT json_agg(sal) FROM ordering.supplier_allocation_lines sal WHERE sal.allocation_id = sa.id) AS lines
       FROM ordering.supplier_allocations sa
       JOIN ordering.orders o ON o.id = sa.order_id
       WHERE sa.supplier_org_id = $1 ORDER BY sa.created_at DESC`,
      [orgId]
    );
    return { items: result.rows };
  }

  // Supplier confirms its obligation; order CONFIRMED when all suppliers confirm.
  async confirmAllocation(allocationId: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ id: string; order_id: string; supplier_org_id: string; status: string }>(
        `SELECT id, order_id, supplier_org_id, status FROM ordering.supplier_allocations WHERE id = $1 FOR UPDATE`,
        [allocationId]
      );
      const alloc = locked.rows[0];
      if (!alloc || alloc.supplier_org_id !== orgId) {
        throw new ApiException(404, 'NOT_FOUND', 'Allocation not found');
      }
      if (alloc.status !== 'PENDING_CONFIRMATION') {
        throw new ApiException(409, 'CONFLICT', `Allocation is ${alloc.status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      await client.query(
        `UPDATE ordering.supplier_allocations SET status = 'CONFIRMED', version = version + 1, updated_at = now()
         WHERE id = $1`, [allocationId]);
      await client.query(
        `UPDATE ordering.supplier_allocation_lines SET fulfilment_status = 'LOT_CONFIRMED'
         WHERE allocation_id = $1 AND fulfilment_status = 'OPEN'`, [allocationId]);
      const openAllocs = await client.query(
        `SELECT 1 FROM ordering.supplier_allocations WHERE order_id = $1 AND status = 'PENDING_CONFIRMATION'`,
        [alloc.order_id]);
      if (openAllocs.rowCount === 0) {
        await this.transitionLocked(client, alloc.order_id, 'CONFIRMED', ctx.userId, 'all suppliers confirmed');
      }
      await this.audit.record(client, {
        action: 'order.allocation.confirm', objectType: 'supplier_allocation', objectId: allocationId,
        after: { orderId: alloc.order_id }
      });
      await this.outbox.emit(client, {
        aggregateType: 'supplier_allocation', aggregateId: allocationId, type: 'order.allocation.confirmed',
        payload: { allocationId, supplierOrgId: orgId }
      });
      return { id: allocationId, status: 'CONFIRMED' };
    });
  }

  // Manual transitions: ALLOCATING / QC_PACK / READY_FOR_DISPATCH / CLOSED / CANCELLED.
  async transition(orderId: string, dto: TransitionOrderDto): Promise<unknown> {
    const ctx = RequestContext.get();
    if (!MANUAL_TRANSITIONS.includes(dto.to)) {
      throw new ApiException(400, 'VALIDATION_FAILED', `Transition ${dto.to} is driven by domain events`, {
        code_detail: 'ILLEGAL_TRANSITION'
      });
    }
    return this.db.withTransaction(async (client) => {
      const order = await this.lockOwn(client, orderId, ctx);
      if (dto.to === 'ALLOCATING') {
        const unconfirmed = await client.query(
          `SELECT 1 FROM ordering.supplier_allocations WHERE order_id = $1 AND status = 'PENDING_CONFIRMATION'`,
          [orderId]);
        if (unconfirmed.rowCount && unconfirmed.rowCount > 0) {
          throw new ApiException(409, 'CONFLICT', 'Suppliers have not all confirmed yet', { code_detail: 'PREREQUISITE_MISSING' });
        }
      }
      if (dto.to === 'READY_FOR_DISPATCH') {
        const unpacked = await client.query(
          `SELECT 1 FROM ordering.supplier_allocation_lines sal
           JOIN ordering.supplier_allocations sa ON sa.id = sal.allocation_id
           WHERE sa.order_id = $1 AND sal.fulfilment_status NOT IN ('PACKED','DISPATCHED','DELIVERED','CANCELLED')`,
          [orderId]);
        if (unpacked.rowCount && unpacked.rowCount > 0) {
          throw new ApiException(409, 'CONFLICT', 'Lines are not fully packed', { code_detail: 'PREREQUISITE_MISSING' });
        }
      }
      if (dto.to === 'CANCELLED') {
        // Allocation-vs-cancellation: release every open reservation under the order lock.
        await this.supply.releaseForOrder(client, orderId, dto.reason ?? 'order cancelled');
        await client.query(
          `UPDATE ordering.allocations SET status = 'RELEASED' WHERE order_line_id IN
             (SELECT id FROM ordering.order_lines WHERE order_id = $1) AND status = 'ALLOCATED'`, [orderId]);
        await client.query(
          `UPDATE ordering.supplier_allocations SET status = 'CANCELLED', updated_at = now()
           WHERE order_id = $1 AND status <> 'CANCELLED'`, [orderId]);
      }
      await this.transitionLocked(client, orderId, dto.to, ctx.userId, dto.reason);
      return { id: orderId, status: dto.to, from: order.status };
    });
  }

  // Buyer acceptance (§19): accepted and disputed quantities stay separate.
  async acceptDelivery(orderId: string, dto: AcceptDeliveryDto): Promise<unknown> {
    const ctx = RequestContext.get();
    return this.db.withTransaction(async (client) => {
      const order = await this.lockOwn(client, orderId, ctx, true);
      if (!['DELIVERED', 'ACCEPTANCE_PENDING'].includes(order.status)) {
        throw new ApiException(409, 'CONFLICT', `Order is ${order.status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      // ADR-002/§21: an open severe temperature exception holds buyer acceptance.
      if (await this.logistics.hasBlockingException(orderId)) {
        throw new ApiException(409, 'CONFLICT',
          'Delivery acceptance is on HOLD pending operations review of a shipment exception',
          { code_detail: 'DELIVERY_HOLD' });
      }
      const disputed = dto.disputedQty ?? 0;
      await client.query(
        `UPDATE ordering.orders SET accepted_qty = $2, disputed_qty = $3, accepted_at = now(), accepted_by = $4,
           version = version + 1, updated_at = now() WHERE id = $1`,
        [orderId, dto.acceptedQty, disputed, ctx.userId]);
      if (order.status === 'DELIVERED') {
        await this.transitionLocked(client, orderId, 'ACCEPTANCE_PENDING', ctx.userId, 'POD received');
      }
      let final = 'ACCEPTANCE_PENDING';
      if (disputed === 0) {
        await this.transitionLocked(client, orderId, 'ACCEPTED', ctx.userId, dto.reason ?? 'buyer accepted');
        final = 'ACCEPTED';
      }
      await this.audit.record(client, {
        action: 'order.accept', objectType: 'order', objectId: orderId,
        after: { acceptedQty: dto.acceptedQty, disputedQty: disputed, reason: dto.reason ?? null }
      });
      return { id: orderId, status: final, acceptedQty: dto.acceptedQty, disputedQty: disputed };
    });
  }

  // Lot allocation into an order line (§13/§14): transactional via supply contract.
  async allocateLot(dto: AllocateLotDto, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const hash = hashRequest({ dto });
    return this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'order.allocate', idemKey, hash);
      if (claim.state === 'replay') {
        return claim.responseBody;
      }
      const line = await client.query<{
        id: string; allocation_id: string; order_line_id: string; awarded_qty: string; uom_id: string;
        fulfilment_status: string; supplier_org_id: string; order_id: string;
      }>(
        `SELECT sal.id, sal.allocation_id, sal.order_line_id, sal.awarded_qty, sal.uom_id,
                sal.fulfilment_status, sa.supplier_org_id, sa.order_id
         FROM ordering.supplier_allocation_lines sal
         JOIN ordering.supplier_allocations sa ON sa.id = sal.allocation_id
         WHERE sal.id = $1 FOR UPDATE OF sal`,
        [dto.supplierAllocationLineId]
      );
      if (line.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Allocation line not found');
      }
      const l = line.rows[0];
      const order = await client.query<{ status: string; buyer_org_id: string; ref: string }>(
        `SELECT status, buyer_org_id, ref FROM ordering.orders WHERE id = $1 FOR UPDATE`, [l.order_id]);
      if (order.rows[0].buyer_org_id !== orgId && !isOps(ctx)) {
        throw new ApiException(404, 'NOT_FOUND', 'Allocation line not found');
      }
      if (!['CONFIRMED', 'ALLOCATING', 'SUPPLY_CONFIRMED'].includes(order.rows[0].status)) {
        throw new ApiException(409, 'CONFLICT', `Order is ${order.rows[0].status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      if (!['LOT_CONFIRMED', 'OPEN'].includes(l.fulfilment_status)) {
        throw new ApiException(409, 'CONFLICT', `Line is ${l.fulfilment_status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      const allocated = await client.query<{ total: string | null }>(
        `SELECT SUM(qty) AS total FROM ordering.allocations
         WHERE supplier_allocation_line_id = $1 AND status <> 'RELEASED'`,
        [l.id]);
      const remaining = Number(l.awarded_qty) - Number(allocated.rows[0].total ?? 0);
      if (dto.qty > remaining) {
        throw new ApiException(409, 'CONFLICT', `Allocation exceeds remaining line quantity (${remaining})`, {
          code_detail: 'EXCEEDS_REQUIREMENT', remaining
        });
      }
      // ADR-001: supply context transactionally reserves + allocates against lot balances.
      const { reservationId } = await this.supply.reserveAndAllocate(client, {
        lotId: dto.lotId, qty: dto.qty, uomId: l.uom_id, orderId: l.order_id,
        orderOrgId: order.rows[0].buyer_org_id, ownerRef: order.rows[0].ref,
        supplierAllocationLineId: l.id, supplierOrgId: l.supplier_org_id, createdBy: ctx.userId ?? null
      });
      await client.query(
        `INSERT INTO ordering.allocations
           (order_line_id, lot_id, qty, supplier_allocation_line_id, reservation_id, uom_id, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'ALLOCATED',$7)`,
        [l.order_line_id, dto.lotId, dto.qty, l.id, reservationId, l.uom_id, ctx.userId]
      );
      if (order.rows[0].status === 'CONFIRMED') {
        await this.transitionLocked(client, l.order_id, 'ALLOCATING', ctx.userId, 'first lot allocation');
      }
      const covered = Number(allocated.rows[0].total ?? 0) + dto.qty >= Number(l.awarded_qty);
      if (covered) {
        await client.query(
          `UPDATE ordering.supplier_allocation_lines SET fulfilment_status = 'ALLOCATED' WHERE id = $1`, [l.id]);
        const openLines = await client.query(
          `SELECT 1 FROM ordering.supplier_allocation_lines sal
           JOIN ordering.supplier_allocations sa ON sa.id = sal.allocation_id
           WHERE sa.order_id = $1 AND sal.fulfilment_status NOT IN ('ALLOCATED','PACKED','DISPATCHED','DELIVERED','CANCELLED')`,
          [l.order_id]);
        if (openLines.rowCount === 0) {
          await this.transitionLocked(client, l.order_id, 'SUPPLY_CONFIRMED', ctx.userId, 'all lines allocated');
        }
      }
      await this.audit.record(client, {
        action: 'order.allocate', objectType: 'supplier_allocation_line', objectId: l.id,
        after: { lotId: dto.lotId, qty: dto.qty, reservationId, lineCovered: covered }
      });
      const body = { supplierAllocationLineId: l.id, lotId: dto.lotId, qty: dto.qty, reservationId, lineCovered: covered };
      await completeIdempotencyKey(client, orgId, 'order.allocate', idemKey, 201, body);
      return body;
    });
  }

  async markShortfall(lineId: string, dto: ShortfallDto): Promise<unknown> {
    return this.db.withTransaction(async (client) => {
      const line = await client.query<{ id: string; fulfilment_status: string; order_id: string }>(
        `SELECT sal.id, sal.fulfilment_status, sa.order_id
         FROM ordering.supplier_allocation_lines sal
         JOIN ordering.supplier_allocations sa ON sa.id = sal.allocation_id
         WHERE sal.id = $1 FOR UPDATE OF sal`, [lineId]);
      if (line.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Allocation line not found');
      }
      if (['PACKED', 'DISPATCHED', 'DELIVERED'].includes(line.rows[0].fulfilment_status)) {
        throw new ApiException(409, 'CONFLICT', `Line already ${line.rows[0].fulfilment_status}`);
      }
      await client.query(
        `UPDATE ordering.supplier_allocation_lines SET fulfilment_status = 'SHORT' WHERE id = $1`, [lineId]);
      await this.audit.record(client, {
        action: 'order.line.shortfall', objectType: 'supplier_allocation_line', objectId: lineId,
        after: { note: dto.note ?? null }
      });
      return { id: lineId, status: 'SHORT' };
    });
  }

  private async lockOwn(client: PoolClient, orderId: string, ctx: { orgId?: string; userId?: string; permissions: string[] }, buyerOnly = false) {
    const locked = await client.query<{ id: string; buyer_org_id: string; status: string }>(
      `SELECT id, buyer_org_id, status FROM ordering.orders WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [orderId]);
    const order = locked.rows[0];
    if (!order || (buyerOnly ? ctx.orgId !== order.buyer_org_id
        : (ctx.orgId !== order.buyer_org_id && !isOps(ctx as never)))) {
      throw new ApiException(404, 'NOT_FOUND', 'Order not found');
    }
    return order;
  }

  private async transitionLocked(client: PoolClient, orderId: string, to: string, actor: string | undefined, reason?: string) {
    const current = await client.query<{ status: string }>(
      `SELECT status FROM ordering.orders WHERE id = $1 FOR UPDATE`, [orderId]);
    const from = current.rows[0].status;
    assertOrderTransition(from, to);
    await client.query(
      `UPDATE ordering.orders SET status = $2, version = version + 1, updated_at = now(),
         closed_at = CASE WHEN $2 IN ('CLOSED','CANCELLED') THEN now() ELSE closed_at END,
         cancel_reason = CASE WHEN $2 = 'CANCELLED' THEN $3 ELSE cancel_reason END
       WHERE id = $1`,
      [orderId, to, reason ?? null]
    );
    await this.recordHistory(client, orderId, from, to, actor, reason);
    await this.outbox.emit(client, {
      aggregateType: 'order', aggregateId: orderId, type: 'order.transition',
      payload: { orderId, from, to }
    });
  }

  private async recordHistory(client: PoolClient, orderId: string, from: string | null, to: string, actor?: string, reason?: string) {
    await client.query(
      `INSERT INTO ordering.order_status_history (order_id, from_status, to_status, actor_user_id, reason)
       VALUES ($1,$2,$3,$4,$5)`,
      [orderId, from, to, actor ?? null, reason ?? null]
    );
  }
}
