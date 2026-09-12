import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { BankService } from './bank.service';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';

@Controller('orgs/:orgId/bank')
@UseGuards(RbacGuard)
export class BankController {
  constructor(private readonly bank: BankService) {}

  @Post('accounts')
  @RequirePermission('bank.write')
  createAccount(
    @Param('orgId') orgId: string,
    @Body() body: { accountRef: string; ifsc: string; accountNumber: string; holderName: string }
  ) {
    return this.bank.createPayoutProfile(orgId, body);
  }

  @Get('accounts')
  @RequirePermission('bank.read')
  listAccounts(@Param('orgId') orgId: string) {
    return this.bank.listAccounts(orgId);
  }

  @Get('change-requests')
  @RequirePermission('bank.read')
  listChangeRequests(@Param('orgId') orgId: string) {
    return this.bank.listChangeRequests(orgId);
  }

  @Post('change-requests/:requestId/approve')
  @RequirePermission('bank.approve')
  approve(@Param('orgId') orgId: string, @Param('requestId') requestId: string) {
    return this.bank.approve(orgId, requestId);
  }
}
