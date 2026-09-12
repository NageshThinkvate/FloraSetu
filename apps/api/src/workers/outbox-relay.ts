import { Pool } from 'pg';
import { QueuePort } from '../common/outbox/outbox.service';

// Outbox relay: publishes unpublished events with FOR UPDATE SKIP LOCKED (at-least-once;
// consumers must dedupe by event id — see docs/10).
export class OutboxRelay {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly pool: Pool,
    private readonly queue: QueuePort,
    private readonly intervalMs = 500
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async tick(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const events = await client.query<{ id: string; type: string; payload: Record<string, unknown> }>(
        `SELECT id, type, payload FROM core.outbox_events
         WHERE published_at IS NULL AND attempts < 8
         ORDER BY occurred_at LIMIT 50 FOR UPDATE SKIP LOCKED`
      );
      for (const event of events.rows) {
        try {
          await this.queue.publish(event);
          await client.query('UPDATE core.outbox_events SET published_at = now() WHERE id = $1', [event.id]);
        } catch {
          await client.query('UPDATE core.outbox_events SET attempts = attempts + 1 WHERE id = $1', [event.id]);
        }
      }
      await client.query('COMMIT');
      return events.rowCount ?? 0;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
