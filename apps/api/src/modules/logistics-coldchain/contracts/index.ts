// Public contract surface of the LogisticsColdchain bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface LogisticsColdchainService {
  contextKey(): 'logistics-coldchain';
}

export const LogisticsColdchain_SERVICE = 'LogisticsColdchain_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type LogisticsColdchainEvent =
  | { v: 1; type: 'logistics-coldchain.scaffold.ready'; at: string };
