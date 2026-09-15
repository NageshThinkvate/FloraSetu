import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ReferenceIdService } from '../../../common/pagination/reference-id.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { claimIdempotencyKey, completeIdempotencyKey, hashRequest } from '../../../common/idempotency/idempotency.service';
import { SupplyInventory_SERVICE, SupplyInventoryService } from '../../supply-inventory/contracts';
import { CatalogStandards_SERVICE, CatalogStandardsService } from '../../catalog-standards/contracts';
import { Notifications_SERVICE, NotificationsService } from '../../notifications/contracts';
import { CompleteInspectionDto, CreateInspectionDto } from './dto';

@Injectable()
export class InspectionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    @Inject(SupplyInventory_SERVICE) private readonly supply: SupplyInventoryService,
    @Inject(Notifications_SERVICE) private readonly notifications: NotificationsService,
    @Inject(CatalogStandards_SERVICE) private readonly catalog: CatalogStandardsService
  ) {}

  // QC worklist: lots awaiting inspection (via supply contract — schema ownership).
  async queue(): Promise<{ items: unknown[] }> {
    return { items: await this.supply.listQcQueue() };
  }

  async create(dto: CreateInspectionDto): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    const lot = await this.supply.getLotSnapshot(dto.lotId);
    if (!lot) {
      throw new ApiException(404, 'NOT_FOUND', 'Lot not found');
    }
    if (lot.status !== 'QC_PENDING') {
      throw new ApiException(409, 'CONFLICT', `Lot is ${lot.status}; not awaiting QC`, {
        code_detail: 'ILLEGAL_TRANSITION'
      });
    }
    // §12 conflict control: inspector org must not be the lot-owning supplier org
    // without a recorded ops override.
    const conflict = lot.orgId === orgId;
    const canOverride = ctx.permissions.includes('procurement.manage');
    if (conflict && !(canOverride && dto.conflictOverrideReason)) {
      throw new ApiException(409, 'CONFLICT',
        'Inspector organization has a financial interest in this lot; an ops conflict override is required',
        { code_detail: 'QC_CONFLICT' });
    }
    return this.db.withTransaction(async (client) => {
      const ref = await this.refIds.next(client, 'INS');
      const row = await client.query<{ id: string }>(
        `INSERT INTO quality.qc_inspections
           (ref, lot_id, inspector_user_id, inspected_at, status, org_id, supplier_org_id,
            inspection_scope, uom_id, submitted_qty, conflict_flag, conflict_override_by, notes)
         VALUES ($1,$2,$3,now(),'SUBMITTED',$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [ref, dto.lotId, ctx.userId, orgId, lot.orgId, dto.scope, lot.uomId,
         lot.qcAcceptedQty ?? lot.declaredQty, conflict, conflict ? ctx.userId : null, dto.notes ?? null]
      );
      const inspectionId = row.rows[0].id;
      // §16 custody: supplier possession -> QC handoff.
      await client.query(
        `INSERT INTO quality.custody_events
           (lot_id, from_org_id, to_org_id, event_type, occurred_at, actor_user_id, condition_note)
         VALUES ($1,$2,$3,'QC_HANDOFF',now(),$4,$5)`,
        [dto.lotId, lot.orgId, orgId, ctx.userId, `Inspection ${ref} opened (${dto.scope})`]
      );
      await this.audit.record(client, {
        action: 'qc.open', objectType: 'qc_inspection', objectId: inspectionId, objectRef: ref,
        after: { lotId: dto.lotId, scope: dto.scope, conflict, override: !!dto.conflictOverrideReason }
      });
      return { id: inspectionId, ref, lotId: dto.lotId, status: 'SUBMITTED', conflictFlag: conflict };
    });
  }

  // §10/§11: evidence-based completion against the pinned grade-profile version.
  async complete(inspectionId: string, dto: CompleteInspectionDto, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const inspection = await this.db.query<{
      id: string; lot_id: string; status: string; org_id: string; supplier_org_id: string; submitted_qty: string;
    }>(`SELECT id, lot_id, status, org_id, supplier_org_id, submitted_qty
        FROM quality.qc_inspections WHERE id = $1`, [inspectionId]);
    if (inspection.rowCount === 0 || inspection.rows[0].org_id !== orgId) {
      throw new ApiException(404, 'NOT_FOUND', 'Inspection not found');
    }
    // Grade profiles must exist and be version-pinned — never invent grades (§10).
    const snapshots = [] as { id: string; versionNo: number; rules: unknown }[];
    for (const g of dto.gradeResults) {
      const snap = await this.catalog.getGradeProfileSnapshot(g.gradeProfileId);
      if (!snap) {
        throw new ApiException(400, 'VALIDATION_FAILED', 'Unknown grade profile', { code_detail: 'UNKNOWN_REFERENCE' });
      }
      snapshots.push(snap);
    }
    const hash = hashRequest({ inspectionId, dto });
    const outcome = await this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'qc.complete', idemKey, hash);
      if (claim.state === 'replay') {
        return claim;
      }
      // Idempotent replay must win over the state guard: check SUBMITTED only for fresh claims.
      const locked = await client.query<{ status: string }>(
        `SELECT status FROM quality.qc_inspections WHERE id = $1 FOR UPDATE`, [inspectionId]);
      if (locked.rows[0]?.status !== 'SUBMITTED') {
        throw new ApiException(409, 'CONFLICT', 'Inspection already completed', { code_detail: 'ILLEGAL_TRANSITION' });
      }
      for (const [i, g] of dto.gradeResults.entries()) {
        await client.query(
          `INSERT INTO quality.qc_results
             (inspection_id, grade_standard_id, measurements, passed, grade_profile_id, grade_profile_version_no)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [inspectionId, g.gradeProfileId, JSON.stringify(g.measurements), dto.rejectedQty === 0,
           snapshots[i].id, snapshots[i].versionNo]
        );
      }
      for (const d of dto.defects ?? []) {
        await client.query(
          `INSERT INTO quality.inspection_defects (inspection_id, defect_type_id, qty, severity, note)
           VALUES ($1,$2,$3,$4,$5)`,
          [inspectionId, d.defectTypeId ?? null, d.qty ?? null, d.severity ?? null, d.note ?? null]
        );
      }
      await client.query(
        `UPDATE quality.qc_inspections SET status = 'COMPLETED',
           accepted_qty = $2, rejected_qty = $3, held_qty = $4, notes = COALESCE($5, notes),
           completed_at = now()
         WHERE id = $1 AND status = 'SUBMITTED'`,
        [inspectionId, dto.acceptedQty, dto.rejectedQty, dto.heldQty, dto.notes ?? null]
      );
      await this.audit.record(client, {
        action: 'qc.complete', objectType: 'qc_inspection', objectId: inspectionId,
        after: {
          lotId: inspection.rows[0].lot_id, accepted: dto.acceptedQty, rejected: dto.rejectedQty,
          held: dto.heldQty, gradeVersions: snapshots.map((s) => ({ id: s.id, versionNo: s.versionNo }))
        }
      });
      await this.outbox.emit(client, {
        aggregateType: 'qc_inspection', aggregateId: inspectionId, type: 'qc.completed',
        payload: { inspectionId, lotId: inspection.rows[0].lot_id, accepted: dto.acceptedQty, rejected: dto.rejectedQty, held: dto.heldQty }
      });
      const body = {
        id: inspectionId, status: 'COMPLETED',
        accepted: dto.acceptedQty, rejected: dto.rejectedQty, held: dto.heldQty,
        gradeProfileVersions: snapshots.map((s) => ({ id: s.id, versionNo: s.versionNo }))
      };
      await completeIdempotencyKey(client, orgId, 'qc.complete', idemKey, 201, body);
      return { state: 'fresh' as const, responseBody: body };
    });
    if (outcome.state === 'replay') {
      return { ...outcome.responseBody as object, replayed: true };
    }
    // Lot balances move via the supply contract (§11: rejected never available; hold blocks).
    const lotStatus = await this.supply.applyQcResult(inspection.rows[0].lot_id, {
      accepted: dto.acceptedQty, rejected: dto.rejectedQty, held: dto.heldQty
    }, ctx.userId);
    for (const mediaId of dto.mediaObjectIds ?? []) {
      await this.supply.attachLotMedia(inspection.rows[0].lot_id, mediaId, 'INSPECTION', inspectionId, ctx.userId);
    }
    // B2: notify the lot owner that the quality check completed (best-effort, post-commit).
    const lotOwner = await this.supply.getLotSnapshot(inspection.rows[0].lot_id).catch(() => null);
    if (lotOwner) {
      await this.notifications
        .queue(lotOwner.orgId, null, 'inspection.completed', { lotId: lotOwner.id, inspectionId })
        .catch(() => undefined);
    }
    return { ...(outcome.responseBody as object), lotStatus: lotStatus.status };
  }

  async get(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const inspection = await this.db.query(
      `SELECT * FROM quality.qc_inspections WHERE id = $1`, [id]);
    if (inspection.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Inspection not found');
    }
    const row = inspection.rows[0];
    const ops = ctx.permissions.includes('procurement.manage');
    if (ctx.orgId !== row.org_id && ctx.orgId !== row.supplier_org_id && !ops) {
      throw new ApiException(404, 'NOT_FOUND', 'Inspection not found');
    }
    const [results, defects] = await Promise.all([
      this.db.query(`SELECT * FROM quality.qc_results WHERE inspection_id = $1`, [id]),
      this.db.query(`SELECT * FROM quality.inspection_defects WHERE inspection_id = $1`, [id])
    ]);
    return { ...row, results: results.rows, defects: defects.rows };
  }
}
