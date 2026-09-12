import { Injectable } from '@nestjs/common';
import { SupplyInventoryService } from '../contracts';

@Injectable()
export class SupplyInventoryServiceImpl implements SupplyInventoryService {
  contextKey(): 'supply-inventory' {
    return 'supply-inventory';
  }
}
