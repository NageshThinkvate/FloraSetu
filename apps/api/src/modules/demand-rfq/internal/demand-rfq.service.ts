import { Injectable } from '@nestjs/common';
import { DemandRfqService } from '../contracts';

@Injectable()
export class DemandRfqServiceImpl implements DemandRfqService {
  contextKey(): 'demand-rfq' {
    return 'demand-rfq';
  }
}
