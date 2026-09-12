import { Injectable } from '@nestjs/common';
import { OrderAllocationService } from '../contracts';

@Injectable()
export class OrderAllocationServiceImpl implements OrderAllocationService {
  contextKey(): 'order-allocation' {
    return 'order-allocation';
  }
}
