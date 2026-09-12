import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { SourcingNoteDto } from './dto';

// Managed Procurement Desk (operations). Reads span tenants; every action is audited.
@Injectable()
export class OpsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService
  ) {}

  async desk(): Promise<unknown> {
    const [needsSourcing, openRfqs, uncovered, clarifications, assisted] = await Promise.all([
      this.db.query(
        `SELECT r.id, r.ref, r.title, r.mode, r.org_id, r.created_at, r.assistance_requested
         FROM demand.requirements r
         WHERE r.status = 'SUBMITTED'
           AND NOT EXISTS (SELECT 1 FROM demand.rfqs q WHERE q.requirement_id = r.id AND q.status IN ('DRAFT','PUBLISHED'))
         ORDER BY r.created_at LIMIT 100`
      ),
      this.db.query(
        `SELECT q.id, q.ref, q.title, q.org_id, q.quote_deadline, q.published_at,
                (SELECT count(*)::int FROM demand.rfq_invitations i WHERE i.rfq_id = q.id AND i.status <> 'DECLINED') AS invited,
                (SELECT count(*)::int FROM demand.quotations qt WHERE qt.rfq_id = q.id AND qt.status = 'ACTIVE') AS quotes
         FROM demand.rfqs q WHERE q.status = 'PUBLISHED' ORDER BY q.quote_deadline NULLS LAST LIMIT 100`
      ),
      this.db.query(
        `SELECT r.id, r.ref, r.title, r.status, r.org_id,
                SUM(rl.quantity - COALESCE(aw.total, 0)) AS remaining_qty
         FROM demand.requirements r
         JOIN demand.requirement_versions rv ON rv.requirement_id = r.id AND rv.version_no = r.current_version_no
         JOIN demand.requirement_lines rl ON rl.requirement_version_id = rv.id
         LEFT JOIN (
           SELECT al.requirement_line_id, SUM(al.awarded_qty) AS total
           FROM demand.award_lines al JOIN demand.awards a ON a.id = al.award_id
           WHERE a.status = 'FINAL' GROUP BY al.requirement_line_id
         ) aw ON aw.requirement_line_id = rl.id
         WHERE r.status IN ('QUOTING','CLARIFICATION','EVALUATION','PARTIALLY_AWARDED')
         GROUP BY r.id, r.ref, r.title, r.status, r.org_id
         HAVING SUM(rl.quantity - COALESCE(aw.total, 0)) > 0
         LIMIT 100`
      ),
      this.db.query(
        `SELECT c.id, c.rfq_id, c.question, c.created_at, c.author_org_id, r.ref AS rfq_ref
         FROM demand.clarifications c JOIN demand.rfqs r ON r.id = c.rfq_id
         WHERE c.status = 'OPEN' ORDER BY c.created_at LIMIT 100`
      ),
      this.db.query(
        `SELECT r.id, r.ref, r.title, r.org_id, r.status FROM demand.requirements r
         WHERE r.assistance_requested = true AND r.status NOT IN ('CLOSED','CANCELLED','AWARDED','CONVERTED')
         ORDER BY r.created_at LIMIT 100`
      )
    ]);
    return {
      needsSourcing: needsSourcing.rows,
      openRfqs: openRfqs.rows.map((r) => ({
        ...r,
        deadlineRisk: r.quote_deadline
          ? new Date(r.quote_deadline as string).getTime() - Date.now() < 48 * 3600e3
          : false
      })),
      uncoveredDemand: uncovered.rows,
      openClarifications: clarifications.rows,
      assistanceRequested: assisted.rows
    };
  }

  async addSourcingNote(requirementId: string, dto: SourcingNoteDto): Promise<unknown> {
    const ctx = RequestContext.get();
    const exists = await this.db.query(`SELECT 1 FROM demand.requirements WHERE id = $1`, [requirementId]);
    if (exists.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Requirement not found');
    }
    return this.db.withTransaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO demand.sourcing_notes (requirement_id, operator_user_id, note) VALUES ($1,$2,$3) RETURNING id`,
        [requirementId, ctx.userId, dto.note]
      );
      await this.audit.record(client, {
        action: 'ops.sourcing_note', objectType: 'requirement', objectId: requirementId,
        after: { note: dto.note, operator: ctx.userId }
      });
      return { id: result.rows[0].id };
    });
  }

  async sourcingNotes(requirementId: string): Promise<{ items: unknown[] }> {
    const ctx = RequestContext.get();
    const req = await this.db.query<{ org_id: string }>(
      `SELECT org_id FROM demand.requirements WHERE id = $1`, [requirementId]);
    if (req.rowCount === 0
        || (ctx.orgId !== req.rows[0].org_id && !ctx.permissions.includes('procurement.manage'))) {
      throw new ApiException(404, 'NOT_FOUND', 'Requirement not found');
    }
    const result = await this.db.query(
      `SELECT id, operator_user_id, note, created_at FROM demand.sourcing_notes
       WHERE requirement_id = $1 ORDER BY created_at DESC`,
      [requirementId]
    );
    return { items: result.rows };
  }
}
