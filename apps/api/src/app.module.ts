import { DynamicModule, Module } from '@nestjs/common';
import { AppConfig } from './config/configuration';
import { CommonModule } from './common/common.module';
import { IdentityPartyModule } from './modules/identity-party/identity-party.module';
import { CatalogStandardsModule } from './modules/catalog-standards/catalog-standards.module';
import { SupplyInventoryModule } from './modules/supply-inventory/supply-inventory.module';
import { DemandRfqModule } from './modules/demand-rfq/demand-rfq.module';
import { AuctionMarketModule } from './modules/auction-market/auction-market.module';
import { OrderAllocationModule } from './modules/order-allocation/order-allocation.module';
import { QualityTraceabilityModule } from './modules/quality-traceability/quality-traceability.module';
import { LogisticsColdchainModule } from './modules/logistics-coldchain/logistics-coldchain.module';
import { PaymentsSettlementModule } from './modules/payments-settlement/payments-settlement.module';
import { ClaimsSupportModule } from './modules/claims-support/claims-support.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnalyticsControltowerModule } from './modules/analytics-controltower/analytics-controltower.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CommonModule.forRoot(config),
        IdentityPartyModule,
        CatalogStandardsModule,
        SupplyInventoryModule,
        DemandRfqModule,
        AuctionMarketModule,
        OrderAllocationModule,
        QualityTraceabilityModule,
        LogisticsColdchainModule,
        PaymentsSettlementModule,
        ClaimsSupportModule,
        NotificationsModule,
        AnalyticsControltowerModule
      ]
    };
  }
}
