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

  // ADR-013 (Phase 6): staff claim search — reference-first, no raw UUID workflows.
  async searchClaims(q: string): Promise<{ id: string; ref: string; orderId: string | null; status: string; category: string }[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT id, ref, order_id, status, category FROM claims.claims
       WHERE deleted_at IS NULL AND ref ILIKE $1 ORDER BY created_at DESC LIMIT 10`,
      [`%${q}%`]);
    return rows.rows.map((c) => ({
      id: c.id as string, ref: c.ref as string, orderId: (c.order_id as string | null) ?? null,
      status: c.status as string, category: c.category as string
    }));
  }

  async pilotExceptions(): Promise<Record<string, unknown[]>> {
    const open = await this.db.query(
      `SELECT id, ref, order_id, category, status, created_at FROM claims.claims
       WHERE deleted_at IS NULL AND status NOT IN ('CLOSED','REJECTED')
       ORDER BY created_at LIMIT 50`);
    return { claimOpen: open.rows };
  }
}
