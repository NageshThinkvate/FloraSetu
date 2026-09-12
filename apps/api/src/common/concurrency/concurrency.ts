import { PoolClient } from 'pg';
import { ApiException } from '../errors/error-envelope';

// Optimistic concurrency for ordinary mutables: UPDATE ... WHERE id=$ AND version=$.
export async function optimisticUpdate(
  client: PoolClient,
  table: string,
  id: string,
  expectedVersion: number,
  setClause: string,
  params: unknown[]
): Promise<void> {
  const result = await client.query(
    `UPDATE ${table} SET ${setClause}, version = version + 1, updated_at = now()
     WHERE id = $1 AND version = $2`,
    [id, expectedVersion, ...params]
  );
  if (result.rowCount === 0) {
    throw new ApiException(409, 'OPTIMISTIC_LOCK_CONFLICT', `Stale version for ${table}`);
  }
}

// Transactional row lock for inventory/allocation and payout transitions (ADR-001/004).
export async function lockRow<T extends { id: string }>(
  client: PoolClient,
  table: string,
  id: string
): Promise<T> {
  const result = await client.query<T>(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
  if (result.rowCount === 0) {
    throw new ApiException(404, 'NOT_FOUND', `${table} row not found`);
  }
  return result.rows[0];
}
