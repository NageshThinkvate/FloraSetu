import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ReferenceIdService } from '../../../common/pagination/reference-id.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { claimIdempotencyKey, completeIdempotencyKey, hashRequest } from '../../../common/idempotency/idempotency.service';
import { OrderAllocation_SERVICE, OrderAllocationService } from '../../order-allocation/contracts';
import { SupplyInventory_SERVICE, SupplyInventoryService } from '../../supply-inventory/contracts';
import { QualityTraceability_SERVICE, QualityTraceabilityService } from '../../quality-traceability/contracts';
import { LogisticsColdchain_SERVICE, LogisticsColdchainService } from '../../logistics-coldchain/contracts';
import { PaymentsSettlement_SERVICE, PaymentsSettlementService } from '../../payments-settlement/contracts';
import { AddEvidenceDto, ClaimTransitionDto, CreateClaimDto, RespondClaimDto } from './dto';

// Master claim lifecycle (§20): ops-assisted intermediate stages are allowed for pilot.
const CLAIM_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['EVIDENCE_VALIDATION'],
  EVIDENCE_VALIDATION: ['COUNTERPARTY_RESPONSE', 'UNDER_REVIEW'],
  COUNTERPARTY_RESPONSE: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['PROPOSED_RESOLUTION', 'REJECTED'],
  PROPOSED_RESOLUTION: ['APPROVED', 'REJECTED'],
  APPROVED: ['FINANCIAL_ADJUSTMENT', 'REPLACEMENT', 'CLOSED'],
  FINANCIAL_ADJUSTMENT: ['CLOSED'],
  REPLACEMENT: ['CLOSED'],
  CLOSED: [],
  REJECTED: []
};

// Map pilot categories onto the frozen claim_type enum.
const CLAIM_TYPE: Record<string, string> = {
  QUALITY_MISMATCH: 'QUALITY', GRADE_MISMATCH: 'QUALITY', DAMAGED: 'QUALITY',
  WRONG_PRODUCT: 'QUALITY', TEMPERATURE_EXCEPTION: 'COLD_CHAIN',
  SHORT_QUANTITY: 'SHORTAGE', LATE_DELIVERY: 'OTHER', OTHER: 'OTHER'
};

