import { Global, Module } from '@nestjs/common';
import { OrderAllocation_SERVICE } from './contracts';
import { OrderAllocationServiceImpl } from './internal/order-allocation.service';
import { OrdersService } from './internal/orders.service';
import { OrdersController } from './internal/orders.controller';

// Global contract provider: other contexts inject OrderAllocation_SERVICE without
// importing this module (docs/04 — contracts-only boundary, enforced mechanically).
@Global()
@Module({
  controllers: [OrdersController],
  providers: [
    OrdersService,
    { provide: OrderAllocation_SERVICE, useClass: OrderAllocationServiceImpl }
  ],
  exports: [OrderAllocation_SERVICE]
})
export class OrderAllocationModule {}
