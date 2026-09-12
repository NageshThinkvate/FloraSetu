import { Injectable } from '@nestjs/common';
import { LogisticsColdchainService } from '../contracts';

@Injectable()
export class LogisticsColdchainServiceImpl implements LogisticsColdchainService {
  contextKey(): 'logistics-coldchain' {
    return 'logistics-coldchain';
  }
}
