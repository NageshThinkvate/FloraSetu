import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { PackingService } from './packing.service';
import { ShipmentsService } from './shipments.service';
import { AssignDriverDto, AssignJobDto, ConfirmPickupDto, CreatePackDto, CreateShipmentDto, PodDto, ReportLogisticsExceptionDto, ResolveExceptionDto, TemperatureExceptionDto, UnassignDriverDto } from './dto';

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

  // ---------- B4: logistics partner jobs (ADR-011) ----------
  @Post('shipments/:id/assign')
  @RequirePermission('procurement.manage')
  assignJob(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignJobDto) {
    return this.shipments.assignJob(id, dto);
  }

  @Get('jobs')
  listPartnerJobs() {
    return this.shipments.listPartnerJobs();
  }

  @Get('jobs/mine')
  listDriverJobs() {
    return this.shipments.listDriverJobs();
  }

  // Phase 5 (ADR-012): static segments must be declared before jobs/:id.
  @Get('jobs/dashboard')
  jobsDashboard() {
    return this.shipments.jobsDashboard();
  }

  @Get('jobs/eligible-drivers')
  eligibleDrivers() {
    return this.shipments.listEligibleDrivers();
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.shipments.getJob(id);
  }

  @Post('jobs/:id/accept')
  acceptJob(@Param('id') id: string) {
    return this.shipments.acceptJob(id);
  }

  @Post('jobs/:id/pickup')
  confirmPickup(@Param('id') id: string, @Body() dto: ConfirmPickupDto) {
    return this.shipments.confirmPickup(id, dto);
  }

  @Post('jobs/:id/transit')
  markInTransit(@Param('id') id: string) {
    return this.shipments.markInTransit(id);
  }

  @Post('jobs/:id/deliver')
  deliverAsPartner(@Param('id') id: string, @Body() dto: PodDto) {
    return this.shipments.deliverAsPartner(id, dto);
  }

  @Post('jobs/:id/exception')
  reportJobException(@Param('id') id: string, @Body() dto: ReportLogisticsExceptionDto) {
    return this.shipments.reportException(id, dto);
  }

  // ---------- Phase 5 (ADR-012): partner-controlled execution ----------
  @Post('jobs/:id/assign-driver')
  assignDriver(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDriverDto) {
    return this.shipments.assignDriver(id, dto);
  }

  @Post('jobs/:id/unassign-driver')
  unassignDriver(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UnassignDriverDto) {
    return this.shipments.unassignDriver(id, dto);
  }

  @Post('jobs/:id/arrived-pickup')
  arrivedAtPickup(@Param('id', ParseUUIDPipe) id: string) {
    return this.shipments.arrivedAtPickup(id);
  }

  @Post('jobs/:id/arrived-delivery')
  arrivedAtDelivery(@Param('id', ParseUUIDPipe) id: string) {
    return this.shipments.arrivedAtDelivery(id);
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
