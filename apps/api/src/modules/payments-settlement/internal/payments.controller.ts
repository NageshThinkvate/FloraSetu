import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { PaymentsService } from './payments.service';
import { SettlementsService } from './settlements.service';
import { AdjustmentDto, RecordPaymentDto, RecordSettlementDto } from './dto';

@Controller('finance')
@UseGuards(RbacGuard)
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly settlements: SettlementsService
  ) {}

  @Post('payments')
  @RequirePermission('payment.record')
  recordPayment(@Body() dto: RecordPaymentDto, @Headers('idempotency-key') idemKey?: string) {
    return this.payments.record(dto, idemKey);
  }

  @Post('payments/:id/verify')
  @RequirePermission('payment.verify')
  verifyPayment(@Param('id') id: string) {
    return this.payments.verify(id);
  }

  @Get('payments/order/:orderId')
  @RequirePermission('order.read')
  paymentsForOrder(@Param('orderId') orderId: string) {
    return this.payments.listForOrder(orderId);
  }

  @Post('settlements')
  @RequirePermission('settlement.record')
  recordSettlement(@Body() dto: RecordSettlementDto, @Headers('idempotency-key') idemKey?: string) {
    return this.settlements.record(dto, idemKey);
  }

  @Post('settlements/:id/verify')
  @RequirePermission('settlement.verify')
  verifySettlement(@Param('id') id: string) {
    return this.settlements.verify(id);
  }

  @Post('settlements/:id/complete')
  @RequirePermission('settlement.verify')
  completeSettlement(@Param('id') id: string) {
    return this.settlements.complete(id);
  }

  @Post('settlements/:id/adjustments')
  @RequirePermission('settlement.record')
  adjust(@Param('id') id: string, @Body() dto: AdjustmentDto) {
    return this.settlements.adjust(id, dto);
  }

  @Get('settlements/mine')
  @RequirePermission('order.read')
  mySettlements() {
    return this.settlements.listMine();
  }

  @Get('settlements/order/:orderId')
  @RequirePermission('order.read')
  settlementsForOrder(@Param('orderId') orderId: string) {
    return this.settlements.listForOrder(orderId);
  }
}
