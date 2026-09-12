// Public contract surface of the PaymentsSettlement bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface PaymentsSettlementService {
  contextKey(): 'payments-settlement';
  // ADR-003: post-settlement corrections are new adjustment records, never edits.
  createClaimAdjustment(input: {
    orderId: string; supplierOrgId: string; claimId: string;
    amountMinor: number; reason: string; recordedBy: string | undefined;
  }): Promise<{ adjustmentId: string }>;
  hasVerifiedPayment(orderId: string): Promise<boolean>;
  pilotExceptions(): Promise<Record<string, unknown[]>>;
}

export const PaymentsSettlement_SERVICE = 'PaymentsSettlement_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type PaymentsSettlementEvent =
  | { v: 1; type: 'payment.recorded'; paymentId: string; orderId: string; at: string }
  | { v: 1; type: 'payment.verified'; paymentId: string; orderId: string; at: string }
  | { v: 1; type: 'settlement.completed'; settlementId: string; orderId: string; supplierOrgId: string; at: string };
