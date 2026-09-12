import { Global, Module } from '@nestjs/common';
import { ClaimsSupport_SERVICE } from './contracts';
import { ClaimsService } from './internal/claims.service';
import { ClaimsSupportServiceImpl } from './internal/claims-support.service';
import { ClaimsController } from './internal/claims.controller';

// Global contract provider: other contexts inject ClaimsSupport_SERVICE without
// importing this module (docs/04 — contracts-only boundary, enforced mechanically).
@Global()
@Module({
  controllers: [ClaimsController],
  providers: [
    ClaimsService,
    { provide: ClaimsSupport_SERVICE, useClass: ClaimsSupportServiceImpl }
  ],
  exports: [ClaimsSupport_SERVICE]
})
export class ClaimsSupportModule {}
