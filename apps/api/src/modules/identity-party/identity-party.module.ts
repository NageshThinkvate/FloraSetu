import { Module } from '@nestjs/common';
import { IdentityParty_SERVICE } from './contracts';
import { IdentityPartyServiceImpl } from './internal/identity-party.service';
import { AuthService } from './internal/auth.service';
import { AuthController } from './internal/auth.controller';
import { OrgsService } from './internal/orgs.service';
import { OrgsController } from './internal/orgs.controller';
import { MembersService } from './internal/members.service';
import { MembersController } from './internal/members.controller';
import { KybService } from './internal/kyb.service';
import { KybController } from './internal/kyb.controller';
import { BankService } from './internal/bank.service';
import { BankController } from './internal/bank.controller';
import { AdminService } from './internal/admin.service';
import { AdminController } from './internal/admin.controller';

@Module({
  controllers: [AuthController, OrgsController, MembersController, KybController, BankController, AdminController],
  providers: [
    AuthService,
    OrgsService,
    MembersService,
    KybService,
    BankService,
    AdminService,
    { provide: IdentityParty_SERVICE, useClass: IdentityPartyServiceImpl }
  ],
  exports: [IdentityParty_SERVICE]
})
export class IdentityPartyModule {}
