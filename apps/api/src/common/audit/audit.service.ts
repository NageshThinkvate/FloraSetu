import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { RequestContext } from '../request-context';

export interface AuditEntry {
  action: string;
  objectType: string;
  objectId: string;
  objectRef?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  // Writes in the SAME transaction as the mutation it audits.
  async record(client: PoolClient, entry: AuditEntry): Promise<void> {
    const ctx = RequestContext.get();
    await client.query(
      `INSERT INTO core.audit_events
        (org_id, actor_user_id, actor_roles, action, object_type, object_id, object_ref, before, after, trace_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        ctx.orgId ?? null,
        ctx.userId ?? null,
        ctx.roles,
        entry.action,
        entry.objectType,
        entry.objectId,
        entry.objectRef ?? null,
        entry.before ? JSON.stringify(entry.before) : null,
        entry.after ? JSON.stringify(entry.after) : null,
        ctx.traceId
      ]
    );
  }

  async recordSecurity(eventType: string, severity: 'INFO' | 'WARN' | 'HIGH', detail: Record<string, unknown>): Promise<void> {
    const ctx = RequestContext.maybeGet();
    await this.db.query(
      `INSERT INTO core.security_audit_events (org_id, actor_user_id, event_type, severity, detail, trace_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        ctx?.orgId ?? null,
        ctx?.userId ?? null,
        eventType,
        severity,
        JSON.stringify(detail),
        ctx?.traceId ?? null
      ]
    );
  }
}
