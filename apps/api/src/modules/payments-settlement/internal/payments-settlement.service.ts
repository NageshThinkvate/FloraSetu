import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { PaymentsSettlementService } from '../contracts';

@Injectable()
export class PaymentsSettlementServiceImpl implements PaymentsSettlementService {
  constructor(private readonly db: DatabaseService) {}

  contextKey(): 'payments-settlement' {
    return 'payments-settlement';
  }

  // ADR-003: claim-driven correction lands as an adjustment record on the supplier's
  // settlement for the order (never an edit to a completed settlement).
  async createClaimAdjustment(input: {
    orderId: string; supplierOrgId: string; claimId: string;
    amountMinor: number; reason: string; recordedBy: string | undefined;
  }): Promise<{ adjustmentId: string }> {
    const settlement = await this.db.query<{ id: string; currency: string; status: string }>(
      `SELECT id, currency, status FROM payments.settlements
       WHERE order_id = $1 AND org_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [input.orderId, input.supplierOrgId]
    );
    if (settlement.rowCount === 0) {
      throw new ApiException(409, 'CONFLICT', 'No settlement exists yet; apply the claim adjustment during settlement recording', {
        code_detail: 'NO_SETTLEMENT'
      });
    }
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO payments.financial_adjustments (settlement_id, claim_id, direction, amount_minor, currency, reason)
       VALUES ($1,$2,'DEBIT',$3,$4,$5) RETURNING id`,
      [settlement.rows[0].id, input.claimId, input.amountMinor, settlement.rows[0].currency, input.reason]
    );
    void input.recordedBy;
    return { adjustmentId: row.rows[0].id };
  }

  async hasVerifiedPayment(orderId: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM payments.payments WHERE order_id = $1 AND status = 'VERIFIED' LIMIT 1`, [orderId]);
    return (r.rowCount ?? 0) > 0;
  }

  async pilotExceptions(): Promise<Record<string, unknown[]>> {
    const [unverified, pendingSettlement] = await Promise.all([
      this.db.query(
        `SELECT id, ref, order_id, amount_minor, created_at FROM payments.payments
         WHERE status = 'RECORDED' ORDER BY created_at LIMIT 50`),
      this.db.query(
        `SELECT id, ref, order_id, org_id, status, net_minor, settled_at FROM payments.settlements
         WHERE status IN ('RECORDED','VERIFIED') ORDER BY updated_at LIMIT 50`)
    ]);
    return { paymentUnverified: unverified.rows, settlementPending: pendingSettlement.rows };
  }
}
