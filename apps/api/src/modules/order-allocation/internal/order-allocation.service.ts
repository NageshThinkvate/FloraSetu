import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../common/database/database.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { OrderAllocationService, OrderSnapshot } from '../contracts';
import { assertLineTransition, assertOrderTransition } from './order-policies';

@Injectable()
export class OrderAllocationServiceImpl implements OrderAllocationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly outbox: OutboxService
  ) {}

  contextKey(): 'order-allocation' {
    return 'order-allocation';
  }

  async getOrderSnapshot(orderId: string): Promise<OrderSnapshot | null> {
    const order = await this.db.query(
      `SELECT id, ref, status, buyer_org_id, award_id, requirement_id, delivery_destination,
              accepted_qty, disputed_qty
       FROM ordering.orders WHERE id = $1 AND deleted_at IS NULL`, [orderId]);
    if (order.rowCount === 0) {
      return null;
    }
    const suppliers = await this.db.query(
      `SELECT supplier_org_id FROM ordering.supplier_allocations WHERE order_id = $1`, [orderId]);
    const o = order.rows[0];
    return {
      id: o.id, ref: o.ref, status: o.status, buyerOrgId: o.buyer_org_id,
      awardId: o.award_id, requirementId: o.requirement_id,
      deliveryDestination: o.delivery_destination,
      supplierOrgIds: suppliers.rows.map((s) => s.supplier_org_id),
      acceptedQty: o.accepted_qty === null ? null : Number(o.accepted_qty),
      disputedQty: o.disputed_qty === null ? null : Number(o.disputed_qty)
    };
  }

  async orderExistsForAward(awardId: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM ordering.orders WHERE award_id = $1 AND deleted_at IS NULL`, [awardId]);
    return (r.rowCount ?? 0) > 0;
  }

  async convertedAwardIds(): Promise<string[]> {
    const r = await this.db.query(
      `SELECT award_id FROM ordering.orders WHERE award_id IS NOT NULL AND deleted_at IS NULL`);
    return r.rows.map((row) => row.award_id);
  }

  // Buyer access proof for supplier lot media (§8 privacy): buyer's order fulfilled from this lot.
  async buyerHasLotAllocation(buyerOrgId: string, lotId: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM ordering.allocations a
       JOIN ordering.order_lines ol ON ol.id = a.order_line_id
       JOIN ordering.orders o ON o.id = ol.order_id
       WHERE a.lot_id = $1 AND o.buyer_org_id = $2 AND a.status <> 'RELEASED' LIMIT 1`,
      [lotId, buyerOrgId]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async markDispatched(orderId: string, actorUserId?: string, tx?: PoolClient): Promise<void> {
    await this.transition(orderId, 'DISPATCHED', actorUserId ?? null, 'shipment dispatched', tx);
  }

  async markDelivered(orderId: string, actorUserId?: string, tx?: PoolClient): Promise<void> {
    const run = async (client: PoolClient): Promise<void> => {
      await this.transitionIn(client, orderId, 'DELIVERED', actorUserId ?? null, 'POD recorded');
      await this.transitionIn(client, orderId, 'ACCEPTANCE_PENDING', actorUserId ?? null, 'awaiting buyer acceptance');
    };
    if (tx) {
      await run(tx);
      return;
    }
    await this.db.withTransaction(run);
  }

  async markClaimOpened(orderId: string, actorUserId?: string): Promise<void> {
    await this.transition(orderId, 'CLAIM_OPEN', actorUserId ?? null, 'claim submitted');
  }

  async markSettled(orderId: string, actorUserId?: string): Promise<void> {
    await this.transition(orderId, 'SETTLED', actorUserId ?? null, 'settlement completed');
  }

  async applyLineFulfilment(lineId: string, to: string, actorUserId: string): Promise<void> {
    await this.db.withTransaction(async (client) => {
      const locked = await client.query<{ fulfilment_status: string }>(
        `SELECT fulfilment_status FROM ordering.supplier_allocation_lines WHERE id = $1 FOR UPDATE`, [lineId]);
      if (locked.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Allocation line not found');
      }
      const from = locked.rows[0].fulfilment_status;
      if (from === to) {
        return;
      }
      assertLineTransition(from, to);
      await client.query(
        `UPDATE ordering.supplier_allocation_lines SET fulfilment_status = $2 WHERE id = $1`, [lineId, to]);
      if (to === 'PACKED' || to === 'DISPATCHED' || to === 'DELIVERED') {
        await client.query(
          `UPDATE ordering.allocations SET status = $2
           WHERE supplier_allocation_line_id = $1 AND status NOT IN ('RELEASED','DELIVERED')`,
          [lineId, to]);
      }
      void actorUserId;
    });
  }

  async getAllocationLineState(lineId: string) {
    const line = await this.db.query(
      `SELECT sal.id, sal.allocation_id, sal.awarded_qty, sal.uom_id, sal.fulfilment_status,
              sa.order_id, sa.supplier_org_id
       FROM ordering.supplier_allocation_lines sal
       JOIN ordering.supplier_allocations sa ON sa.id = sal.allocation_id
       WHERE sal.id = $1`, [lineId]);
    if (line.rowCount === 0) {
      return null;
    }
    const sums = await this.db.query(
      `SELECT COALESCE(SUM(qty) FILTER (WHERE status <> 'RELEASED'), 0) AS allocated,
              COALESCE(SUM(qty) FILTER (WHERE status IN ('PACKED','DISPATCHED','DELIVERED')), 0) AS packed
       FROM ordering.allocations WHERE supplier_allocation_line_id = $1`, [lineId]);
    const l = line.rows[0];
    return {
      id: l.id, orderId: l.order_id, allocationId: l.allocation_id, supplierOrgId: l.supplier_org_id,
      awardedQty: Number(l.awarded_qty), uomId: l.uom_id, fulfilmentStatus: l.fulfilment_status,
      allocatedQty: Number(sums.rows[0].allocated), packedQty: Number(sums.rows[0].packed)
    };
  }

  async pilotExceptions(): Promise<Record<string, unknown[]>> {
    const [pendingConfirmation, shortLines, acceptancePending] = await Promise.all([
      this.db.query(
        `SELECT o.id, o.ref, o.created_at FROM ordering.orders o
         WHERE o.status = 'PENDING_CONFIRMATION' AND o.deleted_at IS NULL
           AND o.created_at < now() - interval '24 hours' ORDER BY o.created_at LIMIT 50`),
      this.db.query(
        `SELECT sal.id, sa.order_id, o.ref AS order_ref, sal.awarded_qty,
                COALESCE((SELECT SUM(a.qty) FROM ordering.allocations a
                  WHERE a.supplier_allocation_line_id = sal.id AND a.status <> 'RELEASED'), 0) AS allocated_qty
         FROM ordering.supplier_allocation_lines sal
         JOIN ordering.supplier_allocations sa ON sa.id = sal.allocation_id
         JOIN ordering.orders o ON o.id = sa.order_id
         WHERE sal.fulfilment_status = 'SHORT' ORDER BY o.created_at LIMIT 50`),
      this.db.query(
        `SELECT o.id, o.ref, o.updated_at FROM ordering.orders o
         WHERE o.status = 'ACCEPTANCE_PENDING' AND o.deleted_at IS NULL ORDER BY o.updated_at LIMIT 50`)
    ]);
    return {
      supplierNotConfirmed: pendingConfirmation.rows,
      orderShortAfterQc: shortLines.rows,
      buyerAcceptancePending: acceptancePending.rows
    };
  }

  private async transition(orderId: string, to: string, actor: string | null, reason: string, tx?: PoolClient): Promise<void> {
    if (tx) {
      await this.transitionIn(tx, orderId, to, actor, reason);
      return;
    }
    await this.db.withTransaction((client) => this.transitionIn(client, orderId, to, actor, reason));
  }

  private async transitionIn(client: PoolClient, orderId: string, to: string, actor: string | null, reason: string) {
    const current = await client.query<{ status: string }>(
      `SELECT status FROM ordering.orders WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [orderId]);
    if (current.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Order not found');
    }
    const from = current.rows[0].status;
    assertOrderTransition(from, to);
    await client.query(
      `UPDATE ordering.orders SET status = $2, version = version + 1, updated_at = now() WHERE id = $1`,
      [orderId, to]);
    await client.query(
      `INSERT INTO ordering.order_status_history (order_id, from_status, to_status, actor_user_id, reason)
       VALUES ($1,$2,$3,$4,$5)`, [orderId, from, to, actor, reason]);
    await this.outbox.emit(client, {
      aggregateType: 'order', aggregateId: orderId, type: 'order.transition',
      payload: { orderId, from, to }
    });
  }
}
