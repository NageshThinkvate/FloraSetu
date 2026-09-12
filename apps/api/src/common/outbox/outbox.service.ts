import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { RequestContext } from '../request-context';

export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: Record<string, unknown>;
  version?: number;
}

@Injectable()
export class OutboxService {
  // Writes inside the caller's transaction — no dual-write.
  async emit(client: PoolClient, event: OutboxEventInput): Promise<string> {
    const ctx = RequestContext.get();
    const result = await client.query<{ id: string }>(
      `INSERT INTO core.outbox_events (aggregate_type, aggregate_id, type, payload, trace_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [
        event.aggregateType,
        event.aggregateId,
        `${event.type}.v${event.version ?? 1}`,
        JSON.stringify(event.payload),
        ctx.traceId
      ]
    );
    return result.rows[0].id;
  }
}

export interface QueuePort {
  publish(event: { id: string; type: string; payload: Record<string, unknown> }): Promise<void>;
}
