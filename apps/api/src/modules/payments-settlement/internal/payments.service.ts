import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ReferenceIdService } from '../../../common/pagination/reference-id.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { claimIdempotencyKey, completeIdempotencyKey, hashRequest } from '../../../common/idempotency/idempotency.service';
import { OrderAllocation_SERVICE, OrderAllocationService } from '../../order-allocation/contracts';
import { RecordPaymentDto } from './dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    @Inject(OrderAllocation_SERVICE) private readonly orders: OrderAllocationService
  ) {}

  // §22/§32: records an ACTUAL external buyer payment. Labelled EXTERNAL — never escrow,
  // never auto-success. Verification is a separate, audited human step.
  async record(dto: RecordPaymentDto, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const snapshot = await this.orders.getOrderSnapshot(dto.orderId);
    if (!snapshot) {
      throw new ApiException(404, 'NOT_FOUND', 'Order not found');
    }
    const finance = ctx.permissions.includes('payment.verify') || ctx.permissions.includes('procurement.manage');
    if (ctx.orgId !== snapshot.buyerOrgId && !finance) {
      throw new ApiException(404, 'NOT_FOUND', 'Order not found');
    }
    const hash = hashRequest({ dto });
    return this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'payment.record', idemKey, hash);
      if (claim.state === 'replay') {
        return claim.responseBody;
      }
      const ref = await this.refIds.next(client, 'PAY');
      const payment = await client.query<{ id: string }>(
        `INSERT INTO payments.payments
           (ref, invoice_id, amount_minor, currency, provider, status, record_kind,
            order_id, buyer_org_id, method, external_ref, paid_at, evidence_media_id, recorded_by)
         VALUES ($1,NULL,$2,$3,'EXTERNAL','RECORDED','EXTERNAL',$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [ref, dto.amountMinor, dto.currency ?? 'INR', dto.orderId, snapshot.buyerOrgId,
         dto.method, dto.externalRef, dto.paidAt, dto.evidenceMediaId ?? null, ctx.userId]
      );
      await this.audit.record(client, {
        action: 'payment.record', objectType: 'payment', objectId: payment.rows[0].id, objectRef: ref,
        after: { orderId: dto.orderId, amountMinor: dto.amountMinor, method: dto.method, externalRef: dto.externalRef }
      });
      await this.outbox.emit(client, {
        aggregateType: 'payment', aggregateId: payment.rows[0].id, type: 'payment.recorded',
        payload: { paymentId: payment.rows[0].id, orderId: dto.orderId }
      });
      const body = { id: payment.rows[0].id, ref, status: 'RECORDED', kind: 'EXTERNAL_RECORDED' };
      await completeIdempotencyKey(client, orgId, 'payment.record', idemKey, 201, body);
      return body;
    });
  }

  // Supplier cannot self-verify (§29): verifier must differ from recorder.
  async verify(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ status: string; recorded_by: string; order_id: string }>(
        `SELECT status, recorded_by, order_id FROM payments.payments WHERE id = $1 FOR UPDATE`, [id]);
      const payment = locked.rows[0];
      if (!payment) {
        throw new ApiException(404, 'NOT_FOUND', 'Payment not found');
      }
      if (payment.status !== 'RECORDED') {
        throw new ApiException(409, 'CONFLICT', `Payment is ${payment.status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      if (payment.recorded_by === ctx.userId) {
        throw new ApiException(403, 'FORBIDDEN', 'Recorder cannot verify their own payment record', {
          code_detail: 'SELF_VERIFY'
        });
      }
      await client.query(
        `UPDATE payments.payments SET status = 'VERIFIED', verified_by = $2, verified_at = now(), updated_at = now()
         WHERE id = $1`, [id, ctx.userId]);
      await this.audit.record(client, {
        action: 'payment.verify', objectType: 'payment', objectId: id,
        before: { status: 'RECORDED' }, after: { status: 'VERIFIED' }
      });
      await this.outbox.emit(client, {
        aggregateType: 'payment', aggregateId: id, type: 'payment.verified',
        payload: { paymentId: id, orderId: payment.order_id }
      });
      return { id, status: 'VERIFIED' };
    });
  }

  async listForOrder(orderId: string): Promise<{ items: unknown[] }> {
    const ctx = RequestContext.get();
    const snapshot = await this.orders.getOrderSnapshot(orderId);
    const finance = ctx.permissions.includes('payment.verify') || ctx.permissions.includes('payment.record')
      || ctx.permissions.includes('procurement.manage');
    if (!snapshot || (ctx.orgId !== snapshot.buyerOrgId && !snapshot.supplierOrgIds.includes(ctx.orgId ?? '') && !finance)) {
      throw new ApiException(404, 'NOT_FOUND', 'Order not found');
    }
    const rows = await this.db.query(
      `SELECT id, ref, amount_minor, currency, method, external_ref, status, record_kind,
              paid_at, recorded_by, verified_by, verified_at, created_at
       FROM payments.payments WHERE order_id = $1 ORDER BY created_at DESC`, [orderId]);
    return { items: rows.rows };
  }
}
