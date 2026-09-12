import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { Notifications_SERVICE, NotificationsService } from '../../notifications/contracts';
import { isOps } from './demand-policies';
import { CreateClarificationDto, RespondClarificationDto } from './dto';

@Injectable()
export class ClarificationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(Notifications_SERVICE) private readonly notificationsService: NotificationsService
  ) {}

  private async loadRfq(rfqId: string) {
    const rfq = await this.db.query<{ id: string; org_id: string; status: string; requirement_id: string }>(
      `SELECT id, org_id, status, requirement_id FROM demand.rfqs WHERE id = $1`, [rfqId]);
    if (rfq.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
    }
    return rfq.rows[0];
  }

  async post(rfqId: string, dto: CreateClarificationDto): Promise<unknown> {
    const ctx = RequestContext.get();
    const rfq = await this.loadRfq(rfqId);
    const isBuyer = ctx.orgId === rfq.org_id;
    if (!isBuyer && !isOps(ctx)) {
      const inv = await this.db.query(
        `SELECT 1 FROM demand.rfq_invitations WHERE rfq_id = $1 AND supplier_org_id = $2 AND status <> 'DECLINED'`,
        [rfqId, ctx.orgId]
      );
      if (inv.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
      }
    }
    if (rfq.status !== 'PUBLISHED') {
      throw new ApiException(409, 'CONFLICT', 'Clarifications only on open RFQs');
    }
    return this.db.withTransaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO demand.clarifications (rfq_id, author_user_id, author_org_id, question, visibility)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [rfqId, ctx.userId, ctx.orgId, dto.question, dto.visibility ?? 'BUYER_PRIVATE']
      );
      await this.audit.record(client, {
        action: 'rfq.clarification.post', objectType: 'clarification', objectId: result.rows[0].id,
        after: { rfqId, visibility: dto.visibility ?? 'BUYER_PRIVATE' }
      });
      // Never mutates requirement commercial terms — clarification is a separate record.
      await client.query(
        `UPDATE demand.requirements SET status = 'CLARIFICATION', version = version + 1, updated_at = now()
         WHERE id = $1 AND status = 'QUOTING'`,
        [rfq.requirement_id]
      );
      return { id: result.rows[0].id, status: 'OPEN' };
    }).then(async (r) => {
      await this.notificationsService.queue(rfq.org_id, null, 'rfq.clarification', { rfqId, clarificationId: (r as { id: string }).id });
      return r;
    });
  }

  async respond(clarificationId: string, dto: RespondClarificationDto): Promise<unknown> {
    const ctx = RequestContext.get();
    return this.db.withTransaction(async (client) => {
      const row = await client.query<{ id: string; rfq_id: string; author_org_id: string; buyer_org_id: string }>(
        `SELECT c.id, c.rfq_id, c.author_org_id, r.org_id AS buyer_org_id
         FROM demand.clarifications c JOIN demand.rfqs r ON r.id = c.rfq_id WHERE c.id = $1`,
        [clarificationId]
      );
      if (row.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Clarification not found');
      }
      const c = row.rows[0];
      if (ctx.orgId !== c.buyer_org_id && !isOps(ctx)) {
        throw new ApiException(404, 'NOT_FOUND', 'Clarification not found');
      }
      const updated = await client.query(
        `UPDATE demand.clarifications SET response = $2, responded_by = $3, responded_at = now(),
           visibility = COALESCE($4, visibility), status = 'ANSWERED'
         WHERE id = $1 AND status = 'OPEN' RETURNING id`,
        [clarificationId, dto.response, ctx.userId, dto.visibility ?? null]
      );
      if (updated.rowCount === 0) {
        throw new ApiException(409, 'CONFLICT', 'Clarification already answered or closed');
      }
      await this.audit.record(client, {
        action: 'rfq.clarification.respond', objectType: 'clarification', objectId: clarificationId,
        after: { visibility: dto.visibility }
      });
      return { id: clarificationId, status: 'ANSWERED' };
    }).then(async (r) => {
      const c = await this.db.query<{ author_org_id: string }>(
        `SELECT author_org_id FROM demand.clarifications WHERE id = $1`, [clarificationId]);
      await this.notificationsService.queue(c.rows[0].author_org_id, null, 'rfq.clarification.answered', { clarificationId });
      return r;
    });
  }

  async list(rfqId: string): Promise<{ items: unknown[] }> {
    const ctx = RequestContext.get();
    const rfq = await this.loadRfq(rfqId);
    const isBuyer = ctx.orgId === rfq.org_id || isOps(ctx);
    if (!isBuyer) {
      const inv = await this.db.query(
        `SELECT 1 FROM demand.rfq_invitations WHERE rfq_id = $1 AND supplier_org_id = $2`,
        [rfqId, ctx.orgId]
      );
      if (inv.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
      }
    }
    // Supplier sees own questions + PUBLIC answered ones; buyer sees everything.
    const result = isBuyer
      ? await this.db.query(
          `SELECT * FROM demand.clarifications WHERE rfq_id = $1 ORDER BY created_at`, [rfqId])
      : await this.db.query(
          `SELECT * FROM demand.clarifications
           WHERE rfq_id = $1 AND (author_org_id = $2 OR (visibility = 'PUBLIC' AND status = 'ANSWERED'))
           ORDER BY created_at`,
          [rfqId, ctx.orgId]
        );
    return { items: result.rows };
  }
}
