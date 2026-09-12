import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ReferenceIdService } from '../../../common/pagination/reference-id.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { claimIdempotencyKey, completeIdempotencyKey, hashRequest } from '../../../common/idempotency/idempotency.service';
import { CatalogStandards_SERVICE, CatalogStandardsService } from '../../catalog-standards/contracts';
import { Notifications_SERVICE, NotificationsService } from '../../notifications/contracts';
import { assertBuyerAccess, assertBuyerOrOps, assertRequirementTransition, isOps } from './demand-policies';
import { CancelDto, CreateRequirementDto, RequirementLineDto, ReviseRequirementDto } from './dto';
import { RfqsService } from './rfqs.service';

const REVISABLE_STATES = ['SUBMITTED', 'SOURCING', 'QUOTING', 'CLARIFICATION', 'EVALUATION'];

@Injectable()
export class RequirementsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    @Inject(CatalogStandards_SERVICE) private readonly catalogService: CatalogStandardsService,
    @Inject(Notifications_SERVICE) private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => RfqsService)) private readonly rfqs: RfqsService
  ) {}

  private requireOrg(): string {
    return RequestContext.requireOrgId();
  }

  private async buildLineRows(client: PoolClient, requirementId: string, versionId: string, lines: RequirementLineDto[]) {
    const rows: unknown[][] = [];
    for (const line of lines) {
      if (!line.uomId) {
        throw new ApiException(400, 'VALIDATION_FAILED', 'Explicit uomId is required on every requirement line', {
          code_detail: 'UOM_REQUIRED'
        });
      }
      // GUARDRAIL B: authoritative server-side commercial-master eligibility.
      const { masterSnapshot } = await this.catalogService.assertCommercialLine({
        commodityId: line.commodityId,
        varietyId: line.varietyId ?? null,
        gradeProfileId: line.gradeProfileId ?? null,
        packDefinitionId: line.packDefinitionId ?? null,
        uomId: line.uomId
      });
      if (line.bomLineId) {
        const bom = await client.query(
          `SELECT 1 FROM demand.event_bom_lines WHERE id = $1`, [line.bomLineId]);
        if (bom.rowCount === 0) {
          throw new ApiException(400, 'VALIDATION_FAILED', 'BOM line not found');
        }
      }
      rows.push([
        requirementId, versionId, line.bomLineId ?? null, line.commodityId, line.varietyId ?? null,
        line.colourCode ?? null, line.gradeProfileId ?? null, line.stemLengthCmMin ?? null,
        line.stemLengthCmMax ?? null, line.bloomStage ?? null, line.packDefinitionId ?? null,
        line.quantity, line.uomId, line.neededAt, line.deliveryDestination,
        JSON.stringify(line.substitutionPolicy ?? {}), line.notes ?? null,
        JSON.stringify(line.attachments ?? []),
        JSON.stringify({ ...masterSnapshot, colourCode: line.colourCode ?? null, bloomStage: line.bloomStage ?? null })
      ]);
    }
    return rows;
  }

  private async insertLines(client: PoolClient, rows: unknown[][]): Promise<string[]> {
    const ids: string[] = [];
    for (const r of rows) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO demand.requirement_lines
           (requirement_id, requirement_version_id, bom_line_id, commodity_id, variety_id, colour_code,
            grade_profile_id, stem_length_cm_min, stem_length_cm_max, bloom_stage, pack_definition_id,
            quantity, uom_id, needed_at, delivery_destination, substitution_policy, notes, attachments, master_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
        r
      );
      ids.push(result.rows[0].id);
      if (r[2]) {
        await client.query(
          `UPDATE demand.event_bom_lines SET requirement_line_id = $1, sourcing_status = 'SOURCING' WHERE id = $2`,
          [result.rows[0].id, r[2]]
        );
      }
    }
    return ids;
  }

  async createDraft(dto: CreateRequirementDto): Promise<unknown> {
    const orgId = this.requireOrg();
    if (dto.eventId) {
      const ev = await this.db.query(
        `SELECT 1 FROM demand.events WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`, [dto.eventId, orgId]);
      if (ev.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Event not found');
      }
    }
    return this.db.withTransaction(async (client) => {
      const ref = await this.refIds.next(client, 'REQ');
      const req = await client.query<{ id: string }>(
        `INSERT INTO demand.requirements (ref, org_id, event_id, mode, title, assistance_requested)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [ref, orgId, dto.eventId ?? null, dto.mode, dto.title, dto.assistanceRequested ?? false]
      );
      const requirementId = req.rows[0].id;
      const version = await client.query<{ id: string }>(
        `INSERT INTO demand.requirement_versions (requirement_id, version_no, changed_by)
         VALUES ($1, 1, $2) RETURNING id`,
        [requirementId, RequestContext.get().userId]
      );
      const lineRows = await this.buildLineRows(client, requirementId, version.rows[0].id, dto.lines);
      const lineIds = await this.insertLines(client, lineRows);
      await this.audit.record(client, {
        action: 'demand.requirement.create', objectType: 'requirement', objectId: requirementId,
        objectRef: ref, after: { mode: dto.mode, title: dto.title, lines: lineIds.length }
      });
      return { id: requirementId, ref, status: 'DRAFT', versionNo: 1 };
    });
  }

  async listMine(): Promise<{ items: unknown[] }> {
    const orgId = this.requireOrg();
    const result = await this.db.query(
      `SELECT r.id, r.ref, r.title, r.mode, r.status, r.current_version_no, r.assistance_requested,
              r.created_at, e.ref AS event_ref, e.name AS event_name,
              (SELECT count(*)::int FROM demand.requirement_lines rl
                JOIN demand.requirement_versions rv ON rv.id = rl.requirement_version_id
                WHERE rl.requirement_id = r.id AND rv.version_no = r.current_version_no) AS line_count
       FROM demand.requirements r LEFT JOIN demand.events e ON e.id = r.event_id
       WHERE r.org_id = $1 ORDER BY r.created_at DESC`,
      [orgId]
    );
    return { items: result.rows };
  }

  async get(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const req = await this.db.query(
      `SELECT r.*, e.name AS event_name, e.ref AS event_ref FROM demand.requirements r
       LEFT JOIN demand.events e ON e.id = r.event_id WHERE r.id = $1`,
      [id]
    );
    if (req.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Requirement not found');
    }
    assertBuyerOrOps(ctx, req.rows[0].org_id);
    const lines = await this.db.query(
      `SELECT rl.* FROM demand.requirement_lines rl
       JOIN demand.requirement_versions rv ON rv.id = rl.requirement_version_id
       JOIN demand.requirements r ON r.id = rl.requirement_id
       WHERE rl.requirement_id = $1 AND rv.version_no = r.current_version_no
       ORDER BY rl.created_at`,
      [id]
    );
    const versions = await this.db.query(
      `SELECT id, version_no, change_reason, changed_by, consent_required, consented_by, consented_at, created_at
       FROM demand.requirement_versions WHERE requirement_id = $1 ORDER BY version_no`,
      [id]
    );
    const awarded = await this.db.query(
      `SELECT al.requirement_line_id, SUM(al.awarded_qty) AS awarded
       FROM demand.award_lines al JOIN demand.awards a ON a.id = al.award_id
       WHERE a.requirement_id = $1 AND a.status = 'FINAL' GROUP BY al.requirement_line_id`,
      [id]
    );
    return {
      ...req.rows[0],
      lines: lines.rows,
      versions: versions.rows,
      awardedByLine: Object.fromEntries(awarded.rows.map((r) => [r.requirement_line_id, r.awarded]))
    };
  }

  async submit(id: string, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = this.requireOrg();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const hash = hashRequest({ id });
    const outcome = await this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'demand.requirement.submit', idemKey, hash);
      if (claim.state === 'replay') {
        return claim;
      }
      const locked = await client.query<{ status: string; org_id: string; mode: string }>(
        `SELECT status, org_id, mode FROM demand.requirements WHERE id = $1 FOR UPDATE`, [id]);
      const req = locked.rows[0];
      if (!req || req.org_id !== orgId) {
        throw new ApiException(404, 'NOT_FOUND', 'Requirement not found');
      }
      assertRequirementTransition(req.status, 'SUBMITTED');
      await client.query(
        `UPDATE demand.requirements SET status = 'SUBMITTED', version = version + 1, updated_at = now() WHERE id = $1`, [id]);
      await this.audit.record(client, {
        action: 'demand.requirement.submit', objectType: 'requirement', objectId: id, after: { mode: req.mode }
      });
      await this.outbox.emit(client, {
        aggregateType: 'requirement', aggregateId: id, type: 'demand.requirement.submitted',
        payload: { requirementId: id, orgId }
      });
      const body = { id, status: 'SUBMITTED' };
      await completeIdempotencyKey(client, orgId, 'demand.requirement.submit', idemKey, 201, body);
      return { state: 'fresh' as const, responseStatus: 201, responseBody: body };
    });
    if (outcome.state === 'replay') {
      return { ...outcome.responseBody as object, replayed: true };
    }
    // QUICK mode: managed procurement — auto-create + publish RFQ with capability-matched suppliers.
    if (ctx && (await this.modeOf(id)) === 'QUICK') {
      await this.rfqs.publish(id, {}, `auto-quick-${id}`);
    }
    return outcome.responseBody;
  }

  private async modeOf(id: string): Promise<string> {
    const r = await this.db.query<{ mode: string }>(`SELECT mode FROM demand.requirements WHERE id = $1`, [id]);
    return r.rows[0]?.mode;
  }

  async revise(id: string, dto: ReviseRequirementDto): Promise<unknown> {
    const ctx = RequestContext.get();
    const operatorOverride = isOps(ctx);
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{
        org_id: string; status: string; current_version_no: number;
      }>(`SELECT org_id, status, current_version_no FROM demand.requirements WHERE id = $1 FOR UPDATE`, [id]);
      const req = locked.rows[0];
      if (!req) {
        throw new ApiException(404, 'NOT_FOUND', 'Requirement not found');
      }
      if (ctx.orgId !== req.org_id && !operatorOverride) {
        throw new ApiException(404, 'NOT_FOUND', 'Requirement not found');
      }
      if (!REVISABLE_STATES.includes(req.status)) {
        throw new ApiException(409, 'CONFLICT', `Requirement in ${req.status} cannot be revised`);
      }
      const newVersionNo = req.current_version_no + 1;
      const consentRequired = operatorOverride && ctx.orgId !== req.org_id;
      const version = await client.query<{ id: string }>(
        `INSERT INTO demand.requirement_versions (requirement_id, version_no, change_reason, changed_by, consent_required)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [id, newVersionNo, dto.changeReason, ctx.userId, consentRequired]
      );
      const lineRows = await this.buildLineRows(client, id, version.rows[0].id, dto.lines);
      await this.insertLines(client, lineRows);
      await client.query(
        `UPDATE demand.requirements SET current_version_no = $2, version = version + 1, updated_at = now() WHERE id = $1`,
        [id, newVersionNo]
      );
      // Existing submitted quotes on open RFQs now require reconfirmation (never silently valid).
      const impacted = await client.query<{ id: string }>(
        `UPDATE demand.quotation_versions qv SET status = 'RECONFIRMATION_REQUIRED'
         FROM demand.quotations q, demand.rfqs r
         WHERE qv.quotation_id = q.id AND q.rfq_id = r.id AND r.requirement_id = $1
           AND r.status = 'PUBLISHED' AND qv.status = 'SUBMITTED'
         RETURNING qv.id`,
        [id]
      );
      await client.query(
        `UPDATE demand.rfqs SET requirement_version_id = $2, version = version + 1, updated_at = now()
         WHERE requirement_id = $1 AND status = 'PUBLISHED'`,
        [id, version.rows[0].id]
      );
      await this.audit.record(client, {
        action: consentRequired ? 'demand.requirement.revise.ops_override' : 'demand.requirement.revise',
        objectType: 'requirement', objectId: id,
        before: { versionNo: req.current_version_no },
        after: { versionNo: newVersionNo, changeReason: dto.changeReason, operatorOverride, consentRequired }
      });
      await this.outbox.emit(client, {
        aggregateType: 'requirement', aggregateId: id, type: 'demand.requirement.revised',
        payload: { requirementId: id, versionNo: newVersionNo }
      });
      const invited = await client.query<{ supplier_org_id: string }>(
        `SELECT DISTINCT supplier_org_id FROM demand.rfq_invitations i
         JOIN demand.rfqs r ON r.id = i.rfq_id WHERE r.requirement_id = $1 AND r.status = 'PUBLISHED'`,
        [id]
      );
      for (const row of invited.rows) {
        await this.notificationsService.queue(row.supplier_org_id, null, 'rfq.revision', { requirementId: id, versionNo: newVersionNo });
      }
      return {
        id, versionNo: newVersionNo, consentRequired,
        quotesRequiringReconfirmation: impacted.rowCount ?? 0
      };
    });
  }

  async beginEvaluation(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ org_id: string; status: string }>(
        `SELECT org_id, status FROM demand.requirements WHERE id = $1 FOR UPDATE`, [id]);
      const req = locked.rows[0];
      if (!req || (ctx.orgId !== req.org_id && !isOps(ctx))) {
        throw new ApiException(404, 'NOT_FOUND', 'Requirement not found');
      }
      assertRequirementTransition(req.status, 'EVALUATION');
      await client.query(
        `UPDATE demand.requirements SET status = 'EVALUATION', version = version + 1, updated_at = now() WHERE id = $1`,
        [id]);
      await this.audit.record(client, {
        action: 'demand.requirement.evaluate', objectType: 'requirement', objectId: id,
        after: { from: req.status }
      });
      return { id, status: 'EVALUATION' };
    });
  }

  async consent(id: string, versionNo: number): Promise<unknown> {
    const ctx = RequestContext.get();
    return this.db.withTransaction(async (client) => {
      const req = await client.query<{ org_id: string }>(
        `SELECT org_id FROM demand.requirements WHERE id = $1`, [id]);
      if (req.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Requirement not found');
      }
      assertBuyerAccess(ctx, req.rows[0].org_id);
      const updated = await client.query(
        `UPDATE demand.requirement_versions SET consented_by = $3, consented_at = now()
         WHERE requirement_id = $1 AND version_no = $2 AND consent_required = true AND consented_at IS NULL
         RETURNING id`,
        [id, versionNo, ctx.userId]
      );
      if (updated.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'No pending consent for this version');
      }
      await this.audit.record(client, {
        action: 'buyer.consent', objectType: 'requirement', objectId: id,
        after: { versionNo }
      });
      return { id, versionNo, consented: true };
    });
  }

  async cancel(id: string, dto: CancelDto): Promise<unknown> {
    const ctx = RequestContext.get();
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ org_id: string; status: string }>(
        `SELECT org_id, status FROM demand.requirements WHERE id = $1 FOR UPDATE`, [id]);
      const req = locked.rows[0];
      if (!req) {
        throw new ApiException(404, 'NOT_FOUND', 'Requirement not found');
      }
      if (ctx.orgId !== req.org_id && !isOps(ctx)) {
        throw new ApiException(404, 'NOT_FOUND', 'Requirement not found');
      }
      assertRequirementTransition(req.status, 'CANCELLED');
      await client.query(
        `UPDATE demand.requirements SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = now(),
           cancel_reason = $3, version = version + 1, updated_at = now() WHERE id = $1`,
        [id, ctx.userId, dto.reason]
      );
      const cancelledRfqs = await client.query<{ id: string }>(
        `UPDATE demand.rfqs SET status = 'CANCELLED', cancel_reason = $2, version = version + 1, updated_at = now()
         WHERE requirement_id = $1 AND status IN ('DRAFT','PUBLISHED','AWARDED','PARTIALLY_AWARDED') RETURNING id`,
        [id, dto.reason]
      );
      await client.query(
        `UPDATE demand.quotations q SET status = 'CLOSED', updated_at = now()
         FROM demand.rfqs r WHERE q.rfq_id = r.id AND r.requirement_id = $1 AND q.status = 'ACTIVE'`,
        [id]
      );
      const cancelledAwards = await client.query<{ id: string }>(
        `UPDATE demand.awards SET status = 'CANCELLED', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3
         WHERE requirement_id = $1 AND status = 'FINAL' RETURNING id`,
        [id, ctx.userId, dto.reason]
      );
      await this.audit.record(client, {
        action: 'demand.requirement.cancel', objectType: 'requirement', objectId: id,
        after: { reason: dto.reason, rfqsCancelled: cancelledRfqs.rowCount, awardsCancelled: cancelledAwards.rowCount }
      });
      await this.outbox.emit(client, {
        aggregateType: 'requirement', aggregateId: id, type: 'demand.cancelled',
        payload: { entity: 'requirement', id }
      });
      return { id, status: 'CANCELLED', rfqsCancelled: cancelledRfqs.rowCount, awardsCancelled: cancelledAwards.rowCount };
    });
  }
}
