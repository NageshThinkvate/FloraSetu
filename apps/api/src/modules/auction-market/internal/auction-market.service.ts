import { Injectable } from '@nestjs/common';
import { AuctionMarketService } from '../contracts';

@Injectable()
export class AuctionMarketServiceImpl implements AuctionMarketService {
  contextKey(): 'auction-market' {
    return 'auction-market';
  }
}
