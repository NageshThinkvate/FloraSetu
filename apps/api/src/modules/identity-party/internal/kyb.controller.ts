import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { KybService } from './kyb.service';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';

@Controller('orgs/:orgId/kyb')
@UseGuards(RbacGuard)
export class KybController {
  constructor(private readonly kyb: KybService) {}

  @Post('submit')
  @RequirePermission('kyb.submit')
  submit(@Param('orgId') orgId: string, @Body() body: { documents: Parameters<KybService['submit']>[1] }) {
    return this.kyb.submit(orgId, body.documents);
  }

  @Get('history')
  @RequirePermission('org.read')
  history(@Param('orgId') orgId: string) {
    return this.kyb.history(orgId);
  }
}
