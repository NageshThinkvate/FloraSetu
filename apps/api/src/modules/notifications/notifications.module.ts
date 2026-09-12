import { Module } from '@nestjs/common';
import { Notifications_SERVICE } from './contracts';
import { NotificationsServiceImpl } from './internal/notifications.service';

@Module({
  providers: [{ provide: Notifications_SERVICE, useClass: NotificationsServiceImpl }],
  exports: [Notifications_SERVICE]
})
export class NotificationsModule {}
