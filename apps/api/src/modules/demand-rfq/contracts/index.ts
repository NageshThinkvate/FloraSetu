// Public contract surface of the DemandRfq bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface DemandRfqService {
  contextKey(): 'demand-rfq';
}

export const DemandRfq_SERVICE = 'DemandRfq_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type DemandRfqEvent =
  | { v: 1; type: 'demand-rfq.scaffold.ready'; at: string };
