import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { OrdersService } from './orders.service';
import {
  AcceptDeliveryDto, AllocateLotDto, ConvertAwardDto, ShortfallDto, TransitionOrderDto
} from './dto';

@Controller('orders')
@UseGuards(RbacGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('convert-award')
  @RequirePermission('order.manage')
  convert(@Body() dto: ConvertAwardDto, @Headers('idempotency-key') idemKey?: string) {
    return this.orders.convertAward(dto.awardId, idemKey);
  }

  @Get()
  @RequirePermission('order.read')
  listMine() {
    return this.orders.listMine();
  }

  @Get('allocations/mine')
  @RequirePermission('lot.read')
  myAllocations() {
    return this.orders.listMyAllocations();
  }

  @Post('allocations/:id/confirm')
  @RequirePermission('lot.write')
  confirmAllocation(@Param('id') id: string) {
    return this.orders.confirmAllocation(id);
  }

  @Post('allocations/:id/shortfall')
  @RequirePermission('order.manage')
  shortfall(@Param('id') id: string, @Body() dto: ShortfallDto) {
    return this.orders.markShortfall(id, dto);
  }

  @Post('allocate')
  @RequirePermission('inventory.allocate')
  allocate(@Body() dto: AllocateLotDto, @Headers('idempotency-key') idemKey?: string) {
    return this.orders.allocateLot(dto, idemKey);
  }

  @Get(':id')
  @RequirePermission('order.read')
  get(@Param('id') id: string) {
    return this.orders.get(id);
  }

  @Post(':id/transition')
  @RequirePermission('order.manage')
  transition(@Param('id') id: string, @Body() dto: TransitionOrderDto) {
    return this.orders.transition(id, dto);
  }

  @Post(':id/accept')
  @RequirePermission('delivery.accept')
  accept(@Param('id') id: string, @Body() dto: AcceptDeliveryDto) {
    return this.orders.acceptDelivery(id, dto);
  }
}
