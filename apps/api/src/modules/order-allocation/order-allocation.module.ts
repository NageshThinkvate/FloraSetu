import { Module } from '@nestjs/common';
import { OrderAllocation_SERVICE } from './contracts';
import { OrderAllocationServiceImpl } from './internal/order-allocation.service';

@Module({
  providers: [{ provide: OrderAllocation_SERVICE, useClass: OrderAllocationServiceImpl }],
  exports: [OrderAllocation_SERVICE]
})
export class OrderAllocationModule {}
