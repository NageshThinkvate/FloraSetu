import { Inject, Injectable } from '@nestjs/common';
import { DemandRfq_SERVICE, DemandRfqService } from '../../demand-rfq/contracts';
import { OrderAllocation_SERVICE, OrderAllocationService } from '../../order-allocation/contracts';
import { SupplyInventory_SERVICE, SupplyInventoryService } from '../../supply-inventory/contracts';
import { QualityTraceability_SERVICE, QualityTraceabilityService } from '../../quality-traceability/contracts';
import { LogisticsColdchain_SERVICE, LogisticsColdchainService } from '../../logistics-coldchain/contracts';
import { PaymentsSettlement_SERVICE, PaymentsSettlementService } from '../../payments-settlement/contracts';
import { ClaimsSupport_SERVICE, ClaimsSupportService } from '../../claims-support/contracts';

// §24 Operations Pilot Control Tower: exception queues aggregated across contexts
// strictly through public contracts (docs/04 boundary). No analytics beyond queues.
@Injectable()
export class TowerService {
  constructor(
    @Inject(DemandRfq_SERVICE) private readonly demand: DemandRfqService,
    @Inject(OrderAllocation_SERVICE) private readonly orders: OrderAllocationService,
    @Inject(SupplyInventory_SERVICE) private readonly supply: SupplyInventoryService,
    @Inject(QualityTraceability_SERVICE) private readonly quality: QualityTraceabilityService,
    @Inject(LogisticsColdchain_SERVICE) private readonly logistics: LogisticsColdchainService,
    @Inject(PaymentsSettlement_SERVICE) private readonly payments: PaymentsSettlementService,
    @Inject(ClaimsSupport_SERVICE) private readonly claims: ClaimsSupportService
  ) {}

  async exceptions(): Promise<Record<string, unknown[]>> {
    const [finalAwards, converted, order, supply, quality, logistics, payments, claims] = await Promise.all([
      this.demand.listFinalAwards(),
      this.orders.convertedAwardIds(),
      this.orders.pilotExceptions(),
      this.supply.pilotExceptions(),
      this.quality.pilotExceptions(),
      this.logistics.pilotExceptions(),
      this.payments.pilotExceptions(),
      this.claims.pilotExceptions()
    ]);
    return {
      awardNotConverted: finalAwards.filter((a) => !converted.includes(a.id)),
      ...order,
      ...supply,
      ...quality,
      ...logistics,
      ...payments,
      ...claims
    };
  }
}
