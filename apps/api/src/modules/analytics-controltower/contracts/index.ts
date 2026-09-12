// Public contract surface of the AnalyticsControltower bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface AnalyticsControltowerService {
  contextKey(): 'analytics-controltower';
}

export const AnalyticsControltower_SERVICE = 'AnalyticsControltower_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type AnalyticsControltowerEvent =
  | { v: 1; type: 'analytics-controltower.scaffold.ready'; at: string };
