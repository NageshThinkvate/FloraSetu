import { Injectable } from '@nestjs/common';
import { PaymentsSettlementService } from '../contracts';

@Injectable()
export class PaymentsSettlementServiceImpl implements PaymentsSettlementService {
  contextKey(): 'payments-settlement' {
    return 'payments-settlement';
  }
}
