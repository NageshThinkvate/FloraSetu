import { Global, Module } from '@nestjs/common';
import { Notifications_SERVICE } from './contracts';
import { NotificationsServiceImpl } from './internal/notifications.service';
import { NotificationsController } from './internal/notifications.controller';

// Global contract provider: other contexts inject Notifications_SERVICE without
// importing this module (docs/04 — contracts-only boundary, enforced mechanically).
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsServiceImpl,
    { provide: Notifications_SERVICE, useExisting: NotificationsServiceImpl }
  ],
  exports: [Notifications_SERVICE]
})
export class NotificationsModule {}
