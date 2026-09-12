import { Global, Module } from '@nestjs/common';
import { DemandRfq_SERVICE } from './contracts';
import { DemandRfqServiceImpl } from './internal/demand-rfq.service';
import { EventsService } from './internal/events.service';
import { EventsController } from './internal/events.controller';
import { RequirementsService } from './internal/requirements.service';
import { RequirementsController } from './internal/requirements.controller';
import { RfqsService } from './internal/rfqs.service';
import { RfqsController } from './internal/rfqs.controller';
import { QuotesService } from './internal/quotes.service';
import { AwardsService } from './internal/awards.service';
import { ClarificationsService } from './internal/clarifications.service';
import { OpsService } from './internal/ops.service';
import { OpsController } from './internal/ops.controller';

// Cross-context dependencies are injected via contract tokens only; the provider
// modules are @Global, so no module imports appear here (docs/04 boundary rule).
// Global contract provider: order-allocation, supply, quality, logistics, payments
// and claims inject DemandRfq_SERVICE without importing this module (docs/04 boundary).
@Global()
@Module({
  controllers: [EventsController, RequirementsController, RfqsController, OpsController],
  providers: [
    EventsService,
    RequirementsService,
    RfqsService,
    QuotesService,
    AwardsService,
    ClarificationsService,
    OpsService,
    { provide: DemandRfq_SERVICE, useClass: DemandRfqServiceImpl }
  ],
  exports: [DemandRfq_SERVICE]
})
export class DemandRfqModule {}
