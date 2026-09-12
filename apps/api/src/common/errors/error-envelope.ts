export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'MFA_REQUIRED'
  | 'FORBIDDEN'
  | 'ORG_SUSPENDED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'OPTIMISTIC_LOCK_CONFLICT'
  | 'RATE_LIMITED'
  | 'IMMUTABLE_RECORD'
  | 'INTERNAL_ERROR';

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    trace_id: string;
    details?: Record<string, unknown>;
  };
}

export class ApiException extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export function buildErrorEnvelope(
  code: ErrorCode,
  message: string,
  traceId: string,
  details?: Record<string, unknown>
): ErrorEnvelope {
  const body: ErrorEnvelope = { error: { code, message, trace_id: traceId } };
  if (details) {
    body.error.details = details;
  }
  return body;
}
