import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { RequestContext } from '../../../common/request-context';
import { ApiException } from '../../../common/errors/error-envelope';
import { SupplyInventory_SERVICE, SupplyInventoryService } from '../../supply-inventory/contracts';
import { CustodyInput, QualityTraceabilityService } from '../contracts';
import { CustodyEventDto } from './dto';

@Injectable()
export class CustodyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(SupplyInventory_SERVICE) private readonly supply: SupplyInventoryService
  ) {}

  // §16: append-only custody events (DB rules block UPDATE/DELETE).
  // to_org_id is NOT NULL in the frozen schema: possession stays with the actor's
  // org when no distinct recipient is recorded (from_org fallback).
  async record(input: CustodyInput, tx?: PoolClient): Promise<{ id: string }> {
    const run = async (client: PoolClient): Promise<{ id: string }> => {
      const row = await client.query<{ id: string }>(
        `INSERT INTO quality.custody_events
           (lot_id, order_id, shipment_id, from_org_id, to_org_id, event_type, occurred_at,
            actor_user_id, location_text, condition_note, temperature_c, media_object_id)
         VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10,$11) RETURNING id`,
        [input.lotId, input.orderId ?? null, input.shipmentId ?? null, input.fromOrgId,
         input.toOrgId ?? input.fromOrgId,
         input.eventType, input.actorUserId ?? null, input.locationText ?? null, input.conditionNote ?? null,
         input.temperatureC ?? null, input.mediaObjectId ?? null]
      );
      await this.outbox.emit(client, {
        aggregateType: 'custody_event', aggregateId: row.rows[0].id, type: 'custody.recorded',
        payload: { lotId: input.lotId, eventType: input.eventType }
      });
      return { id: row.rows[0].id };
    };
    return tx ? run(tx) : this.db.withTransaction(run);
  }

  async recordHttp(dto: CustodyEventDto): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    const result = await this.record({
      lotId: dto.lotId, orderId: dto.orderId ?? null, shipmentId: dto.shipmentId ?? null,
      fromOrgId: orgId, toOrgId: dto.toOrgId ?? null, eventType: dto.eventType,
      actorUserId: ctx.userId, locationText: dto.locationText, conditionNote: dto.conditionNote,
      temperatureC: dto.temperatureC, mediaObjectId: dto.mediaObjectId
    });
    return result;
  }

  async listForLot(lotId: string): Promise<{ items: unknown[] }> {
    // Tenant isolation (§4): lot owner or platform operations only.
    const ctx = RequestContext.get();
    // Lot ownership via the supply-inventory contract (docs/04: no cross-schema SQL).
    const lot = await this.supply.getLotSnapshot(lotId);
    if (!lot || (lot.orgId !== ctx.orgId && !ctx.permissions.includes('procurement.manage'))) {
      throw new ApiException(404, 'NOT_FOUND', 'Lot not found');
    }
    const rows = await this.db.query(
      `SELECT * FROM quality.custody_events WHERE lot_id = $1 ORDER BY occurred_at`, [lotId]);
    return { items: rows.rows };
  }
}

@Injectable()
export class QualityTraceabilityServiceImpl implements QualityTraceabilityService {
  constructor(
    private readonly db: DatabaseService,
    private readonly custody: CustodyService
  ) {}

  contextKey(): 'quality-traceability' {
    return 'quality-traceability';
  }

  async getInspectionSnapshot(inspectionId: string) {
    const r = await this.db.query(
      `SELECT i.id, i.lot_id, i.status, i.supplier_org_id, i.org_id, i.accepted_qty, i.rejected_qty, i.held_qty,
              (SELECT qr.grade_profile_version_no FROM quality.qc_results qr
                WHERE qr.inspection_id = i.id ORDER BY qr.created_at LIMIT 1) AS grade_profile_version_no
       FROM quality.qc_inspections i WHERE i.id = $1`, [inspectionId]);
    if (r.rowCount === 0) {
      return null;
    }
    const i = r.rows[0];
    return {
      id: i.id, lotId: i.lot_id, status: i.status,
      supplierOrgId: i.supplier_org_id, inspectorOrgId: i.org_id,
      acceptedQty: i.accepted_qty === null ? null : Number(i.accepted_qty),
      rejectedQty: i.rejected_qty === null ? null : Number(i.rejected_qty),
      heldQty: i.held_qty === null ? null : Number(i.held_qty),
      gradeProfileVersionNo: i.grade_profile_version_no ?? null
    };
  }

  async recordCustody(input: CustodyInput, tx?: PoolClient): Promise<void> {
    await this.custody.record(input, tx);
  }

  async pilotExceptions(): Promise<Record<string, unknown[]>> {
    const open = await this.db.query(
      `SELECT id, lot_id, created_at FROM quality.qc_inspections WHERE status = 'SUBMITTED' LIMIT 50`);
    return { openInspections: open.rows };
  }
}
