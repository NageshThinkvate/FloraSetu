import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { KybService } from './kyb.service';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';

@Controller('admin')
@UseGuards(RbacGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly kyb: KybService
  ) {}

  @Post('kyb/:orgId/review')
  @RequirePermission('kyb.review')
  reviewKyb(@Param('orgId') orgId: string, @Body() body: { decision: 'VERIFIED' | 'REJECTED'; note?: string }) {
    return this.kyb.review(orgId, body.decision, body.note);
  }

  @Get('orgs')
  @RequirePermission('admin.org.read')
  listOrgs() {
    return this.admin.listOrgs();
  }

  @Get('orgs/:id')
  @RequirePermission('admin.org.read')
  getOrg(@Param('id') id: string) {
    return this.admin.getOrgPrivileged(id);
  }

  @Post('orgs/:id/restrict')
  @RequirePermission('restriction.manage')
  restrict(@Param('id') id: string, @Body() body: { reason: string }) {
    return this.admin.restrict(id, body.reason);
  }

  @Post('orgs/:id/lift')
  @RequirePermission('restriction.manage')
  lift(@Param('id') id: string) {
    return this.admin.lift(id);
  }

  @Post('support-sessions')
  @RequirePermission('support.access')
  supportSession(@Body() body: { orgId: string; reason: string }) {
    return this.admin.createSupportGrant(body.orgId, body.reason);
  }

  @Get('audit')
  @RequirePermission('audit.read')
  audit(@Query('orgId') orgId?: string) {
    return this.admin.auditTrail(orgId);
  }
}
