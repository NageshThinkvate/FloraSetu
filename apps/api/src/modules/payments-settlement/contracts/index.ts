// Public contract surface of the PaymentsSettlement bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface PaymentsSettlementService {
  contextKey(): 'payments-settlement';
}

export const PaymentsSettlement_SERVICE = 'PaymentsSettlement_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type PaymentsSettlementEvent =
  | { v: 1; type: 'payments-settlement.scaffold.ready'; at: string };
