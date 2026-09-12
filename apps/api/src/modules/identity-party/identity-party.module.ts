import { Module } from '@nestjs/common';
import { IdentityParty_SERVICE } from './contracts';
import { IdentityPartyServiceImpl } from './internal/identity-party.service';

@Module({
  providers: [{ provide: IdentityParty_SERVICE, useClass: IdentityPartyServiceImpl }],
  exports: [IdentityParty_SERVICE]
})
export class IdentityPartyModule {}
