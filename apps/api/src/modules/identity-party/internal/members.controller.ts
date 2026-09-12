import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MembersService } from './members.service';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { RequestContext } from '../../../common/request-context';

@Controller('orgs/:orgId/members')
@UseGuards(RbacGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('member.read')
  list(@Param('orgId') orgId: string) {
    return this.members.list(orgId);
  }

  @Post()
  @RequirePermission('member.invite')
  invite(@Param('orgId') orgId: string, @Body() body: { email: string }) {
    return this.members.invite(orgId, body.email);
  }

  @Post('accept/:membershipId')
  accept(@Param('membershipId') membershipId: string) {
    return this.members.accept(RequestContext.get().userId!, membershipId);
  }

  @Post(':userId/roles')
  @RequirePermission('role.manage')
  assignRole(@Param('orgId') orgId: string, @Param('userId') userId: string, @Body() body: { role: string }) {
    return this.members.assignRole(orgId, userId, body.role);
  }

  @Delete(':userId/roles/:role')
  @RequirePermission('role.manage')
  removeRole(@Param('orgId') orgId: string, @Param('userId') userId: string, @Param('role') role: string) {
    return this.members.removeRole(orgId, userId, role);
  }
}
