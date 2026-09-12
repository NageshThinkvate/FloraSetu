import { Module } from '@nestjs/common';
import { ClaimsSupport_SERVICE } from './contracts';
import { ClaimsSupportServiceImpl } from './internal/claims-support.service';

@Module({
  providers: [{ provide: ClaimsSupport_SERVICE, useClass: ClaimsSupportServiceImpl }],
  exports: [ClaimsSupport_SERVICE]
})
export class ClaimsSupportModule {}
