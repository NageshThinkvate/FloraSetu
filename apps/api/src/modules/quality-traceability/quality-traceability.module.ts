import { Global, Module } from '@nestjs/common';
import { QualityTraceability_SERVICE } from './contracts';
import { InspectionsService } from './internal/inspections.service';
import { CustodyService, QualityTraceabilityServiceImpl } from './internal/custody.service';
import { QualityController } from './internal/quality.controller';

// Global contract provider: other contexts inject QualityTraceability_SERVICE without
// importing this module (docs/04 — contracts-only boundary, enforced mechanically).
@Global()
@Module({
  controllers: [QualityController],
  providers: [
    InspectionsService,
    CustodyService,
    { provide: QualityTraceability_SERVICE, useClass: QualityTraceabilityServiceImpl }
  ],
  exports: [QualityTraceability_SERVICE]
})
export class QualityTraceabilityModule {}
