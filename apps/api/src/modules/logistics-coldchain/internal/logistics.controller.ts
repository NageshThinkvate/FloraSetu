import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { PackingService } from './packing.service';
import { ShipmentsService } from './shipments.service';
import { CreatePackDto, CreateShipmentDto, PodDto, ResolveExceptionDto, TemperatureExceptionDto } from './dto';

@Controller('logistics')
@UseGuards(RbacGuard)
export class LogisticsController {
  constructor(
    private readonly packing: PackingService,
    private readonly shipments: ShipmentsService
  ) {}

  @Post('pack')
  @RequirePermission('pack.manage')
  pack(@Body() dto: CreatePackDto, @Headers('idempotency-key') idemKey?: string) {
    return this.packing.create(dto, idemKey);
  }

  @Get('pack/:orderId')
  @RequirePermission('pack.manage')
  packForOrder(@Param('orderId') orderId: string) {
    return this.packing.listForOrder(orderId);
  }

  @Post('shipments')
  @RequirePermission('dispatch.manage')
  createShipment(@Body() dto: CreateShipmentDto, @Headers('idempotency-key') idemKey?: string) {
    return this.shipments.create(dto, idemKey);
  }

  @Post('shipments/:id/dispatch')
  @RequirePermission('dispatch.manage')
  dispatch(@Param('id') id: string, @Headers('idempotency-key') idemKey?: string) {
    return this.shipments.dispatch(id, idemKey);
  }

  @Post('shipments/:id/pod')
  @RequirePermission('dispatch.manage')
  pod(@Param('id') id: string, @Body() dto: PodDto, @Headers('idempotency-key') idemKey?: string) {
    return this.shipments.pod(id, dto, idemKey);
  }

  @Post('shipments/:id/temperature-exception')
  @RequirePermission('dispatch.manage')
  temperatureException(@Param('id') id: string, @Body() dto: TemperatureExceptionDto) {
    return this.shipments.reportTemperatureException(id, dto);
  }

  @Post('exceptions/:id/resolve')
  @RequirePermission('procurement.manage')
  resolveException(@Param('id') id: string, @Body() dto: ResolveExceptionDto) {
    return this.shipments.resolveException(id, dto);
  }

  @Get('shipments/order/:orderId')
  @RequirePermission('order.read')
  shipmentsForOrder(@Param('orderId') orderId: string) {
    return this.shipments.listForOrder(orderId);
  }

  @Get('shipments/:id')
  @RequirePermission('order.read')
  getShipment(@Param('id') id: string) {
    return this.shipments.get(id);
  }
}
