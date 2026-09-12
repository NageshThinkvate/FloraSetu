import { Module } from '@nestjs/common';
import { AnalyticsControltower_SERVICE } from './contracts';
import { AnalyticsControltowerServiceImpl } from './internal/analytics-controltower.service';

@Module({
  providers: [{ provide: AnalyticsControltower_SERVICE, useClass: AnalyticsControltowerServiceImpl }],
  exports: [AnalyticsControltower_SERVICE]
})
export class AnalyticsControltowerModule {}
