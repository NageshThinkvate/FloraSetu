import { Global, Module } from '@nestjs/common';
import { SupplyInventory_SERVICE } from './contracts';
import { SupplyInventoryServiceImpl } from './internal/supply-inventory.service';
import { LotsService } from './internal/lots.service';
import { SupplyController } from './internal/supply.controller';

// Global contract provider: other contexts inject SupplyInventory_SERVICE without
// importing this module (docs/04 — contracts-only boundary, enforced mechanically).
@Global()
@Module({
  controllers: [SupplyController],
  providers: [
    LotsService,
    { provide: SupplyInventory_SERVICE, useClass: SupplyInventoryServiceImpl }
  ],
  exports: [SupplyInventory_SERVICE]
})
export class SupplyInventoryModule {}
