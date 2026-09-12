import { Injectable } from '@nestjs/common';
import { ClaimsSupportService } from '../contracts';

@Injectable()
export class ClaimsSupportServiceImpl implements ClaimsSupportService {
  contextKey(): 'claims-support' {
    return 'claims-support';
  }
}
