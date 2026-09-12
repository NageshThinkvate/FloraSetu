import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

// Public human-readable reference IDs: e.g. LOT-2026-000123. Internal UUIDs never leak.
@Injectable()
export class ReferenceIdService {
  async next(client: PoolClient, entity: string, at: Date = new Date()): Promise<string> {
    const year = at.getUTCFullYear();
    const result = await client.query<{ next: string }>(
      `INSERT INTO core.reference_counters (entity, year, next_value)
       VALUES ($1, $2, 2)
       ON CONFLICT (entity, year) DO UPDATE SET next_value = core.reference_counters.next_value + 1
       RETURNING next_value - 1 AS next`,
      [entity, year]
    );
    const seq = Number(result.rows[0].next);
    return `${entity}-${year}-${String(seq).padStart(6, '0')}`;
  }
}
