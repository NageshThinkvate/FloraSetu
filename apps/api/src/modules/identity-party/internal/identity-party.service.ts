import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { IdentityPartyService } from '../contracts';

@Injectable()
export class IdentityPartyServiceImpl implements IdentityPartyService {
  constructor(private readonly db: DatabaseService) {}

  contextKey(): 'identity-party' {
    return 'identity-party';
  }

  async orgExists(orgId: string): Promise<boolean> {
    const r = await this.db.query('SELECT 1 FROM identity.organizations WHERE id = $1', [orgId]);
    return (r.rowCount ?? 0) > 0;
  }

  async userExists(userId: string): Promise<boolean> {
    const r = await this.db.query('SELECT 1 FROM identity.users WHERE id = $1', [userId]);
    return (r.rowCount ?? 0) > 0;
  }
}
