import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RbacGuard } from '../../../common/authz/rbac.guard';
import { RequestContext } from '../../../common/request-context';
import { NotificationsServiceImpl } from './notifications.service';

// B2 (UI/UX redesign Phase 2): in-app notification feed for the shell bell.
// Org-scoped via RequestContext (X-Org-Id); backend authorization stays authoritative.
@Controller('notifications')
@UseGuards(RbacGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsServiceImpl) {}

  @Get()
  list() {
    return this.notifications.listForUser(
      RequestContext.requireOrgId(),
      RequestContext.get().userId!
    );
  }

  @Post(':id/read')
  markRead(@Param('id') id: string) {
    return this.notifications.markRead(
      id,
      RequestContext.requireOrgId(),
      RequestContext.get().userId!
    );
  }
}
