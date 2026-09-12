// Public contract surface of the SupplyInventory bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface SupplyInventoryService {
  contextKey(): 'supply-inventory';
}

export const SupplyInventory_SERVICE = 'SupplyInventory_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type SupplyInventoryEvent =
  | { v: 1; type: 'supply-inventory.scaffold.ready'; at: string };
