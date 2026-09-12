import { createHash } from 'crypto';
import { SetMetadata } from '@nestjs/common';
import { PoolClient } from 'pg';
import { ApiException } from '../errors/error-envelope';

export const IDEMPOTENT_KEY = 'idempotent_endpoint';
export const Idempotent = (endpoint: string) => SetMetadata(IDEMPOTENT_KEY, endpoint);

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const TTL_HOURS = 72;
const LOCK_SECONDS = 30;

export function hashRequest(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

export interface ClaimResult {
  state: 'claimed' | 'replay' | 'conflict' | 'in_progress';
  responseStatus?: number;
  responseBody?: unknown;
}

// Claim-or-replay against core.idempotency_keys. Runs inside the caller's transaction.
export async function claimIdempotencyKey(
  client: PoolClient,
  orgId: string,
  endpoint: string,
  key: string,
  requestHash: string
): Promise<ClaimResult> {
  const inserted = await client.query(
    `INSERT INTO core.idempotency_keys (org_id, endpoint, key, request_hash, state, locked_until, expires_at)
     VALUES ($1, $2, $3, $4, 'IN_PROGRESS', now() + interval '${LOCK_SECONDS} seconds', now() + interval '${TTL_HOURS} hours')
     ON CONFLICT (org_id, endpoint, key) DO NOTHING
     RETURNING id`,
    [orgId, endpoint, key, requestHash]
  );
  if (inserted.rowCount === 1) {
    return { state: 'claimed' };
  }
  const existing = await client.query(
    `SELECT request_hash, state, response_status, response_body, locked_until
     FROM core.idempotency_keys WHERE org_id = $1 AND endpoint = $2 AND key = $3 FOR UPDATE`,
    [orgId, endpoint, key]
  );
  const row = existing.rows[0];
  if (row.request_hash !== requestHash) {
    throw new ApiException(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key reused with a different payload');
  }
  if (row.state === 'COMPLETED') {
    return { state: 'replay', responseStatus: row.response_status, responseBody: row.response_body };
  }
  throw new ApiException(409, 'IDEMPOTENCY_IN_PROGRESS', 'A request with this key is still in progress');
}

export async function completeIdempotencyKey(
  client: PoolClient,
  orgId: string,
  endpoint: string,
  key: string,
  status: number,
  body: unknown
): Promise<void> {
  await client.query(
    `UPDATE core.idempotency_keys
     SET state = 'COMPLETED', response_status = $4, response_body = $5, locked_until = NULL
     WHERE org_id = $1 AND endpoint = $2 AND key = $3`,
    [orgId, endpoint, key, status, JSON.stringify(body ?? null)]
  );
}
