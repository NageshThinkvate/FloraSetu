import { Module } from '@nestjs/common';
import { AuctionMarket_SERVICE } from './contracts';
import { AuctionMarketServiceImpl } from './internal/auction-market.service';

@Module({
  providers: [{ provide: AuctionMarket_SERVICE, useClass: AuctionMarketServiceImpl }],
  exports: [AuctionMarket_SERVICE]
})
export class AuctionMarketModule {}