@Injectable()
export class ClaimsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    @Inject(OrderAllocation_SERVICE) private readonly orders: OrderAllocationService,
    @Inject(SupplyInventory_SERVICE) private readonly supply: SupplyInventoryService,
    @Inject(QualityTraceability_SERVICE) private readonly quality: QualityTraceabilityService,
    @Inject(LogisticsColdchain_SERVICE) private readonly logistics: LogisticsColdchainService,
    @Inject(PaymentsSettlement_SERVICE) private readonly payments: PaymentsSettlementService
  ) {}

  async create(dto: CreateClaimDto, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const snapshot = await this.orders.getOrderSnapshot(dto.orderId);
    if (!snapshot || snapshot.buyerOrgId !== orgId) {
      throw new ApiException(404, 'NOT_FOUND', 'Order not found');
    }
    if (!['DELIVERED', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'CLAIM_OPEN'].includes(snapshot.status)) {
      throw new ApiException(409, 'CONFLICT', `Order is ${snapshot.status}; claims open after delivery`,
        { code_detail: 'ILLEGAL_TRANSITION' });
    }
    // Evidence links validated through owning contexts (no cross-schema reads).
    if (dto.lotId && !(await this.supply.getLotSnapshot(dto.lotId))) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Unknown lot', { code_detail: 'UNKNOWN_REFERENCE' });
    }
    if (dto.inspectionId && !(await this.quality.getInspectionSnapshot(dto.inspectionId))) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Unknown inspection', { code_detail: 'UNKNOWN_REFERENCE' });
    }
    if (dto.podId) {
      const pods = await this.logistics.getPodForOrder(dto.orderId);
      if (!pods.some((p) => p.id === dto.podId)) {
        throw new ApiException(400, 'VALIDATION_FAILED', 'POD does not belong to this order', { code_detail: 'UNKNOWN_REFERENCE' });
      }
    }
    const hash = hashRequest({ dto });
    return this.db.withTransaction(async (client) => {
      const claimKey = await claimIdempotencyKey(client, orgId, 'claim.create', idemKey, hash);
      if (claimKey.state === 'replay') {
        return claimKey.responseBody;
      }
      const ref = await this.refIds.next(client, 'CLM');
      const row = await client.query<{ id: string }>(
        `INSERT INTO claims.claims
           (ref, org_id, order_id, claim_type, status, category, buyer_org_id, supplier_org_id,
            lot_id, inspection_id, pod_id, disputed_qty, uom_id, submitted_by)
         VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [ref, orgId, dto.orderId, CLAIM_TYPE[dto.category], dto.category, orgId,
         snapshot.supplierOrgIds[0] ?? null, dto.lotId ?? null, dto.inspectionId ?? null,
         dto.podId ?? null, dto.disputedQty ?? null, dto.uomId ?? null, ctx.userId]
      );
      const claimId = row.rows[0].id;
      for (const mediaId of dto.mediaObjectIds ?? []) {
        await client.query(
          `INSERT INTO claims.claim_evidences (claim_id, media_object_id, note, lot_id, inspection_id, pod_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [claimId, mediaId, dto.description.slice(0, 300), dto.lotId ?? null, dto.inspectionId ?? null, dto.podId ?? null]
        );
      }
      await this.audit.record(client, {
        action: 'claim.create', objectType: 'claim', objectId: claimId, objectRef: ref,
        after: { orderId: dto.orderId, category: dto.category, disputedQty: dto.disputedQty ?? null }
      });
      const body = { id: claimId, ref, status: 'DRAFT' };
      await completeIdempotencyKey(client, orgId, 'claim.create', idemKey, 201, body);
      return body;
    });
  }

  async submit(id: string, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const hash = hashRequest({ id });
    const outcome = await this.db.withTransaction(async (client) => {
      const claimKey = await claimIdempotencyKey(client, orgId, 'claim.submit', idemKey, hash);
      if (claimKey.state === 'replay') {
        return claimKey;
      }
      const locked = await client.query<{ status: string; org_id: string; order_id: string }>(
        `SELECT status, org_id, order_id FROM claims.claims WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      const claim = locked.rows[0];
      if (!claim || claim.org_id !== orgId) {
        throw new ApiException(404, 'NOT_FOUND', 'Claim not found');
      }
      if (claim.status !== 'DRAFT') {
        throw new ApiException(409, 'CONFLICT', `Claim is ${claim.status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      await client.query(
        `UPDATE claims.claims SET status = 'SUBMITTED', version = version + 1, updated_at = now() WHERE id = $1`, [id]);
      await this.audit.record(client, {
        action: 'claim.submit', objectType: 'claim', objectId: id, after: { orderId: claim.order_id }
      });
      await this.outbox.emit(client, {
        aggregateType: 'claim', aggregateId: id, type: 'claim.submitted',
        payload: { claimId: id, orderId: claim.order_id }
      });
      const body = { id, status: 'SUBMITTED', orderId: claim.order_id };
      await completeIdempotencyKey(client, orgId, 'claim.submit', idemKey, 200, body);
      return { state: 'fresh' as const, responseBody: body };
    });
    if (outcome.state === 'replay') {
      return { ...outcome.responseBody as object, replayed: true };
    }
    const { orderId } = outcome.responseBody as { orderId: string };
    await this.orders.markClaimOpened(orderId, ctx.userId).catch(() => undefined);
    return outcome.responseBody;
  }

  async respond(id: string, dto: RespondClaimDto): Promise<unknown> {
    const orgId = RequestContext.requireOrgId();
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ status: string; supplier_org_id: string }>(
        `SELECT status, supplier_org_id FROM claims.claims WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      const claim = locked.rows[0];
      if (!claim || claim.supplier_org_id !== orgId) {
        throw new ApiException(404, 'NOT_FOUND', 'Claim not found');
      }
      if (!['SUBMITTED', 'EVIDENCE_VALIDATION'].includes(claim.status)) {
        throw new ApiException(409, 'CONFLICT', `Claim is ${claim.status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      await client.query(
        `UPDATE claims.claims SET status = 'COUNTERPARTY_RESPONSE', counterparty_response = $2,
           response_at = now(), version = version + 1, updated_at = now() WHERE id = $1`,
        [id, dto.response]);
      await this.audit.record(client, {
        action: 'claim.respond', objectType: 'claim', objectId: id, after: { by: orgId }
      });
      return { id, status: 'COUNTERPARTY_RESPONSE' };
    });
  }

  async transition(id: string, dto: ClaimTransitionDto): Promise<unknown> {
    const ctx = RequestContext.get();
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ status: string; order_id: string; supplier_org_id: string }>(
        `SELECT status, order_id, supplier_org_id FROM claims.claims WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id]);
      const claim = locked.rows[0];
      if (!claim) {
        throw new ApiException(404, 'NOT_FOUND', 'Claim not found');
      }
      if (!(CLAIM_TRANSITIONS[claim.status] ?? []).includes(dto.to)) {
        throw new ApiException(409, 'CONFLICT', `Claim cannot transition ${claim.status} -> ${dto.to}`, {
          code_detail: 'ILLEGAL_TRANSITION'
        });
      }
      await client.query(
        `UPDATE claims.claims SET status = $2, resolution_note = COALESCE($3, resolution_note),
           version = version + 1, updated_at = now() WHERE id = $1`,
        [id, dto.to, dto.resolutionNote ?? null]);
      // claim_decisions is the immutable terminal-decision ledger (CHECK on outcome,
      // UNIQUE per claim) — intermediate workflow steps only update status + audit.
      if (['APPROVED', 'REJECTED'].includes(dto.to)) {
        await client.query(
          `INSERT INTO claims.claim_decisions (claim_id, outcome, adjustment_minor, decided_by)
           VALUES ($1,$2,$3,$4)`,
          [id, dto.to, dto.adjustmentMinor ?? null, ctx.userId ?? null]
        );
      }
      await this.audit.record(client, {
        action: 'claim.transition', objectType: 'claim', objectId: id,
        before: { status: claim.status },
        after: { status: dto.to, adjustmentMinor: dto.adjustmentMinor ?? null }
      });
      await this.outbox.emit(client, {
        aggregateType: 'claim', aggregateId: id, type: 'claim.resolved',
        payload: { claimId: id, outcome: dto.to }
      });
      return { id, status: dto.to };
    }).then(async (result) => {
      // ADR-003: approved financial adjustment becomes an adjustment record (never an edit).
      if (dto.to === 'FINANCIAL_ADJUSTMENT' && dto.adjustmentMinor) {
        const claim = await this.db.query<{ order_id: string; supplier_org_id: string }>(
          `SELECT order_id, supplier_org_id FROM claims.claims WHERE id = $1`, [id]);
        await this.payments.createClaimAdjustment({
          orderId: claim.rows[0].order_id, supplierOrgId: claim.rows[0].supplier_org_id,
          claimId: id, amountMinor: dto.adjustmentMinor,
          reason: dto.resolutionNote ?? 'claim adjustment', recordedBy: ctx.userId
        }).catch(() => undefined); // NO_SETTLEMENT: applied at settlement recording instead
      }
      return result;
    });
  }

  async addEvidence(id: string, dto: AddEvidenceDto): Promise<unknown> {
    const ctx = RequestContext.get();
    const claim = await this.db.query<{ org_id: string; supplier_org_id: string; status: string }>(
      `SELECT org_id, supplier_org_id, status FROM claims.claims WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (claim.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Claim not found');
    }
    const c = claim.rows[0];
    const ops = ctx.permissions.includes('claim.manage');
    if (ctx.orgId !== c.org_id && ctx.orgId !== c.supplier_org_id && !ops) {
      throw new ApiException(404, 'NOT_FOUND', 'Claim not found');
    }
    if (['CLOSED', 'REJECTED'].includes(c.status)) {
      throw new ApiException(409, 'CONFLICT', `Claim is ${c.status}`);
    }
    const row = await this.db.query<{ id: string }>(
      `INSERT INTO claims.claim_evidences (claim_id, media_object_id, note, lot_id, inspection_id, pod_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [id, dto.mediaObjectId, dto.note ?? null, dto.lotId ?? null, dto.inspectionId ?? null, dto.podId ?? null]
    );
    return { id: row.rows[0].id };
  }

  // ADR-013: claim.read grants staff read-only visibility; decisions stay claim.manage.
  async get(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const claim = await this.db.query(
      `SELECT * FROM claims.claims WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (claim.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Claim not found');
    }
    const c = claim.rows[0];
    const ops = ctx.permissions.includes('claim.manage') || ctx.permissions.includes('claim.read');
    if (!ops && !ctx.permissions.includes('claim.create')) {
      throw new ApiException(403, 'FORBIDDEN', 'Missing required permission', { missing: ['claim.create'] });
    }
    if (ctx.orgId !== c.org_id && ctx.orgId !== c.supplier_org_id && !ops) {
      throw new ApiException(404, 'NOT_FOUND', 'Claim not found');
    }
    const [evidences, decisions] = await Promise.all([
      this.db.query(`SELECT * FROM claims.claim_evidences WHERE claim_id = $1 ORDER BY created_at`, [id]),
      this.db.query(`SELECT * FROM claims.claim_decisions WHERE claim_id = $1 ORDER BY decided_at`, [id])
    ]);
    return { ...c, evidences: evidences.rows, decisions: decisions.rows };
  }

  async listMine(): Promise<{ items: unknown[] }> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    // ADR-013: claim.read grants staff read-only visibility across organizations.
    const ops = ctx.permissions.includes('claim.manage') || ctx.permissions.includes('claim.read');
    if (!ops && !ctx.permissions.includes('claim.create')) {
      throw new ApiException(403, 'FORBIDDEN', 'Missing required permission', { missing: ['claim.create'] });
    }
    const rows = await this.db.query(
      `SELECT id, ref, order_id, category, claim_type, status, disputed_qty, created_at, response_at
       FROM claims.claims
       WHERE deleted_at IS NULL AND ($2::boolean OR org_id = $1 OR supplier_org_id = $1)
       ORDER BY created_at DESC`,
      [orgId, ops]
    );
    return { items: rows.rows };
  }
}
