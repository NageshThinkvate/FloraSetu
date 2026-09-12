// Public contract surface of the QualityTraceability bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface QualityTraceabilityService {
  contextKey(): 'quality-traceability';
}

export const QualityTraceability_SERVICE = 'QualityTraceability_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type QualityTraceabilityEvent =
  | { v: 1; type: 'quality-traceability.scaffold.ready'; at: string };
