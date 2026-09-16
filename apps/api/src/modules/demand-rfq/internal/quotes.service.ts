import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
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
import { isOps } from './demand-policies';
import { QuotationLineDto, ReviseQuotationDto, SubmitQuotationDto } from './dto';

@Injectable()
export class QuotesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    @Inject(CatalogStandards_SERVICE) private readonly catalogService: CatalogStandardsService,
    @Inject(IdentityParty_SERVICE) private readonly identityService: IdentityPartyService,
    @Inject(Notifications_SERVICE) private readonly notificationsService: NotificationsService
  ) {}

  private async guardSupplier(rfqId: string) {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    const rfq = await this.db.query<{
      id: string; org_id: string; status: string; quote_deadline: string | null;
      requirement_id: string; requirement_version_id: string;
    }>(`SELECT id, org_id, status, quote_deadline, requirement_id, requirement_version_id
        FROM demand.rfqs WHERE id = $1`, [rfqId]);
    if (rfq.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
    }
    const inv = await this.db.query<{ status: string }>(
      `SELECT status FROM demand.rfq_invitations WHERE rfq_id = $1 AND supplier_org_id = $2`,
      [rfqId, orgId]
    );
    if (inv.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
    }
    if (inv.rows[0].status === 'DECLINED') {
      throw new ApiException(409, 'CONFLICT', 'Invitation declined');
    }
    const row = rfq.rows[0];
    if (row.status !== 'PUBLISHED') {
      throw new ApiException(409, 'CONFLICT', `RFQ is ${row.status}; quotations closed`, { code_detail: 'RFQ_NOT_OPEN' });
    }
    if (row.quote_deadline && new Date(row.quote_deadline).getTime() <= Date.now()) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Quote deadline has passed', { code_detail: 'DEADLINE_PASSED' });
    }
    return { ctx, orgId, rfq: row };
  }

  // OD-08: original quoted qty/uom/price are immutable once written; normalization
  // metadata is stored alongside, never overwriting supplier originals.
  private async insertLines(client: PoolClient, quotationVersionId: string, rfqId: string, lines: QuotationLineDto[]) {
    for (const line of lines) {
      const reqLine = await client.query<{
        id: string; commodity_id: string; uom_id: string; quantity: string; substitution_policy: Record<string, unknown>;
      }>(
        `SELECT rl.id, rl.commodity_id, rl.uom_id, rl.quantity, rl.substitution_policy
         FROM demand.requirement_lines rl
         JOIN demand.rfq_lines fl ON fl.requirement_line_id = rl.id
         WHERE rl.id = $1 AND fl.rfq_id = $2`,
        [line.requirementLineId, rfqId]
      );
      if (reqLine.rowCount === 0) {
        throw new ApiException(400, 'VALIDATION_FAILED', 'Requirement line not part of this RFQ');
      }
      const req = reqLine.rows[0];
      let normalizedQty: number | null = null;
      let normalizedUomId: string | null = null;
      let conversionVersionId: string | null = null;
      let conversionVersionNo: number | null = null;
      let normalizationStatus = 'NOT_REQUESTED';
      if (line.quotedUomId !== req.uom_id) {
        // OD-07: normalize only via ACTIVE version-controlled conversion; never invent.
        const n = await this.catalogService.normalize(req.commodity_id, line.quotedUomId, req.uom_id, line.quotedQty);
        if (n) {
          normalizedQty = n.normalizedQty;
          normalizedUomId = req.uom_id;
          conversionVersionId = n.conversionVersionId;
          conversionVersionNo = n.conversionVersionNo;
          normalizationStatus = 'NORMALIZED';
        } else {
          normalizationStatus = 'NO_CONVERSION';
        }
      }
      // Outside-policy substitution proposal → recorded as deviation, never auto-accepted.
      if (line.proposesSubstitution && !line.substitutionDetail) {
        throw new ApiException(400, 'VALIDATION_FAILED', 'substitutionDetail required when proposing a substitution');
      }
      await client.query(
        `INSERT INTO demand.quotation_lines
           (quotation_version_id, requirement_line_id, quoted_qty, quoted_uom_id, unit_price_minor, currency,
            components, normalized_qty, normalized_uom_id, conversion_version_id, conversion_version_no,
            normalization_status, deviation_note, proposes_substitution, substitution_detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [quotationVersionId, line.requirementLineId, line.quotedQty, line.quotedUomId, line.unitPriceMinor,
         line.currency ?? 'INR', JSON.stringify(line.components ?? {}), normalizedQty, normalizedUomId,
         conversionVersionId, conversionVersionNo, normalizationStatus,
         line.deviationNote ?? null, line.proposesSubstitution ?? false,
         line.substitutionDetail ? JSON.stringify(line.substitutionDetail) : null]
      );
    }
  }

  private async assertCurrentRequirementVersion(client: PoolClient, rfqId: string) {
    const stale = await client.query(
      `SELECT 1 FROM demand.rfqs r
       JOIN demand.requirements req ON req.id = r.requirement_id
       JOIN demand.requirement_versions rv ON rv.id = r.requirement_version_id
       WHERE r.id = $1 AND rv.version_no <> req.current_version_no`,
      [rfqId]
    );
    if (stale.rowCount && stale.rowCount > 0) {
      throw new ApiException(409, 'CONFLICT', 'Requirement was revised; review the update before quoting', {
        code_detail: 'RECONFIRMATION_REQUIRED'
      });
    }
  }

  async submit(rfqId: string, dto: SubmitQuotationDto, idemKey: string | undefined): Promise<unknown> {
    const { ctx, orgId, rfq } = await this.guardSupplier(rfqId);
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    if (new Date(dto.validTo).getTime() <= Date.now()) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'validTo must be in the future');
    }
    const hash = hashRequest({ rfqId, dto });
    const outcome = await this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'quote.submit', idemKey, hash);
      if (claim.state === 'replay') {
        return claim;
      }
      // Revision race: RFQ must still reference the requirement version the supplier saw.
      await this.assertCurrentRequirementVersion(client, rfqId);
      const existing = await client.query(`SELECT 1 FROM demand.quotations WHERE rfq_id = $1 AND supplier_org_id = $2`,
        [rfqId, orgId]);
      if (existing.rowCount && existing.rowCount > 0) {
        throw new ApiException(409, 'CONFLICT', 'Quotation exists; use the revision workflow');
      }
      const ref = await this.refIds.next(client, 'QTN');
      let quotationId: string;
      try {
        const quotation = await client.query<{ id: string }>(
          `INSERT INTO demand.quotations (ref, rfq_id, supplier_org_id) VALUES ($1,$2,$3) RETURNING id`,
          [ref, rfqId, orgId]
        );
        quotationId = quotation.rows[0].id;
      } catch (e) {
        // Concurrent submit race: unique (rfq_id, supplier_org_id) decides the loser.
        if ((e as { code?: string }).code === '23505') {
          throw new ApiException(409, 'CONFLICT', 'Quotation exists; use the revision workflow');
        }
        throw e;
      }
      const version = await client.query<{ id: string }>(
        `INSERT INTO demand.quotation_versions
           (quotation_id, version_no, valid_to, lead_time_days, delivery_commitment, moq,
            partial_fulfilment_offered, commercial_terms, supplier_notes, status, submitted_by)
         VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,'SUBMITTED',$9) RETURNING id`,
        [quotationId, dto.validTo, dto.leadTimeDays ?? null, dto.deliveryCommitment ?? null,
         dto.moq ?? null, dto.partialFulfilmentOffered ?? false, dto.commercialTerms ?? null,
         dto.supplierNotes ?? null, ctx.userId]
      );
      const versionId = version.rows[0].id;
      await this.insertLines(client, versionId, rfqId, dto.lines);
      await client.query(
        `UPDATE demand.rfq_invitations SET status = 'QUOTED', updated_at = now()
         WHERE rfq_id = $1 AND supplier_org_id = $2`,
        [rfqId, orgId]
      );
      await client.query(
        `UPDATE demand.requirements SET status = 'QUOTING', version = version + 1, updated_at = now()
         WHERE id = $1 AND status = 'SOURCING'`,
        [rfq.requirement_id]
      );
      await this.audit.record(client, {
        action: 'quote.submit', objectType: 'quotation', objectId: quotationId, objectRef: ref,
        after: { rfqId, versionNo: 1, lines: dto.lines.length }
      });
      await this.outbox.emit(client, {
        aggregateType: 'quotation', aggregateId: quotationId, type: 'quote.submitted',
        payload: { quotationId, rfqId, supplierOrgId: orgId }
      });
      const body = { id: quotationId, ref, versionNo: 1, versionId };
      await completeIdempotencyKey(client, orgId, 'quote.submit', idemKey, 201, body);
      return { state: 'fresh' as const, responseBody: body };
    });
    if (outcome.state === 'replay') {
      return { ...outcome.responseBody as object, replayed: true };
    }
    const quotationId = (outcome.responseBody as { id: string }).id;
    await this.notificationsService.queue(rfq.org_id, null, 'quote.received', { rfqId, quotationId });
    return outcome.responseBody;
  }

  async revise(quotationId: string, dto: ReviseQuotationDto, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    if (new Date(dto.validTo).getTime() <= Date.now()) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'validTo must be in the future');
    }
    const quotation = await this.db.query<{
      id: string; rfq_id: string; current_version_no: number; status: string;
    }>(`SELECT id, rfq_id, current_version_no, status FROM demand.quotations WHERE id = $1 AND supplier_org_id = $2`,
      [quotationId, orgId]);
    if (quotation.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Quotation not found');
    }
    const { rfq } = await this.guardSupplier(quotation.rows[0].rfq_id);
    if (quotation.rows[0].status !== 'ACTIVE') {
      throw new ApiException(409, 'CONFLICT', `Quotation is ${quotation.rows[0].status}`);
    }
    const currentVersionNo = quotation.rows[0].current_version_no;
    const newVersionNo = currentVersionNo + 1;
    const hash = hashRequest({ quotationId, dto });
    const outcome = await this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'quote.revise', idemKey, hash);
      if (claim.state === 'replay') {
        return claim;
      }
      await this.assertCurrentRequirementVersion(client, rfq.id);
      await client.query(
        `UPDATE demand.quotation_versions SET status = 'SUPERSEDED'
         WHERE quotation_id = $1 AND version_no = $2 AND status IN ('SUBMITTED','RECONFIRMATION_REQUIRED')`,
        [quotationId, currentVersionNo]
      );
      const version = await client.query<{ id: string }>(
        `INSERT INTO demand.quotation_versions
           (quotation_id, version_no, valid_to, lead_time_days, delivery_commitment, moq,
            partial_fulfilment_offered, commercial_terms, supplier_notes, status, submitted_by, revision_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'SUBMITTED',$10,$11) RETURNING id`,
        [quotationId, newVersionNo, dto.validTo, dto.leadTimeDays ?? null, dto.deliveryCommitment ?? null,
         dto.moq ?? null, dto.partialFulfilmentOffered ?? false, dto.commercialTerms ?? null,
         dto.supplierNotes ?? null, ctx.userId, dto.revisionReason]
      );
      const versionId = version.rows[0].id;
      await this.insertLines(client, versionId, rfq.id, dto.lines);
      await client.query(
        `UPDATE demand.quotations SET current_version_no = $2, updated_at = now() WHERE id = $1`,
        [quotationId, newVersionNo]
      );
      await this.audit.record(client, {
        action: 'quote.revise', objectType: 'quotation', objectId: quotationId,
        before: { versionNo: currentVersionNo },
        after: { versionNo: newVersionNo, reason: dto.revisionReason }
      });
      await this.outbox.emit(client, {
        aggregateType: 'quotation', aggregateId: quotationId, type: 'quote.revised',
        payload: { quotationId, rfqId: rfq.id, versionNo: newVersionNo }
      });
      const body = { id: quotationId, versionNo: newVersionNo, versionId };
      await completeIdempotencyKey(client, orgId, 'quote.revise', idemKey, 201, body);
      return { state: 'fresh' as const, responseBody: body };
    });
    if (outcome.state === 'replay') {
      return { ...outcome.responseBody as object, replayed: true };
    }
    await this.notificationsService.queue(rfq.org_id, null, 'quote.revised', { quotationId, versionNo: newVersionNo });
    return outcome.responseBody;
  }

  async listMine(): Promise<{ items: unknown[] }> {
    const orgId = RequestContext.requireOrgId();
    const result = await this.db.query(
      `SELECT q.id, q.ref, q.status, q.current_version_no, q.created_at,
              r.ref AS rfq_ref, r.title AS rfq_title, r.status AS rfq_status,
              v.valid_to, v.status AS version_status
       FROM demand.quotations q
       JOIN demand.rfqs r ON r.id = q.rfq_id
       JOIN demand.quotation_versions v ON v.quotation_id = q.id AND v.version_no = q.current_version_no
       WHERE q.supplier_org_id = $1 ORDER BY q.created_at DESC`,
      [orgId]
    );
    return { items: result.rows };
  }

  async get(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const quotation = await this.db.query(
      `SELECT q.*, r.org_id AS buyer_org_id, r.ref AS rfq_ref FROM demand.quotations q
       JOIN demand.rfqs r ON r.id = q.rfq_id WHERE q.id = $1`,
      [id]
    );
    if (quotation.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Quotation not found');
    }
    const row = quotation.rows[0];
    // Only the owning supplier, the buyer, or ops may read a quote.
    if (ctx.orgId !== row.supplier_org_id && ctx.orgId !== row.buyer_org_id && !isOps(ctx)) {
      throw new ApiException(404, 'NOT_FOUND', 'Quotation not found');
    }
    const versions = await this.db.query(
      `SELECT id, version_no, status, valid_from, valid_to, submitted_by, submitted_at, revision_reason,
              lead_time_days, delivery_commitment, moq, partial_fulfilment_offered, commercial_terms, supplier_notes
       FROM demand.quotation_versions WHERE quotation_id = $1 ORDER BY version_no DESC`,
      [id]
    );
    const currentVersionId = versions.rows.find((v) => v.version_no === row.current_version_no)?.id;
    const lines = currentVersionId
      ? await this.db.query(`SELECT * FROM demand.quotation_lines WHERE quotation_version_id = $1`, [currentVersionId])
      : { rows: [] };
    return { ...row, versions: versions.rows, currentLines: lines.rows };
  }

  // Buyer-side comparison: all current quote versions for an RFQ, with normalization metadata.
  async comparison(rfqId: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const rfq = await this.db.query<{ org_id: string; requirement_id: string }>(
      `SELECT org_id, requirement_id FROM demand.rfqs WHERE id = $1`, [rfqId]);
    if (rfq.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
    }
    if (ctx.orgId !== rfq.rows[0].org_id && !isOps(ctx)) {
      throw new ApiException(404, 'NOT_FOUND', 'RFQ not found');
    }
    const reqLines = await this.db.query(
      `SELECT rl.id, rl.quantity, rl.uom_id, rl.substitution_policy, rl.master_snapshot
       FROM demand.requirement_lines rl
       JOIN demand.requirement_versions rv ON rv.id = rl.requirement_version_id
       JOIN demand.requirements r ON r.id = rl.requirement_id
       WHERE rl.requirement_id = $1 AND rv.version_no = r.current_version_no`,
      [rfq.rows[0].requirement_id]
    );
    const quotes = await this.db.query(
      `SELECT q.id AS quotation_id, q.ref, q.supplier_org_id, v.id AS version_id, v.version_no,
              v.status AS version_status, v.valid_to, v.lead_time_days, v.delivery_commitment,
              v.moq, v.partial_fulfilment_offered, v.commercial_terms, v.submitted_at
       FROM demand.quotations q
       JOIN demand.quotation_versions v ON v.quotation_id = q.id AND v.version_no = q.current_version_no
       WHERE q.rfq_id = $1 AND q.status = 'ACTIVE'`,
      [rfqId]
    );
    const versionIds = quotes.rows.map((q) => q.version_id);
    const lines: Record<string, unknown>[] = versionIds.length
      ? (await this.db.query(
          `SELECT * FROM demand.quotation_lines WHERE quotation_version_id = ANY($1)`, [versionIds])).rows
      : [];
    // B3 (Phase 3): supplier display name + verification status on every offer.
    const profiles = await this.identityService.getOrgPublicProfiles(
      quotes.rows.map((q) => q.supplier_org_id as string));
    const profileById = new Map(profiles.map((p) => [p.orgId, p]));
    return {
      requirementLines: reqLines.rows,
      offers: quotes.rows.map((q) => ({
        ...q,
        supplier_org_name: profileById.get(q.supplier_org_id as string)?.name ?? null,
        supplier_kyb_status: profileById.get(q.supplier_org_id as string)?.kybStatus ?? null,
        lines: lines.filter((l) => l.quotation_version_id === q.version_id),
        landedCostComplete: lines
          .filter((l) => l.quotation_version_id === q.version_id)
          .every((l) => {
            const components = (l.components ?? {}) as Record<string, { state?: string }>;
            return Object.values(components).every((c) => c.state === 'KNOWN' || c.state === 'SUPPLIER_ARRANGED');
          }),
        landedCostLabel: 'INDICATIVE — verify components before award'
      }))
    };
  }
}
