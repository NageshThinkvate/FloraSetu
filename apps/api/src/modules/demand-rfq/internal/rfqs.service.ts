import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ReferenceIdService } from '../../../common/pagination/reference-id.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { claimIdempotencyKey, completeIdempotencyKey, hashRequest } from '../../../common/idempotency/idempotency.service';
import { CatalogStandards_SERVICE, CatalogStandardsService } from '../../catalog-standards/contracts';
import { IdentityParty_SERVICE, IdentityPartyService } from '../../identity-party/contracts';
import { Notifications_SERVICE, NotificationsService } from '../../notifications/contracts';
import { assertRequirementTransition, isOps } from './demand-policies';
import { CancelDto, DeclineInvitationDto, PublishRfqDto } from './dto';

@Injectable()
export class RfqsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    @Inject(CatalogStandards_SERVICE) private readonly catalogService: CatalogStandardsService,
    @Inject(IdentityParty_SERVICE) private readonly identityService: IdentityPartyService,
    @Inject(Notifications_SERVICE) private readonly notificationsService: NotificationsService
  ) {}

  async publish(requirementId: string, dto: PublishRfqDto, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const hash = hashRequest({ requirementId, dto });
    const outcome = await this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'rfq.publish', idemKey, hash);
      if (claim.state === 'replay') {
        return claim;
      }
      const locked = await client.query<{
        org_id: string; status: string; mode: string; current_version_no: number; title: string;
      }>(`SELECT org_id, status, mode, current_version_no, title FROM demand.requirements WHERE id = $1 FOR UPDATE`,
        [requirementId]);
      const req = locked.rows[0];
      if (!req) {
        throw new ApiException(404, 'NOT_FOUND', 'Requirement not found');
      }
      if (req.org_id !== orgId && !isOps(ctx)) {
        throw new ApiException(404, 'NOT_FOUND', 'Requirement not found');
      }
      if (!['SUBMITTED', 'SOURCING'].includes(req.status)) {
        throw new ApiException(409, 'CONFLICT', `Requirement in ${req.status} cannot be published to RFQ`);
      }
      const existing = await client.query<{ id: string; ref: string }>(
        `SELECT id, ref FROM demand.rfqs WHERE requirement_id = $1 AND status IN ('DRAFT','PUBLISHED')`,
        [requirementId]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        throw new ApiException(409, 'CONFLICT', 'An open RFQ already exists for this requirement', {
          rfqId: existing.rows[0].id
        });
      }
      const version = await client.query<{ id: string }>(
        `SELECT id FROM demand.requirement_versions WHERE requirement_id = $1 AND version_no = $2`,
        [requirementId, req.current_version_no]
      );
      const lines = await client.query(
        `SELECT id, variety_id, quantity, master_snapshot FROM demand.requirement_lines
         WHERE requirement_id = $1 AND requirement_version_id = $2`,
        [requirementId, version.rows[0].id]
      );

      // Supplier pool: explicit list (FORMAL) or capability-matched managed sourcing (QUICK/managed).
      let supplierIds = dto.supplierOrgIds ?? [];
      if (supplierIds.length === 0) {
        const commodityIds = await client.query<{ commodity_id: string }>(
          `SELECT DISTINCT commodity_id FROM demand.requirement_lines
           WHERE requirement_id = $1 AND requirement_version_id = $2`,
          [requirementId, version.rows[0].id]
        );
        const capable = await this.catalogService.findCapableSuppliers(commodityIds.rows.map((r) => r.commodity_id));
        supplierIds = await this.identityService.filterActiveOrgs(capable, true);
      }
      supplierIds = supplierIds.filter((s) => s !== req.org_id);

      const ref = await this.refIds.next(client, 'RFQ');
      const rfq = await client.query<{ id: string }>(
        `INSERT INTO demand.rfqs
           (ref, org_id, requirement_id, requirement_version_id, mode, title, status,
            quote_deadline, clarification_deadline, commercial_instructions, delivery_requirements,
            published_at, published_by)
         VALUES ($1,$2,$3,$4,$5,$6,'PUBLISHED',$7,$8,$9,$10,now(),$11) RETURNING id`,
        [ref, req.org_id, requirementId, version.rows[0].id, req.mode, req.title,
         dto.quoteDeadline ?? null, dto.clarificationDeadline ?? null,
         dto.commercialInstructions ?? null, dto.deliveryRequirements ?? null, ctx.userId]
      );
      const rfqId = rfq.rows[0].id;
      for (const line of lines.rows) {
        await client.query(
          `INSERT INTO demand.rfq_lines (rfq_id, variety_id, qty, requirement_line_id, master_snapshot)
           VALUES ($1,$2,$3,$4,$5)`,
          [rfqId, line.variety_id, line.quantity, line.id, line.master_snapshot]
        );
      }
      for (const supplierOrgId of supplierIds) {
        await client.query(
          `INSERT INTO demand.rfq_invitations (rfq_id, supplier_org_id, status)
           VALUES ($1,$2,'INVITED') ON CONFLICT (rfq_id, supplier_org_id) DO NOTHING`,
          [rfqId, supplierOrgId]
        );
      }
      if (req.status === 'SUBMITTED') {
        assertRequirementTransition('SUBMITTED', 'SOURCING');
        await client.query(
          `UPDATE demand.requirements SET status = 'SOURCING', version = version + 1, updated_at = now() WHERE id = $1`,
          [requirementId]
        );
      }
      await this.audit.record(client, {
        action: 'rfq.publish', objectType: 'rfq', objectId: rfqId, objectRef: ref,
        after: { requirementId, suppliersInvited: supplierIds.length, mode: req.mode }
      });
      await this.outbox.emit(client, {
        aggregateType: 'rfq', aggregateId: rfqId, type: 'rfq.published',
        payload: { rfqId, requirementId }
      });
      for (const supplierOrgId of supplierIds) {
        await this.outbox.emit(client, {
          aggregateType: 'rfq', aggregateId: rfqId, type: 'rfq.invitation.sent',
          payload: { rfqId, supplierOrgId }
        });
      }
      const body = { id: rfqId, ref, status: 'PUBLISHED', suppliersInvited: supplierIds.length };
      await completeIdempotencyKey(client, orgId, 'rfq.publish', idemKey, 201, body);
      return { state: 'fresh' as const, responseBody: body };
    });
    const rfqId = (outcome.responseBody as { id: string }).id;
    if (outcome.state !== 'replay') {
      const invited = await this.db.query<{ supplier_org_id: string }>(
        `SELECT supplier_org_id FROM demand.rfq_invitations WHERE rfq_id = $1`, [rfqId]);
      for (const row of invited.rows) {
        await this.notificationsService.queue(row.supplier_org_id, null, 'rfq.invitation', { rfqId });
      }
    }
    return outcome.responseBody;
  }

  async listMine(): Promise<{ items: unknown[] }> {
    const orgId = RequestContext.requireOrgId();
    const result = await this.db.query(
      `SELECT r.id, r.ref, r.title, r.status, r.mode, r.quote_deadline, r.published_at,
              req.ref AS requirement_ref, req.status AS requirement_status,
              (SELECT count(*)::int FROM demand.rfq_invitations i WHERE i.rfq_id = r.id) AS invited,
              (SELECT count(*)::int FROM demand.quotations q WHERE q.rfq_id = r.id AND q.status = 'ACTIVE') AS quotes
       FROM demand.rfqs r JOIN demand.requirements req ON req.id = r.requirement_id
       WHERE r.org_id = $1 ORDER BY r.created_at DESC`,
      [orgId]
    );
    return { items: result.rows };
  }

  async inbox(): Promise<{ items: unknown[] }> {
    const orgId = RequestContext.requireOrgId();
    const result = await this.db.query(
      `SELECT r.id, r.ref, r.title, r.status, r.quote_deadline, r.published_at,
              i.id AS invitation_id, i.status AS invitation_status, r.org_id AS buyer_org_id
       FROM demand.rfq_invitations i
       JOIN demand.rfqs r ON r.id = i.rfq_id
       WHERE i.supplier_org_id = $1 AND r.status = 'PUBLISHED'
       ORDER BY r.published_at DESC`,
      [orgId]
    );
    return { items: result.rows };
  }

  async get(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const rfq = await this.db.query(
      `SELECT r.*, req.ref AS requirement_ref, req.status AS requirement_status,
              req.current_version_no, req.org_id AS buyer_org_id
       FROM demand.rfqs r JOIN demand.requirements req ON req.id = r.requirement_id
       WHERE r.id = $1`,
      [id]
    );
    if (rfq.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
    }
    const row = rfq.rows[0];
    const isBuyer = ctx.orgId === row.buyer_org_id;
    if (!isBuyer && !isOps(ctx)) {
      const invited = await this.db.query(
        `SELECT status FROM demand.rfq_invitations WHERE rfq_id = $1 AND supplier_org_id = $2`,
        [id, ctx.orgId]
      );
      if (invited.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
      }
      // Supplier view: own invitation + lines; no competitor data.
      const lines = await this.db.query(
        `SELECT rl.id, rl.requirement_line_id, rl.qty, rl.master_snapshot, req.quantity, req.uom_id,
                req.needed_at, req.delivery_destination, req.substitution_policy, req.master_snapshot AS req_snapshot
         FROM demand.rfq_lines rl JOIN demand.requirement_lines req ON req.id = rl.requirement_line_id
         WHERE rl.rfq_id = $1`,
        [id]
      );
      return {
        id: row.id, ref: row.ref, title: row.title, status: row.status, mode: row.mode,
        quote_deadline: row.quote_deadline, clarification_deadline: row.clarification_deadline,
        commercial_instructions: row.commercial_instructions, delivery_requirements: row.delivery_requirements,
        published_at: row.published_at, requirement_ref: row.requirement_ref,
        invitationStatus: invited.rows[0].status,
        lines: lines.rows
      };
    }
    const [lines, invitations, quotes] = await Promise.all([
      this.db.query(
        `SELECT rl.*, req.quantity AS req_qty, req.uom_id, req.needed_at, req.delivery_destination
         FROM demand.rfq_lines rl JOIN demand.requirement_lines req ON req.id = rl.requirement_line_id
         WHERE rl.rfq_id = $1`,
        [id]
      ),
      this.db.query(
        `SELECT i.supplier_org_id, i.status, i.decline_reason, i.viewed_at
         FROM demand.rfq_invitations i WHERE i.rfq_id = $1`,
        [id]
      ),
      this.db.query(
        `SELECT q.id, q.ref, q.supplier_org_id, q.current_version_no, q.status,
                v.valid_to, v.status AS version_status, v.submitted_at
         FROM demand.quotations q
         JOIN demand.quotation_versions v ON v.quotation_id = q.id AND v.version_no = q.current_version_no
         WHERE q.rfq_id = $1`,
        [id]
      )
    ]);
    return { ...row, lines: lines.rows, invitations: invitations.rows, quotations: quotes.rows };
  }

  private async invitationFor(rfqId: string, orgId: string) {
    const inv = await this.db.query<{ id: string; status: string }>(
      `SELECT id, status FROM demand.rfq_invitations WHERE rfq_id = $1 AND supplier_org_id = $2`,
      [rfqId, orgId]
    );
    if (inv.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
    }
    return inv.rows[0];
  }

  async markViewed(id: string): Promise<unknown> {
    const orgId = RequestContext.requireOrgId();
    const inv = await this.invitationFor(id, orgId);
    await this.db.query(
      `UPDATE demand.rfq_invitations SET status = 'VIEWED', viewed_at = COALESCE(viewed_at, now()), updated_at = now()
       WHERE id = $1 AND status = 'INVITED'`,
      [inv.id]
    );
    return { id: inv.id, status: 'VIEWED' };
  }

  async intend(id: string): Promise<unknown> {
    const orgId = RequestContext.requireOrgId();
    const inv = await this.invitationFor(id, orgId);
    if (inv.status === 'DECLINED') {
      throw new ApiException(409, 'CONFLICT', 'Invitation already declined');
    }
    await this.db.query(
      `UPDATE demand.rfq_invitations SET status = 'INTENDS_TO_QUOTE', updated_at = now() WHERE id = $1`,
      [inv.id]
    );
    return { id: inv.id, status: 'INTENDS_TO_QUOTE' };
  }

  async decline(id: string, dto: DeclineInvitationDto): Promise<unknown> {
    const orgId = RequestContext.requireOrgId();
    return this.db.withTransaction(async (client) => {
      const inv = await this.invitationFor(id, orgId);
      await client.query(
        `UPDATE demand.rfq_invitations SET status = 'DECLINED', decline_reason = $2, updated_at = now() WHERE id = $1`,
        [inv.id, dto.reason]
      );
      await this.audit.record(client, {
        action: 'rfq.invitation.decline', objectType: 'rfq_invitation', objectId: inv.id,
        after: { rfqId: id, reason: dto.reason }
      });
      const rfq = await client.query<{ org_id: string }>(`SELECT org_id FROM demand.rfqs WHERE id = $1`, [id]);
      await this.notificationsService.queue(rfq.rows[0].org_id, null, 'rfq.supplier.declined', {
        rfqId: id, supplierOrgId: orgId
      });
      return { id: inv.id, status: 'DECLINED' };
    });
  }

  async cancel(id: string, dto: CancelDto): Promise<unknown> {
    const ctx = RequestContext.get();
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ org_id: string; status: string }>(
        `SELECT org_id, status FROM demand.rfqs WHERE id = $1 FOR UPDATE`, [id]);
      const rfq = locked.rows[0];
      if (!rfq) {
        throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
      }
      if (ctx.orgId !== rfq.org_id && !isOps(ctx)) {
        throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
      }
      if (!['PUBLISHED', 'DRAFT'].includes(rfq.status)) {
        throw new ApiException(409, 'CONFLICT', `RFQ in ${rfq.status} cannot be cancelled`);
      }
      await client.query(
        `UPDATE demand.rfqs SET status = 'CANCELLED', cancel_reason = $2, version = version + 1, updated_at = now()
         WHERE id = $1`,
        [id, dto.reason]
      );
      await client.query(
        `UPDATE demand.quotations SET status = 'CLOSED', updated_at = now() WHERE rfq_id = $1 AND status = 'ACTIVE'`,
        [id]
      );
      await this.audit.record(client, {
        action: 'rfq.cancel', objectType: 'rfq', objectId: id, after: { reason: dto.reason }
      });
      await this.outbox.emit(client, {
        aggregateType: 'rfq', aggregateId: id, type: 'demand.cancelled', payload: { entity: 'rfq', id }
      });
      return { id, status: 'CANCELLED' };
    });
  }
}
