import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { ClaimsSupportService } from '../contracts';

@Injectable()
export class ClaimsSupportServiceImpl implements ClaimsSupportService {
  constructor(private readonly db: DatabaseService) {}

  contextKey(): 'claims-support' {
    return 'claims-support';
  }

  async hasOpenClaim(orderId: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM claims.claims
       WHERE order_id = $1 AND deleted_at IS NULL
         AND status NOT IN ('CLOSED','REJECTED') LIMIT 1`,
      [orderId]);
    return (r.rowCount ?? 0) > 0;
  }

  async pilotExceptions(): Promise<Record<string, unknown[]>> {
    const open = await this.db.query(
      `SELECT id, ref, order_id, category, status, created_at FROM claims.claims
       WHERE deleted_at IS NULL AND status NOT IN ('CLOSED','REJECTED')
       ORDER BY created_at LIMIT 50`);
    return { claimOpen: open.rows };
  }
}
