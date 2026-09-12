import { Module } from '@nestjs/common';
import { LogisticsColdchain_SERVICE } from './contracts';
import { LogisticsColdchainServiceImpl } from './internal/logistics-coldchain.service';

@Module({
  providers: [{ provide: LogisticsColdchain_SERVICE, useClass: LogisticsColdchainServiceImpl }],
  exports: [LogisticsColdchain_SERVICE]
})
export class LogisticsColdchainModule {}
