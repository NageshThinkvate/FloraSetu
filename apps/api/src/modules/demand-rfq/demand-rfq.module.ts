import { Module } from '@nestjs/common';
import { DemandRfq_SERVICE } from './contracts';
import { DemandRfqServiceImpl } from './internal/demand-rfq.service';

@Module({
  providers: [{ provide: DemandRfq_SERVICE, useClass: DemandRfqServiceImpl }],
  exports: [DemandRfq_SERVICE]
})
export class DemandRfqModule {}
