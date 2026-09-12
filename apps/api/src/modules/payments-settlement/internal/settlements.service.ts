import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ReferenceIdService } from '../../../common/pagination/reference-id.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { claimIdempotencyKey, completeIdempotencyKey, hashRequest } from '../../../common/idempotency/idempotency.service';
import { OrderAllocation_SERVICE, OrderAllocationService } from '../../order-allocation/contracts';
import { IdentityParty_SERVICE, IdentityPartyService } from '../../identity-party/contracts';
import { LogisticsColdchain_SERVICE, LogisticsColdchainService } from '../../logistics-coldchain/contracts';
import { AdjustmentDto, RecordSettlementDto } from './dto';

@Injectable()
export class SettlementsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    @Inject(OrderAllocation_SERVICE) private readonly orders: OrderAllocationService,
    @Inject(IdentityParty_SERVICE) private readonly identity: IdentityPartyService,
    @Inject(LogisticsColdchain_SERVICE) private readonly logistics: LogisticsColdchainService
  ) {}

  // §23: manual pilot settlement record. Recorded FOR the supplier by finance/ops —
  // a supplier never records its own settlement.
  async record(dto: RecordSettlementDto, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    if (orgId === dto.supplierOrgId) {
      throw new ApiException(403, 'FORBIDDEN', 'Supplier cannot record its own settlement', { code_detail: 'SELF_DEALING' });
    }
    const snapshot = await this.orders.getOrderSnapshot(dto.orderId);
    if (!snapshot || !snapshot.supplierOrgIds.includes(dto.supplierOrgId)) {
      throw new ApiException(404, 'NOT_FOUND', 'Order/allocation not found');
    }
    const deductions = dto.deductions ?? [];
    const claimAdjustment = dto.claimAdjustmentMinor ?? 0;
    const net = dto.grossMinor - deductions.reduce((s, d) => s + d.amountMinor, 0) - claimAdjustment;
    if (net < 0) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Net payable cannot be negative');
    }
    const hash = hashRequest({ dto });
    return this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'settlement.record', idemKey, hash);
      if (claim.state === 'replay') {
        return claim.responseBody;
      }
      const ref = await this.refIds.next(client, 'STL');
      const row = await client.query<{ id: string }>(
        `INSERT INTO payments.settlements
           (ref, org_id, order_id, amount_minor, currency, settled_at, status, gross_minor,
            deductions, claim_adjustment_minor, net_minor, payout_ref, payout_date, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,'RECORDED',$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [ref, dto.supplierOrgId, dto.orderId, net, dto.currency ?? 'INR',
         dto.payoutDate ?? new Date().toISOString(), dto.grossMinor, JSON.stringify(deductions),
         claimAdjustment, net, dto.payoutRef ?? null, dto.payoutDate ?? null, ctx.userId]
      );
      await this.audit.record(client, {
        action: 'settlement.record', objectType: 'settlement', objectId: row.rows[0].id, objectRef: ref,
        after: { orderId: dto.orderId, supplierOrgId: dto.supplierOrgId, grossMinor: dto.grossMinor, netMinor: net }
      });
      const body = { id: row.rows[0].id, ref, status: 'RECORDED', netMinor: net };
      await completeIdempotencyKey(client, orgId, 'settlement.record', idemKey, 201, body);
      return body;
    });
  }

  async verify(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ status: string; recorded_by: string }>(
        `SELECT status, recorded_by FROM payments.settlements WHERE id = $1 FOR UPDATE`, [id]);
      const s = locked.rows[0];
      if (!s) {
        throw new ApiException(404, 'NOT_FOUND', 'Settlement not found');
      }
      if (s.status !== 'RECORDED') {
        throw new ApiException(409, 'CONFLICT', `Settlement is ${s.status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      if (s.recorded_by === ctx.userId) {
        throw new ApiException(403, 'FORBIDDEN', 'Recorder cannot verify their own settlement', { code_detail: 'SELF_VERIFY' });
      }
      await client.query(
        `UPDATE payments.settlements SET status = 'VERIFIED', verified_by = $2, verified_at = now(),
           version = version + 1, updated_at = now() WHERE id = $1`, [id, ctx.userId]);
      await this.audit.record(client, {
        action: 'settlement.verify', objectType: 'settlement', objectId: id,
        before: { status: 'RECORDED' }, after: { status: 'VERIFIED' }
      });
      return { id, status: 'VERIFIED' };
    });
  }

  // Complete pays out (manual external payout reference). ADR-003: COMPLETED is immutable
  // (DB trigger). ADR-004: open bank-change freeze blocks payout. ADR-002: open severe
  // shipment exception blocks settlement.
  async complete(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const result = await this.db.withTransaction(async (client) => {
      const locked = await client.query<{ status: string; org_id: string; order_id: string }>(
        `SELECT status, org_id, order_id FROM payments.settlements WHERE id = $1 FOR UPDATE`, [id]);
      const s = locked.rows[0];
      if (!s) {
        throw new ApiException(404, 'NOT_FOUND', 'Settlement not found');
      }
      if (s.status !== 'VERIFIED') {
        throw new ApiException(409, 'CONFLICT', `Settlement is ${s.status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      if (await this.identity.hasPayoutFreeze(s.org_id)) {
        throw new ApiException(409, 'CONFLICT',
          'Supplier bank change is under re-verification — payouts frozen (ADR-004)', { code_detail: 'PAYOUT_FROZEN' });
      }
      if (await this.logistics.hasBlockingException(s.order_id)) {
        throw new ApiException(409, 'CONFLICT',
          'Open severe shipment exception blocks settlement (ADR-002)', { code_detail: 'SETTLEMENT_HOLD' });
      }
      await client.query(
        `UPDATE payments.settlements SET status = 'COMPLETED', completed_at = now(),
           version = version + 1, updated_at = now() WHERE id = $1`, [id]);
      await this.audit.record(client, {
        action: 'settlement.complete', objectType: 'settlement', objectId: id,
        before: { status: 'VERIFIED' }, after: { status: 'COMPLETED' }
      });
      await this.outbox.emit(client, {
        aggregateType: 'settlement', aggregateId: id, type: 'settlement.completed',
        payload: { settlementId: id, orderId: s.order_id, supplierOrgId: s.org_id }
      });
      return { id, status: 'COMPLETED', orderId: s.order_id };
    });
    // Order -> SETTLED once the supplier settlement completes (retryable no-op otherwise).
    const orderId = (result as { orderId: string }).orderId;
    await this.orders.markSettled(orderId, ctx.userId).catch(() => undefined);
    return result;
  }

  // ADR-003: post-settlement corrections create adjustment records — never edit COMPLETED rows.
  async adjust(id: string, dto: AdjustmentDto): Promise<unknown> {
    return this.db.withTransaction(async (client) => {
      const settlement = await client.query<{ status: string; currency: string; order_id: string }>(
        `SELECT status, currency, order_id FROM payments.settlements WHERE id = $1`, [id]);
      if (settlement.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Settlement not found');
      }
      if (settlement.rows[0].status !== 'COMPLETED') {
        throw new ApiException(409, 'CONFLICT', 'Adjustments apply to COMPLETED settlements only');
      }
      const row = await client.query<{ id: string }>(
        `INSERT INTO payments.financial_adjustments (settlement_id, claim_id, direction, amount_minor, currency, reason)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [id, dto.claimId ?? null, dto.direction, dto.amountMinor, settlement.rows[0].currency, dto.reason]
      );
      await this.audit.record(client, {
        action: 'settlement.adjust', objectType: 'settlement', objectId: id,
        after: { adjustmentId: row.rows[0].id, direction: dto.direction, amountMinor: dto.amountMinor }
      });
      return { adjustmentId: row.rows[0].id, settlementId: id };
    });
  }

  async listForOrder(orderId: string): Promise<{ items: unknown[] }> {
    const ctx = RequestContext.get();
    const snapshot = await this.orders.getOrderSnapshot(orderId);
    const finance = ['settlement.record', 'settlement.verify', 'procurement.manage'].some((p) => ctx.permissions.includes(p));
    if (!snapshot || (ctx.orgId !== snapshot.buyerOrgId && !snapshot.supplierOrgIds.includes(ctx.orgId ?? '') && !finance)) {
      throw new ApiException(404, 'NOT_FOUND', 'Order not found');
    }
    // Suppliers see only their own settlement rows (§4/§29).
    const rows = await this.db.query(
      `SELECT s.id, s.ref, s.org_id, s.status, s.gross_minor, s.deductions, s.claim_adjustment_minor,
              s.net_minor, s.payout_ref, s.payout_date, s.completed_at, s.updated_at
       FROM payments.settlements s WHERE s.order_id = $1
         AND ($2::boolean OR s.org_id = $3 OR $4 = $5)
       ORDER BY s.updated_at DESC`,
      [orderId, finance, ctx.orgId, snapshot.buyerOrgId, ctx.orgId]
    );
    return { items: rows.rows };
  }

  async listMine(): Promise<{ items: unknown[] }> {
    const orgId = RequestContext.requireOrgId();
    const rows = await this.db.query(
      `SELECT id, ref, order_id, status, gross_minor, net_minor, payout_ref, payout_date, completed_at, updated_at
       FROM payments.settlements WHERE org_id = $1 ORDER BY updated_at DESC`, [orgId]);
    return { items: rows.rows };
  }
}
