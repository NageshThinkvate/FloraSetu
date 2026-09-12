import { Module } from '@nestjs/common';
import { PaymentsSettlement_SERVICE } from './contracts';
import { PaymentsSettlementServiceImpl } from './internal/payments-settlement.service';

@Module({
  providers: [{ provide: PaymentsSettlement_SERVICE, useClass: PaymentsSettlementServiceImpl }],
  exports: [PaymentsSettlement_SERVICE]
})
export class PaymentsSettlementModule {}
