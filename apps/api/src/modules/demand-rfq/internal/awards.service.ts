import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ReferenceIdService } from '../../../common/pagination/reference-id.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { claimIdempotencyKey, completeIdempotencyKey, hashRequest } from '../../../common/idempotency/idempotency.service';
import { Notifications_SERVICE, NotificationsService } from '../../notifications/contracts';
import { CreateAwardDto } from './dto';

@Injectable()
export class AwardsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    @Inject(Notifications_SERVICE) private readonly notificationsService: NotificationsService
  ) {}

  // Award invariants (ADR-001): sum(awards per requirement line) <= requirement quantity;
  // never silently partial-fill; concurrent awards serialized by row locks.
  async create(rfqId: string, dto: CreateAwardDto, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const hash = hashRequest({ rfqId, dto });
    const outcome = await this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'award.create', idemKey, hash);
      if (claim.state === 'replay') {
        return claim;
      }
      const rfqLock = await client.query<{
        id: string; org_id: string; status: string; requirement_id: string;
      }>(`SELECT id, org_id, status, requirement_id FROM demand.rfqs WHERE id = $1 FOR UPDATE`, [rfqId]);
      const rfq = rfqLock.rows[0];
      if (!rfq) {
        throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
      }
      if (rfq.org_id !== orgId) {
        // Supplier can never award; other buyers see nothing.
        throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
      }
      if (rfq.status === 'CANCELLED') {
        throw new ApiException(409, 'CONFLICT', 'Cancelled RFQ cannot be awarded', { code_detail: 'RFQ_CANCELLED' });
      }
      if (!['PUBLISHED', 'CLOSED', 'PARTIALLY_AWARDED'].includes(rfq.status)) {
        throw new ApiException(409, 'CONFLICT', `RFQ in ${rfq.status} cannot be awarded`);
      }
      const reqLock = await client.query<{ status: string; org_id: string }>(
        `SELECT status, org_id FROM demand.requirements WHERE id = $1 FOR UPDATE`, [rfq.requirement_id]);
      const req = reqLock.rows[0];
      if (req.status === 'CANCELLED') {
        throw new ApiException(409, 'CONFLICT', 'Cancelled requirement cannot be awarded', { code_detail: 'REQUIREMENT_CANCELLED' });
      }
      if (!['EVALUATION', 'PARTIALLY_AWARDED', 'QUOTING', 'CLARIFICATION'].includes(req.status)) {
        throw new ApiException(409, 'CONFLICT', `Requirement in ${req.status} cannot be awarded`);
      }

      // Deviation / substitution acceptance requires explicit recorded buyer consent.
      const deviationCheck = await client.query(
        `SELECT 1 FROM demand.quotation_lines ql
         JOIN demand.quotation_versions qv ON qv.id = ql.quotation_version_id
         WHERE qv.id = ANY($1) AND (ql.deviation_note IS NOT NULL OR ql.proposes_substitution = true)
         LIMIT 1`,
        [dto.lines.map((l) => l.quotationVersionId)]
      );
      if (deviationCheck.rowCount && deviationCheck.rowCount > 0 && dto.consentAcceptedDeviations !== true) {
        throw new ApiException(400, 'VALIDATION_FAILED',
          'Quote contains deviations/substitution proposals; explicit buyer consent required', {
            code_detail: 'CONSENT_REQUIRED'
          });
      }

      const ref = await this.refIds.next(client, 'AWD');
      const award = await client.query<{ id: string }>(
        `INSERT INTO demand.awards (ref, rfq_id, requirement_id, buyer_org_id, conditions, buyer_consent, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [ref, rfqId, rfq.requirement_id, orgId, dto.conditions ?? null,
         dto.consentAcceptedDeviations ? JSON.stringify({ deviationsAccepted: true, at: new Date().toISOString(), by: ctx.userId }) : null,
         ctx.userId]
      );
      const awardId = award.rows[0].id;
      const touchedVersions = new Set<string>();

      for (const line of dto.lines) {
        const reqLine = await client.query<{ id: string; quantity: string; uom_id: string; master_snapshot: unknown }>(
          `SELECT rl.id, rl.quantity, rl.uom_id, rl.master_snapshot FROM demand.requirement_lines rl
           JOIN demand.requirement_versions rv ON rv.id = rl.requirement_version_id
           JOIN demand.requirements r ON r.id = rl.requirement_id
           WHERE rl.id = $1 AND rl.requirement_id = $2 AND rv.version_no = r.current_version_no
           FOR UPDATE OF rl`,
          [line.requirementLineId, rfq.requirement_id]
        );
        if (reqLine.rowCount === 0) {
          throw new ApiException(400, 'VALIDATION_FAILED', 'Requirement line not part of current requirement version');
        }
        const qv = await client.query<{
          id: string; status: string; valid_to: string; supplier_org_id: string; quotation_id: string;
          version_no: number;
        }>(
          `SELECT qv.id, qv.status, qv.valid_to, qv.version_no, q.supplier_org_id, qv.quotation_id
           FROM demand.quotation_versions qv
           JOIN demand.quotations q ON q.id = qv.quotation_id
           WHERE qv.id = $1 AND q.rfq_id = $2`,
          [line.quotationVersionId, rfqId]
        );
        if (qv.rowCount === 0) {
          throw new ApiException(400, 'VALIDATION_FAILED', 'Quotation version not part of this RFQ');
        }
        const quote = qv.rows[0];
        if (quote.supplier_org_id === orgId) {
          throw new ApiException(403, 'FORBIDDEN', 'Supplier cannot award itself', { code_detail: 'SELF_AWARD' });
        }
        const current = await client.query(
          `SELECT 1 FROM demand.quotations WHERE id = $1 AND current_version_no = $2`,
          [quote.quotation_id, quote.version_no]
        );
        if (current.rowCount === 0) {
          throw new ApiException(409, 'CONFLICT', 'Superseded quotation version cannot be awarded', {
            code_detail: 'QUOTE_SUPERSEDED'
          });
        }
        // SUBMITTED and PARTIALLY_ACCEPTED versions remain awardable for remaining quantity.
        if (!['SUBMITTED', 'PARTIALLY_ACCEPTED'].includes(quote.status)) {
          throw new ApiException(409, 'CONFLICT', `Quotation version is ${quote.status}`, {
            code_detail: quote.status === 'RECONFIRMATION_REQUIRED' ? 'RECONFIRMATION_REQUIRED' : 'QUOTE_NOT_AWARDABLE'
          });
        }
        if (new Date(quote.valid_to).getTime() <= Date.now()) {
          throw new ApiException(409, 'CONFLICT', 'Quotation expired; award blocked (reconfirm/extend first)', {
            code_detail: 'QUOTE_EXPIRED'
          });
        }
        const qline = await client.query<{ unit_price_minor: string; currency: string }>(
          `SELECT unit_price_minor, currency FROM demand.quotation_lines
           WHERE quotation_version_id = $1 AND requirement_line_id = $2`,
          [line.quotationVersionId, line.requirementLineId]
        );
        if (qline.rowCount === 0) {
          throw new ApiException(400, 'VALIDATION_FAILED', 'Quotation does not cover this requirement line');
        }
        // Quantity invariant under row lock: never oversubscribe buyer demand.
        const awarded = await client.query<{ total: string | null }>(
          `SELECT SUM(al.awarded_qty) AS total FROM demand.award_lines al
           JOIN demand.awards a ON a.id = al.award_id
           WHERE al.requirement_line_id = $1 AND a.status = 'FINAL'`,
          [line.requirementLineId]
        );
        const remaining = Number(reqLine.rows[0].quantity) - Number(awarded.rows[0].total ?? 0);
        if (line.awardedQty > remaining) {
          throw new ApiException(409, 'CONFLICT',
            `Award exceeds remaining requirement quantity (${remaining})`, {
              code_detail: 'EXCEEDS_REQUIREMENT', remaining
            });
        }
        await client.query(
          `INSERT INTO demand.award_lines
             (award_id, requirement_line_id, quotation_version_id, supplier_org_id, awarded_qty, uom_id,
              unit_price_minor, currency, accepted_spec)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [awardId, line.requirementLineId, line.quotationVersionId, quote.supplier_org_id,
           line.awardedQty, line.uomId, qline.rows[0].unit_price_minor, qline.rows[0].currency,
           JSON.stringify(reqLine.rows[0].master_snapshot)]
        );
        touchedVersions.add(line.quotationVersionId);
      }

      for (const versionId of touchedVersions) {
        // ACCEPTED only when every quoted line is fully awarded (in requirement UOM);
        // otherwise PARTIALLY_ACCEPTED so the remaining offered quantity stays awardable.
        await client.query(
          `UPDATE demand.quotation_versions qv SET status = CASE WHEN NOT EXISTS (
             SELECT 1 FROM demand.quotation_lines ql
             WHERE ql.quotation_version_id = qv.id
               AND COALESCE((
                 SELECT SUM(al.awarded_qty) FROM demand.award_lines al
                 JOIN demand.awards a ON a.id = al.award_id
                 WHERE al.quotation_version_id = qv.id AND al.requirement_line_id = ql.requirement_line_id
                   AND a.status = 'FINAL'), 0) < COALESCE(ql.normalized_qty, ql.quoted_qty)
           ) THEN 'ACCEPTED' ELSE 'PARTIALLY_ACCEPTED' END
           WHERE qv.id = $1 AND qv.status IN ('SUBMITTED','PARTIALLY_ACCEPTED')`,
          [versionId]
        );
      }
      // Requirement/RFQ status: fully awarded only when every current line is fully covered.
      const coverage = await client.query<{ uncovered: number }>(
        `SELECT count(*)::int AS uncovered FROM (
           SELECT rl.id, rl.quantity - COALESCE(aw.total, 0) AS remaining
           FROM demand.requirement_lines rl
           JOIN demand.requirement_versions rv ON rv.id = rl.requirement_version_id
           JOIN demand.requirements r ON r.id = rl.requirement_id
           LEFT JOIN (
             SELECT al.requirement_line_id, SUM(al.awarded_qty) AS total
             FROM demand.award_lines al JOIN demand.awards a ON a.id = al.award_id
             WHERE a.status = 'FINAL' GROUP BY al.requirement_line_id
           ) aw ON aw.requirement_line_id = rl.id
           WHERE rl.requirement_id = $1 AND rv.version_no = r.current_version_no
         ) x WHERE remaining > 0`,
        [rfq.requirement_id]
      );
      const fullyAwarded = coverage.rows[0].uncovered === 0;
      await client.query(
        `UPDATE demand.requirements SET status = $2, version = version + 1, updated_at = now() WHERE id = $1`,
        [rfq.requirement_id, fullyAwarded ? 'AWARDED' : 'PARTIALLY_AWARDED']
      );
      await client.query(
        `UPDATE demand.rfqs SET status = $2, version = version + 1, updated_at = now() WHERE id = $1`,
        [rfqId, fullyAwarded ? 'AWARDED' : 'PARTIALLY_AWARDED']
      );
      await this.audit.record(client, {
        action: 'award.create', objectType: 'award', objectId: awardId, objectRef: ref,
        after: { rfqId, lines: dto.lines.length, fullyAwarded, consent: dto.consentAcceptedDeviations === true }
      });
      await this.outbox.emit(client, {
        aggregateType: 'award', aggregateId: awardId, type: 'award.created',
        payload: { awardId, rfqId, requirementId: rfq.requirement_id }
      });
      const body = { id: awardId, ref, fullyAwarded };
      await completeIdempotencyKey(client, orgId, 'award.create', idemKey, 201, body);
      return { state: 'fresh' as const, responseBody: body, awardId };
    });
    if (outcome.state === 'replay') {
      return { ...outcome.responseBody as object, replayed: true };
    }
    const { awardId } = outcome as unknown as { awardId: string };
    const suppliers = await this.db.query<{ supplier_org_id: string }>(
      `SELECT DISTINCT supplier_org_id FROM demand.award_lines WHERE award_id = $1`, [awardId]);
    for (const s of suppliers.rows) {
      await this.notificationsService.queue(s.supplier_org_id, null, 'award.received', { awardId, rfqId });
    }
    return outcome.responseBody;
  }

  async listForRfq(rfqId: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const rfq = await this.db.query<{ org_id: string }>(`SELECT org_id FROM demand.rfqs WHERE id = $1`, [rfqId]);
    if (rfq.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
    }
    const isBuyer = ctx.orgId === rfq.rows[0].org_id;
    const result = await this.db.query(
      `SELECT a.id, a.ref, a.status, a.conditions, a.created_at, a.buyer_org_id,
              (SELECT json_agg(al.*) FROM demand.award_lines al WHERE al.award_id = a.id) AS lines
       FROM demand.awards a WHERE a.rfq_id = $1 ORDER BY a.created_at DESC`,
      [rfqId]
    );
    if (isBuyer || ctx.permissions.includes('procurement.manage')) {
      return { items: result.rows };
    }
    // Supplier sees only own award lines, never competitors'.
    const own = result.rows
      .map((a) => ({ ...a, lines: (a.lines as { supplier_org_id: string }[] | null)?.filter((l) => l.supplier_org_id === ctx.orgId) ?? [] }))
      .filter((a) => (a.lines as unknown[]).length > 0);
    return { items: own };
  }

  // Build-3 boundary: inert future-order conversion interface. No order is created.
  async prepareOrderConversion(awardId: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const award = await this.db.query(
      `SELECT a.*, (SELECT json_agg(al.*) FROM demand.award_lines al WHERE al.award_id = a.id) AS lines
       FROM demand.awards a WHERE a.id = $1`,
      [awardId]
    );
    if (award.rowCount === 0 || (award.rows[0].buyer_org_id !== ctx.orgId
        && !ctx.permissions.includes('procurement.manage'))) {
      throw new ApiException(404, 'NOT_FOUND', 'Award not found');
    }
    if (award.rows[0].status !== 'FINAL') {
      throw new ApiException(409, 'CONFLICT', 'Cancelled award cannot be converted');
    }
    return {
      command: 'CreateOrderFromAward',
      awardId,
      requirementId: award.rows[0].requirement_id,
      buyerOrgId: award.rows[0].buyer_org_id,
      lines: award.rows[0].lines,
      status: 'PENDING_BUILD_5',
      note: 'Inert interface: order creation executes in the order-allocation build. No order was created.'
    };
  }
}
