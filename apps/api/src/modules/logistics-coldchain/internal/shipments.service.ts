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
import { Notifications_SERVICE, NotificationsService } from '../../notifications/contracts';
import { IdentityParty_SERVICE, IdentityPartyService } from '../../identity-party/contracts';
import { AssignJobDto, ConfirmPickupDto, CreateShipmentDto, PodDto, ReportLogisticsExceptionDto, ResolveExceptionDto, TemperatureExceptionDto } from './dto';

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    @Inject(OrderAllocation_SERVICE) private readonly orders: OrderAllocationService,
    @Inject(SupplyInventory_SERVICE) private readonly supply: SupplyInventoryService,
    @Inject(QualityTraceability_SERVICE) private readonly quality: QualityTraceabilityService,
    @Inject(Notifications_SERVICE) private readonly notifications: NotificationsService,
    @Inject(IdentityParty_SERVICE) private readonly identity: IdentityPartyService
  ) {}

  private isOps(ctx: { permissions: string[] }): boolean {
    return ctx.permissions.includes('procurement.manage');
  }

  // §17: basic manual transport record. temp_controlled is explicit — never inferred.
  async create(dto: CreateShipmentDto, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const snapshot = await this.orders.getOrderSnapshot(dto.orderId);
    if (!snapshot) {
      throw new ApiException(404, 'NOT_FOUND', 'Order not found');
    }
    if (ctx.orgId !== snapshot.buyerOrgId && !snapshot.supplierOrgIds.includes(orgId) && !this.isOps(ctx)) {
      throw new ApiException(404, 'NOT_FOUND', 'Order not found');
    }
    if (snapshot.status !== 'READY_FOR_DISPATCH') {
      throw new ApiException(409, 'CONFLICT', `Order is ${snapshot.status}; dispatch requires READY_FOR_DISPATCH`, {
        code_detail: 'ILLEGAL_TRANSITION'
      });
    }
    const hash = hashRequest({ dto });
    return this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'shipment.create', idemKey, hash);
      if (claim.state === 'replay') {
        return claim.responseBody;
      }
      const ref = await this.refIds.next(client, 'SHP');
      const shipment = await client.query<{ id: string }>(
        `INSERT INTO logistics.shipments
           (ref, org_id, order_id, status, supplier_org_id, mode, temp_controlled, carrier_name,
            origin_text, destination_text, origin_terminal, destination_terminal, transport_ref,
            parcel_awb_ref, package_count, pickup_at, etd, eta, last_mile_detail)
         VALUES ($1,$2,$3,'PLANNED',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [ref, orgId, dto.orderId, snapshot.supplierOrgIds.includes(orgId) ? orgId : null,
         dto.mode, dto.tempControlled, dto.carrierName ?? null, dto.originText ?? null,
         dto.destinationText ?? snapshot.deliveryDestination, dto.originTerminal ?? null,
         dto.destinationTerminal ?? null, dto.transportRef ?? null, dto.parcelAwbRef ?? null,
         dto.packageCount ?? null, dto.pickupAt ?? null, dto.etd ?? null, dto.eta ?? null,
         dto.lastMileDetail ?? null]
      );
      await this.audit.record(client, {
        action: 'shipment.create', objectType: 'shipment', objectId: shipment.rows[0].id, objectRef: ref,
        after: { orderId: dto.orderId, mode: dto.mode, tempControlled: dto.tempControlled }
      });
      const body = { id: shipment.rows[0].id, ref, status: 'PLANNED' };
      await completeIdempotencyKey(client, orgId, 'shipment.create', idemKey, 201, body);
      return body;
    });
  }

  async dispatch(id: string, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const hash = hashRequest({ id });
    const outcome = await this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'shipment.dispatch', idemKey, hash);
      if (claim.state === 'replay') {
        return claim;
      }
      const locked = await client.query<{ id: string; order_id: string; org_id: string; status: string }>(
        `SELECT id, order_id, org_id, status FROM logistics.shipments WHERE id = $1 FOR UPDATE`, [id]);
      const shipment = locked.rows[0];
      if (!shipment || (shipment.org_id !== orgId && !this.isOps(ctx))) {
        throw new ApiException(404, 'NOT_FOUND', 'Shipment not found');
      }
      if (shipment.status === 'IN_TRANSIT') {
        // Partial-failure recovery: an earlier dispatch committed but crashed before the
        // order transition — complete it here instead of erroring the retry (§30/§31).
        const snapshot = await this.orders.getOrderSnapshot(shipment.order_id);
        if (snapshot?.status === 'READY_FOR_DISPATCH') {
          await this.orders.markDispatched(shipment.order_id, ctx.userId, client);
        }
        const recovered = { id, status: 'IN_TRANSIT', orderId: shipment.order_id, existing: true };
        await completeIdempotencyKey(client, orgId, 'shipment.dispatch', idemKey, 200, recovered);
        return { state: 'fresh' as const, responseBody: recovered };
      }
      if (shipment.status !== 'PLANNED') {
        throw new ApiException(409, 'CONFLICT', `Shipment is ${shipment.status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      await client.query(
        `UPDATE logistics.shipments SET status = 'IN_TRANSIT', dispatched_at = now(), dispatched_by = $2,
           version = version + 1, updated_at = now() WHERE id = $1`,
        [id, ctx.userId]
      );
      // Cross-context side effects join this transaction (atomic dispatch chain).
      const lots = await client.query(
        `SELECT lot_id, SUM(packed_qty) AS qty FROM logistics.pack_records WHERE order_id = $1 GROUP BY lot_id`,
        [shipment.order_id]);
      for (const lot of lots.rows) {
        await this.supply.applyDispatch(lot.lot_id, Number(lot.qty), ctx.userId, client);
      }
      const lines = await client.query(
        `SELECT DISTINCT supplier_allocation_line_id FROM logistics.pack_records WHERE order_id = $1`,
        [shipment.order_id]);
      for (const l of lines.rows) {
        await this.orders.applyLineFulfilment(l.supplier_allocation_line_id, 'DISPATCHED', ctx.userId, client);
      }
      await this.quality.recordCustody({
        lotId: lots.rows[0]?.lot_id ?? null, orderId: shipment.order_id, shipmentId: id,
        fromOrgId: orgId, toOrgId: null, eventType: 'CARRIER_HANDOFF', actorUserId: ctx.userId
      }, client);
      await this.orders.markDispatched(shipment.order_id, ctx.userId, client);
      await this.audit.record(client, {
        action: 'shipment.dispatch', objectType: 'shipment', objectId: id,
        after: { orderId: shipment.order_id }
      });
      await this.outbox.emit(client, {
        aggregateType: 'shipment', aggregateId: id, type: 'shipment.dispatched',
        payload: { shipmentId: id, orderId: shipment.order_id }
      });
      const body = { id, status: 'IN_TRANSIT', orderId: shipment.order_id };
      await completeIdempotencyKey(client, orgId, 'shipment.dispatch', idemKey, 200, body);
      return { state: 'fresh' as const, responseBody: body };
    });
    if (outcome.state === 'replay') {
      return { ...outcome.responseBody as object, replayed: true };
    }
    return outcome.responseBody;
  }

  // §18: POD. One POD per shipment (unique index) — duplicate submissions replay safely.
  async pod(id: string, dto: PodDto, idemKey: string | undefined): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!idemKey) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const hash = hashRequest({ id, dto });
    const outcome = await this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'shipment.pod', idemKey, hash);
      if (claim.state === 'replay') {
        return claim;
      }
      const locked = await client.query<{ id: string; order_id: string; org_id: string; status: string }>(
        `SELECT id, order_id, org_id, status FROM logistics.shipments WHERE id = $1 FOR UPDATE`, [id]);
      const shipment = locked.rows[0];
      if (!shipment || (shipment.org_id !== orgId && !this.isOps(ctx))) {
        throw new ApiException(404, 'NOT_FOUND', 'Shipment not found');
      }
      if (shipment.status !== 'IN_TRANSIT') {
        // Duplicate POD after completion replays the stored record instead of duplicating state.
        const existing = await client.query(
          `SELECT id FROM logistics.pod_records WHERE shipment_id = $1`, [id]);
        if (existing.rowCount && existing.rowCount > 0) {
          // Partial-failure recovery: an earlier POD committed but crashed before the
          // order transition — complete it here instead of erroring the retry.
          const snapshot = await this.orders.getOrderSnapshot(shipment.order_id);
          if (snapshot?.status === 'DISPATCHED') {
            await this.orders.markDelivered(shipment.order_id, ctx.userId, client);
          }
          const body = { id: existing.rows[0].id, shipmentId: id, duplicate: true };
          await completeIdempotencyKey(client, orgId, 'shipment.pod', idemKey, 200, body);
          return { state: 'fresh' as const, responseBody: body };
        }
        throw new ApiException(409, 'CONFLICT', `Shipment is ${shipment.status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      let podId: string;
      try {
        const pod = await client.query<{ id: string }>(
          `INSERT INTO logistics.pod_records
             (shipment_id, order_id, delivered_qty, uom_id, receiver_name, media_object_id,
              signature_ref, notes, shortage_flag, damage_flag, exception_note, recorded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [id, shipment.order_id, dto.deliveredQty, dto.uomId ?? null, dto.receiverName ?? null,
           dto.mediaObjectId ?? null, dto.signatureRef ?? null, dto.notes ?? null,
           dto.shortageFlag ?? false, dto.damageFlag ?? false, dto.exceptionNote ?? null, ctx.userId]
        );
        podId = pod.rows[0].id;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          const existing = await client.query(
            `SELECT id FROM logistics.pod_records WHERE shipment_id = $1`, [id]);
          const body = { id: existing.rows[0].id, shipmentId: id, duplicate: true };
          await completeIdempotencyKey(client, orgId, 'shipment.pod', idemKey, 200, body);
          return { state: 'fresh' as const, responseBody: body };
        }
        throw e;
      }
      await client.query(
        `UPDATE logistics.shipments SET status = 'DELIVERED', actual_arrival_at = now(),
           version = version + 1, updated_at = now() WHERE id = $1`, [id]);
      await this.audit.record(client, {
        action: 'shipment.pod', objectType: 'shipment', objectId: id,
        after: { podId, deliveredQty: dto.deliveredQty, shortage: dto.shortageFlag ?? false, damage: dto.damageFlag ?? false }
      });
      await this.outbox.emit(client, {
        aggregateType: 'shipment', aggregateId: id, type: 'shipment.pod_recorded',
        payload: { shipmentId: id, orderId: shipment.order_id }
      });
      // Cross-context delivery side effects join this transaction (atomic POD chain).
      const lots = await client.query(
        `SELECT lot_id, SUM(packed_qty) AS qty FROM logistics.pack_records WHERE order_id = $1 GROUP BY lot_id`,
        [shipment.order_id]);
      for (const lot of lots.rows) {
        await this.supply.applyDelivery(lot.lot_id, Number(lot.qty), ctx.userId, client);
      }
      const lines = await client.query(
        `SELECT DISTINCT supplier_allocation_line_id FROM logistics.pack_records WHERE order_id = $1`,
        [shipment.order_id]);
      for (const l of lines.rows) {
        await this.orders.applyLineFulfilment(l.supplier_allocation_line_id, 'DELIVERED', ctx.userId, client);
      }
      const buyerOrg = (await this.orders.getOrderSnapshot(shipment.order_id))?.buyerOrgId ?? null;
      await this.quality.recordCustody({
        lotId: lots.rows[0]?.lot_id ?? null, orderId: shipment.order_id, shipmentId: id,
        fromOrgId: orgId, toOrgId: buyerOrg, eventType: 'DESTINATION_RECEIPT', actorUserId: ctx.userId,
        conditionNote: dto.notes ?? null
      }, client);
      await this.orders.markDelivered(shipment.order_id, ctx.userId, client);
      const body = { id: podId, shipmentId: id, orderId: shipment.order_id, status: 'DELIVERED' };
      await completeIdempotencyKey(client, orgId, 'shipment.pod', idemKey, 201, body);
      return { state: 'fresh' as const, responseBody: body };
    });
    if (outcome.state === 'replay') {
      return { ...outcome.responseBody as object, replayed: true };
    }
    // B2: notify the buyer org that delivery awaits their confirmation (best-effort, post-commit).
    const delivered = outcome.responseBody as { orderId?: string; shipmentId?: string };
    if (delivered.orderId) {
      const snap = await this.orders.getOrderSnapshot(delivered.orderId).catch(() => null);
      if (snap?.buyerOrgId) {
        await this.notifications
          .queue(snap.buyerOrgId, null, 'shipment.delivered', { orderId: delivered.orderId, shipmentId: delivered.shipmentId })
          .catch(() => undefined);
      }
    }
    return outcome.responseBody;
  }

  // ADR-002/§21: immutable manual excursion report; CRITICAL blocks acceptance/settlement.
  async reportTemperatureException(id: string, dto: TemperatureExceptionDto): Promise<unknown> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ id: string; order_id: string; org_id: string }>(
        `SELECT id, order_id, org_id FROM logistics.shipments WHERE id = $1 FOR UPDATE`, [id]);
      const shipment = locked.rows[0];
      if (!shipment || (shipment.org_id !== orgId && !this.isOps(ctx))) {
        throw new ApiException(404, 'NOT_FOUND', 'Shipment not found');
      }
      const excursion = await client.query<{ id: string }>(
        `INSERT INTO logistics.temperature_excursion_events
           (shipment_id, handling_profile_id, severity, celsius, duration_seconds, occurred_at, manual, reported_by)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7) RETURNING id`,
        [id, dto.handlingProfileId ?? null, dto.severity, dto.celsius,
         dto.durationSeconds ?? 0, dto.occurredAt, ctx.userId]
      );
      let exceptionId: string | null = null;
      if (dto.severity === 'CRITICAL') {
        const exception = await client.query<{ id: string }>(
          `INSERT INTO logistics.shipment_exceptions
             (shipment_id, excursion_event_id, status, blocks_buyer_acceptance, blocks_supplier_settlement)
           VALUES ($1,$2,'OPEN',true,true) RETURNING id`,
          [id, excursion.rows[0].id]
        );
        exceptionId = exception.rows[0].id;
        await client.query(
          `UPDATE logistics.shipments SET acceptance_hold = true, exception_note = $2, updated_at = now()
           WHERE id = $1`,
          [id, dto.actionTaken ?? `CRITICAL temperature excursion ${dto.celsius}C`]
        );
      }
      await this.audit.record(client, {
        action: 'shipment.temperature_exception', objectType: 'shipment', objectId: id,
        after: { severity: dto.severity, celsius: dto.celsius, blocks: exceptionId !== null }
      });
      await this.outbox.emit(client, {
        aggregateType: 'shipment', aggregateId: id, type: 'shipment.exception_reported',
        payload: { shipmentId: id, severity: dto.severity }
      });
      // Auto-flag only — liability/claims stay a human decision (§21).
      return { excursionId: excursion.rows[0].id, exceptionId, blocked: exceptionId !== null };
    });
  }

  async resolveException(exceptionId: string, dto: ResolveExceptionDto): Promise<unknown> {
    const ctx = RequestContext.get();
    if (!ctx.permissions.includes('procurement.manage')) {
      throw new ApiException(403, 'FORBIDDEN', 'Operations only');
    }
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ id: string; shipment_id: string; status: string }>(
        `SELECT id, shipment_id, status FROM logistics.shipment_exceptions WHERE id = $1 FOR UPDATE`,
        [exceptionId]);
      if (locked.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Exception not found');
      }
      if (locked.rows[0].status !== 'OPEN') {
        throw new ApiException(409, 'CONFLICT', `Exception is ${locked.rows[0].status}`);
      }
      await client.query(
        `UPDATE logistics.shipment_exceptions SET status = 'RESOLVED_HOLD_RELEASED',
           blocks_buyer_acceptance = false, blocks_supplier_settlement = false, updated_at = now()
         WHERE id = $1`, [exceptionId]);
      await client.query(
        `UPDATE logistics.shipments SET acceptance_hold = false, updated_at = now() WHERE id = $1`,
        [locked.rows[0].shipment_id]);
      await this.audit.record(client, {
        action: 'shipment.exception_resolved', objectType: 'shipment_exception', objectId: exceptionId,
        after: { resolution: dto.resolution }
      });
      return { id: exceptionId, status: 'RESOLVED_HOLD_RELEASED' };
    });
  }

  async listForOrder(orderId: string): Promise<{ items: unknown[] }> {
    const ctx = RequestContext.get();
    const snapshot = await this.orders.getOrderSnapshot(orderId);
    if (!snapshot || (ctx.orgId !== snapshot.buyerOrgId && !snapshot.supplierOrgIds.includes(ctx.orgId ?? '') && !this.isOps(ctx))) {
      throw new ApiException(404, 'NOT_FOUND', 'Order not found');
    }
    const rows = await this.db.query(
      `SELECT * FROM logistics.shipments WHERE order_id = $1 ORDER BY created_at`, [orderId]);
    // Phase 4: show the logistics partner by name on the supplier's fulfilment page.
    const partnerIds = [...new Set(rows.rows.map((r) => r.logistics_org_id as string | null).filter((v): v is string => Boolean(v)))];
    const profiles = await this.identity.getOrgPublicProfiles(partnerIds);
    const nameById = new Map(profiles.map((p) => [p.orgId, p.name]));
    return {
      items: rows.rows.map((r) => ({
        ...r,
        logistics_org_name: r.logistics_org_id ? nameById.get(r.logistics_org_id as string) ?? null : null
      }))
    };
  }

  async get(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const shipment = await this.db.query(`SELECT * FROM logistics.shipments WHERE id = $1`, [id]);
    if (shipment.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Shipment not found');
    }
    const snapshot = await this.orders.getOrderSnapshot(shipment.rows[0].order_id);
    const s = shipment.rows[0];
    if (ctx.orgId !== s.org_id && ctx.orgId !== snapshot?.buyerOrgId
        && !snapshot?.supplierOrgIds.includes(ctx.orgId ?? '') && !this.isOps(ctx)) {
      throw new ApiException(404, 'NOT_FOUND', 'Shipment not found');
    }
    const [pods, exceptions] = await Promise.all([
      this.db.query(`SELECT * FROM logistics.pod_records WHERE shipment_id = $1`, [id]),
      this.db.query(`SELECT * FROM logistics.shipment_exceptions WHERE shipment_id = $1`, [id])
    ]);
    return { ...s, pods: pods.rows, exceptions: exceptions.rows };
  }

  // ---------- B4: logistics partner jobs (ADR-011 pilot) ----------

  private async assertJobAccess(id: string): Promise<Record<string, unknown>> {
    const ctx = RequestContext.get();
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM logistics.shipments WHERE id = $1`, [id]);
    const s = rows.rows[0];
    if (!s || (s.logistics_org_id !== ctx.orgId && s.driver_user_id !== ctx.userId && !this.isOps(ctx))) {
      throw new ApiException(404, 'NOT_FOUND', 'Job not found');
    }
    return s;
  }

  // Ops assigns a logistics partner org and (optionally) a driver user. Driver assignment
  // stays optional — bus/rail/air parcel jobs have no platform driver (§16).
  async assignJob(id: string, dto: AssignJobDto): Promise<unknown> {
    const ctx = RequestContext.get();
    if (!ctx.permissions.includes('procurement.manage')) {
      throw new ApiException(404, 'NOT_FOUND', 'Shipment not found');
    }
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ id: string }>(
        `SELECT id FROM logistics.shipments WHERE id = $1 FOR UPDATE`, [id]);
      if (locked.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Shipment not found');
      }
      await client.query(
        `UPDATE logistics.shipments SET logistics_org_id = $2, driver_user_id = $3, assigned_at = now(), updated_at = now()
         WHERE id = $1`,
        [id, dto.logisticsOrgId, dto.driverUserId ?? null]);
      await this.audit.record(client, {
        action: 'shipment.assign', objectType: 'shipment', objectId: id,
        after: { logisticsOrgId: dto.logisticsOrgId, driverUserId: dto.driverUserId ?? null }
      });
      return { id, logisticsOrgId: dto.logisticsOrgId, driverUserId: dto.driverUserId ?? null };
    });
  }

  async listPartnerJobs(): Promise<{ items: unknown[] }> {
    const orgId = RequestContext.requireOrgId();
    const rows = await this.db.query(
      `SELECT * FROM logistics.shipments WHERE logistics_org_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [orgId]);
    return { items: rows.rows };
  }

  async listDriverJobs(): Promise<{ items: unknown[] }> {
    const ctx = RequestContext.get();
    const rows = await this.db.query(
      `SELECT * FROM logistics.shipments WHERE driver_user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [ctx.userId]);
    return { items: rows.rows };
  }

  async getJob(id: string): Promise<unknown> {
    const s = await this.assertJobAccess(id);
    const [media, exceptions, pods] = await Promise.all([
      this.db.query(`SELECT * FROM logistics.shipment_media WHERE shipment_id = $1 ORDER BY captured_at`, [id]),
      this.db.query(`SELECT * FROM logistics.shipment_exceptions WHERE shipment_id = $1 ORDER BY created_at`, [id]),
      this.db.query(`SELECT * FROM logistics.pod_records WHERE shipment_id = $1`, [id])
    ]);
    return { ...s, media: media.rows, exceptions: exceptions.rows, pods: pods.rows };
  }

  async acceptJob(id: string): Promise<unknown> {
    await this.assertJobAccess(id);
    await this.db.query(
      `UPDATE logistics.shipments SET job_accepted_at = COALESCE(job_accepted_at, now()), updated_at = now() WHERE id = $1`,
      [id]);
    return { id, accepted: true };
  }

  async confirmPickup(id: string, dto: ConfirmPickupDto): Promise<unknown> {
    const ctx = RequestContext.get();
    await this.assertJobAccess(id);
    return this.db.withTransaction(async (client) => {
      await client.query(
        `UPDATE logistics.shipments SET pickup_at = COALESCE(pickup_at, now()),
           parcel_awb_ref = COALESCE($2, parcel_awb_ref), transport_ref = COALESCE($3, transport_ref),
           updated_at = now() WHERE id = $1`,
        [id, dto.awbRef ?? null, dto.transportRef ?? null]);
      if (dto.mediaObjectId) {
        await client.query(
          `INSERT INTO logistics.shipment_media (shipment_id, media_object_id, purpose, uploaded_by)
           VALUES ($1, $2, 'PICKUP_EVIDENCE', $3)`,
          [id, dto.mediaObjectId, ctx.userId]);
      }
      await this.audit.record(client, {
        action: 'shipment.pickup', objectType: 'shipment', objectId: id,
        after: { awbRef: dto.awbRef ?? null }
      });
      return { id, pickedUp: true };
    });
  }

  async markInTransit(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    const s = await this.assertJobAccess(id);
    if (s.status === 'PLANNED') {
      await this.db.query(
        `UPDATE logistics.shipments SET status = 'IN_TRANSIT',
           dispatched_at = COALESCE(dispatched_at, now()), updated_at = now() WHERE id = $1`, [id]);
      await this.orders.markDispatched(s.order_id as string, ctx.userId ?? undefined);
    }
    return { id, status: 'IN_TRANSIT' };
  }

  // Partner-side delivery + POD: same pod_records/POD invariants as the ops endpoint.
  async deliverAsPartner(id: string, dto: PodDto): Promise<unknown> {
    const ctx = RequestContext.get();
    const s = await this.assertJobAccess(id);
    const outcome = await this.db.withTransaction(async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM logistics.pod_records WHERE shipment_id = $1`, [id]);
      if ((existing.rowCount ?? 0) > 0) {
        return { replayed: true };
      }
      await client.query(
        `INSERT INTO logistics.pod_records
           (shipment_id, order_id, delivered_qty, uom_id, receiver_name, media_object_id,
            signature_ref, notes, shortage_flag, damage_flag, exception_note, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, s.order_id, dto.deliveredQty, dto.uomId ?? null, dto.receiverName ?? null,
         dto.mediaObjectId ?? null, dto.signatureRef ?? null, dto.notes ?? null,
         dto.shortageFlag ?? false, dto.damageFlag ?? false, dto.exceptionNote ?? null, ctx.userId]);
      await client.query(
        `UPDATE logistics.shipments SET status = 'DELIVERED', actual_arrival_at = now(), updated_at = now() WHERE id = $1`,
        [id]);
      await this.orders.markDelivered(s.order_id as string, ctx.userId ?? undefined, client);
      await this.audit.record(client, {
        action: 'shipment.pod', objectType: 'shipment', objectId: id,
        after: { deliveredQty: dto.deliveredQty, channel: 'PARTNER' }
      });
      return { replayed: false };
    });
    if (!outcome.replayed) {
      const snap = await this.orders.getOrderSnapshot(s.order_id as string).catch(() => null);
      if (snap?.buyerOrgId) {
        await this.notifications
          .queue(snap.buyerOrgId, null, 'shipment.delivered', { orderId: s.order_id, shipmentId: id })
          .catch(() => undefined);
      }
    }
    return { id, status: 'DELIVERED', replayed: outcome.replayed };
  }

  // Partner/driver exception report: feeds Operations (blocks_* stay false — never
  // auto-decides buyer claims or holds, §21).
  async reportException(id: string, dto: ReportLogisticsExceptionDto): Promise<unknown> {
    const ctx = RequestContext.get();
    await this.assertJobAccess(id);
    return this.db.withTransaction(async (client) => {
      const row = await client.query<{ id: string }>(
        `INSERT INTO logistics.shipment_exceptions (shipment_id, org_id, type, note, media_object_id, reported_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [id, ctx.orgId, dto.type, dto.note ?? null, dto.mediaObjectId ?? null, ctx.userId]);
      if (dto.mediaObjectId) {
        await client.query(
          `INSERT INTO logistics.shipment_media (shipment_id, media_object_id, purpose, uploaded_by)
           VALUES ($1,$2,'EXCEPTION_EVIDENCE',$3)`,
          [id, dto.mediaObjectId, ctx.userId]);
      }
      await this.audit.record(client, {
        action: 'shipment.exception_reported', objectType: 'shipment_exception', objectId: row.rows[0].id,
        after: { type: dto.type }
      });
      await this.outbox.emit(client, {
        aggregateType: 'shipment', aggregateId: id, type: 'logistics.exception',
        payload: { shipmentId: id, exceptionId: row.rows[0].id, exceptionType: dto.type }
      });
      return { id: row.rows[0].id, status: 'OPEN' };
    });
  }
}
