// Public contract surface of the Notifications bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface NotificationsService {
  contextKey(): 'notifications';
  // Queue a notification (dev channel in Build 3; providers via OD-04 later).
  queue(orgId: string, userId: string | null, type: string, payload: Record<string, unknown>): Promise<string>;
}

export const Notifications_SERVICE = 'Notifications_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type NotificationsEvent =
  | { v: 1; type: 'notification.delivered'; notificationId: string; at: string };
