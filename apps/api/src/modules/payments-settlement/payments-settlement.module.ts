import { Global, Module } from '@nestjs/common';
import { PaymentsSettlement_SERVICE } from './contracts';
import { PaymentsService } from './internal/payments.service';
import { SettlementsService } from './internal/settlements.service';
import { PaymentsSettlementServiceImpl } from './internal/payments-settlement.service';
import { PaymentsController } from './internal/payments.controller';

// Global contract provider: other contexts inject PaymentsSettlement_SERVICE without
// importing this module (docs/04 — contracts-only boundary, enforced mechanically).
@Global()
@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    SettlementsService,
    { provide: PaymentsSettlement_SERVICE, useClass: PaymentsSettlementServiceImpl }
  ],
  exports: [PaymentsSettlement_SERVICE]
})
export class PaymentsSettlementModule {}
