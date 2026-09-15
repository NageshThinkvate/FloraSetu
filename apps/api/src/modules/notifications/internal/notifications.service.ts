import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { NotificationsService } from '../contracts';

@Injectable()
export class NotificationsServiceImpl implements NotificationsService {
  constructor(private readonly db: DatabaseService) {}

  contextKey(): 'notifications' {
    return 'notifications';
  }

  async queue(orgId: string, userId: string | null, type: string, payload: Record<string, unknown>): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO notifications.notifications (org_id, user_id, payload)
       VALUES ($1, $2, $3) RETURNING id`,
      [orgId, userId, JSON.stringify({ type, ...payload })]
    );
    await this.db.query(
      `INSERT INTO notifications.notification_deliveries (notification_id, channel, status)
       VALUES ($1, 'WEB_PUSH', 'QUEUED')`,
      [result.rows[0].id]
    );
    return result.rows[0].id;
  }

  // B2 (UI/UX redesign): in-app notification feed. Org-scoped; org-wide rows (user_id NULL)
  // are visible to every member of the active organization.
  async listForUser(orgId: string, userId: string): Promise<{ items: unknown[]; unreadCount: number }> {
    const rows = await this.db.query<{
      id: string;
      payload: Record<string, unknown> & { type?: string };
      read_at: string | null;
      created_at: string;
    }>(
      `SELECT id, payload, read_at, created_at FROM notifications.notifications
       WHERE org_id = $1 AND (user_id IS NULL OR user_id = $2)
       ORDER BY created_at DESC LIMIT 50`,
      [orgId, userId]
    );
    const items = rows.rows.map((r) => ({
      id: r.id,
      ...r.payload,
      type: r.payload?.type ?? 'general',
      readAt: r.read_at,
      createdAt: r.created_at
    }));
    return { items, unreadCount: items.filter((i) => !i.readAt).length };
  }

  async markRead(id: string, orgId: string, userId: string): Promise<{ id: string; readAt: string }> {
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM notifications.notifications
       WHERE id = $1 AND org_id = $2 AND (user_id IS NULL OR user_id = $3)`,
      [id, orgId, userId]
    );
    if (existing.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Notification not found');
    }
    const updated = await this.db.query<{ read_at: string }>(
      `UPDATE notifications.notifications SET read_at = now()
       WHERE id = $1 AND read_at IS NULL RETURNING read_at`,
      [id]
    );
    return { id, readAt: updated.rows[0]?.read_at ?? new Date(0).toISOString() };
  }
}
