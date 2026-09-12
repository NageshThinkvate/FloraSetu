import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { RequestContext } from '../../../common/request-context';

@Controller('orgs')
@UseGuards(RbacGuard)
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Post()
  create(@Body() body: Parameters<OrgsService['createOrg']>[0]) {
    return this.orgs.createOrg(body);
  }

  @Get('mine')
  mine() {
    return this.orgs.myOrgs(RequestContext.get().userId!);
  }

  @Get(':id')
  @RequirePermission('org.read')
  get(@Param('id') id: string) {
    return this.orgs.getOrg(id);
  }

  @Patch(':id')
  @RequirePermission('org.write')
  update(@Param('id') id: string, @Body() body: { name: string }) {
    return this.orgs.updateOrg(id, body.name);
  }

  @Post(':id/branches')
  @RequirePermission('branch.write')
  addBranch(@Param('id') id: string, @Body() body: { name: string; addressId?: string }) {
    return this.orgs.addBranch(id, body.name, body.addressId);
  }

  @Post(':id/contacts')
  @RequirePermission('contact.write')
  addContact(@Param('id') id: string, @Body() body: { kind: 'EMAIL' | 'PHONE' | 'WHATSAPP'; value: string }) {
    return this.orgs.addContact(id, body.kind, body.value);
  }
}
