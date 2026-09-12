import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
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
}
