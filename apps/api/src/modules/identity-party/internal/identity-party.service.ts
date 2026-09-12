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

  async filterActiveOrgs(orgIds: string[], supplierSideOnly = false): Promise<string[]> {
    if (orgIds.length === 0) {
      return [];
    }
    const r = await this.db.query<{ id: string }>(
      `SELECT id FROM identity.organizations
       WHERE id = ANY($1) AND status = 'ACTIVE' AND deleted_at IS NULL
         AND ($2 = false OR type IN ('GROWER','GROWER_GROUP','IMPORTER','AGGREGATION_HUB',
              'WHOLESALER','QC_PARTNER','LOGISTICS_PROVIDER','COLD_CHAIN_PARTNER'))`,
      [orgIds, supplierSideOnly]
    );
    return r.rows.map((row) => row.id);
  }

  // ADR-004: open bank change with payout_freeze blocks new settlement payouts.
  async hasPayoutFreeze(orgId: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM identity.bank_change_requests
       WHERE org_id = $1 AND payout_freeze = true
         AND status IN ('PENDING_REVERIFICATION','APPROVED_FIRST') LIMIT 1`,
      [orgId]
    );
    return (r.rowCount ?? 0) > 0;
  }
}
