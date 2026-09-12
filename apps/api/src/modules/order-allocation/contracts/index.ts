// Public contract surface of the OrderAllocation bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface OrderAllocationService {
  contextKey(): 'order-allocation';
}

export const OrderAllocation_SERVICE = 'OrderAllocation_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type OrderAllocationEvent =
  | { v: 1; type: 'order-allocation.scaffold.ready'; at: string };
