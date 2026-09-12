import { Global, Module } from '@nestjs/common';
import { LogisticsColdchain_SERVICE } from './contracts';
import { PackingService } from './internal/packing.service';
import { ShipmentsService } from './internal/shipments.service';
import { LogisticsColdchainServiceImpl } from './internal/logistics-coldchain.service';
import { LogisticsController } from './internal/logistics.controller';

// Global contract provider: other contexts inject LogisticsColdchain_SERVICE without
// importing this module (docs/04 — contracts-only boundary, enforced mechanically).
@Global()
@Module({
  controllers: [LogisticsController],
  providers: [
    PackingService,
    ShipmentsService,
    { provide: LogisticsColdchain_SERVICE, useClass: LogisticsColdchainServiceImpl }
  ],
  exports: [LogisticsColdchain_SERVICE]
})
export class LogisticsColdchainModule {}
