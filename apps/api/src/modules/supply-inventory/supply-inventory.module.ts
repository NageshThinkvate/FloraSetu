import { Module } from '@nestjs/common';
import { SupplyInventory_SERVICE } from './contracts';
import { SupplyInventoryServiceImpl } from './internal/supply-inventory.service';

@Module({
  providers: [{ provide: SupplyInventory_SERVICE, useClass: SupplyInventoryServiceImpl }],
  exports: [SupplyInventory_SERVICE]
})
export class SupplyInventoryModule {}
