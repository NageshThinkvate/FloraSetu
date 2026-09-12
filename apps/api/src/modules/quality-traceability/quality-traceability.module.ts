import { Module } from '@nestjs/common';
import { QualityTraceability_SERVICE } from './contracts';
import { QualityTraceabilityServiceImpl } from './internal/quality-traceability.service';

@Module({
  providers: [{ provide: QualityTraceability_SERVICE, useClass: QualityTraceabilityServiceImpl }],
  exports: [QualityTraceability_SERVICE]
})
export class QualityTraceabilityModule {}
