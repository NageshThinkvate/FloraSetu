// Public contract surface of the Notifications bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface NotificationsService {
  contextKey(): 'notifications';
}

export const Notifications_SERVICE = 'Notifications_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type NotificationsEvent =
  | { v: 1; type: 'notifications.scaffold.ready'; at: string };
