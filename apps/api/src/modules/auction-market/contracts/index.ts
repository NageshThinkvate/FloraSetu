// Public contract surface of the AuctionMarket bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface AuctionMarketService {
  contextKey(): 'auction-market';
}

export const AuctionMarket_SERVICE = 'AuctionMarket_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type AuctionMarketEvent =
  | { v: 1; type: 'auction-market.scaffold.ready'; at: string };
