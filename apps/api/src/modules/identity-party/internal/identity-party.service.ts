import { Injectable } from '@nestjs/common';
import { IdentityPartyService } from '../contracts';

@Injectable()
export class IdentityPartyServiceImpl implements IdentityPartyService {
  contextKey(): 'identity-party' {
    return 'identity-party';
  }
}
