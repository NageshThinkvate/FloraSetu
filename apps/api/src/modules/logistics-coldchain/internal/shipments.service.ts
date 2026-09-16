import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../../common/database/database.service';
import { MediaService } from '../../../common/media/media.service';
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
import { IdentityParty_SERVICE, IdentityPartyService, OrgMemberSummary } from '../../identity-party/contracts';
import { AssignDriverDto, AssignJobDto, ConfirmPickupDto, CreateShipmentDto, PodDto, ReportLogisticsExceptionDto, ResolveExceptionDto, TemperatureExceptionDto, UnassignDriverDto } from './dto';

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
    @Inject(IdentityParty_SERVICE) private readonly identity: IdentityPartyService,
    private readonly media: MediaService
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
            parcel_awb_ref, package_count, pickup_at, etd, eta, last_mile_detail, handling_note)
         VALUES ($1,$2,$3,'PLANNED',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
        [ref, orgId, dto.orderId, snapshot.supplierOrgIds.includes(orgId) ? orgId : null,
         dto.mode, dto.tempControlled, dto.carrierName ?? null, dto.originText ?? null,
         dto.destinationText ?? snapshot.deliveryDestination, dto.originTerminal ?? null,
         dto.destinationTerminal ?? null, dto.transportRef ?? null, dto.parcelAwbRef ?? null,
         dto.packageCount ?? null, dto.pickupAt ?? null, dto.etd ?? null, dto.eta ?? null,
         dto.lastMileDetail ?? null, dto.handlingNote ?? null]
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
      await this.insertEvent(client, locked.rows[0].shipment_id, 'EXCEPTION_RESOLVED', { exceptionId });
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

  private async loadJob(id: string): Promise<Record<string, unknown>> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM logistics.shipments WHERE id = $1`, [id]);
    const s = rows.rows[0];
    if (!s) {
      throw new ApiException(404, 'NOT_FOUND', 'Job not found');
    }
    return s;
  }

  // Read: partner managers (logistics.execute), the assigned driver, or Ops
  // (audit/support visibility only). Ordinary members/drivers never read unrelated jobs.
  private async assertJobRead(id: string): Promise<Record<string, unknown>> {
    const ctx = RequestContext.get();
    const s = await this.loadJob(id);
    const isManager = s.logistics_org_id === ctx.orgId && ctx.permissions.includes('logistics.execute');
    const isDriver = s.driver_user_id === ctx.userId && s.logistics_org_id === ctx.orgId;
    if (!isManager && !isDriver && !this.isOps(ctx)) {
      throw new ApiException(404, 'NOT_FOUND', 'Job not found');
    }
    return s;
  }

  // ADR-012: execution is partner-only — org managers (logistics.execute on the job's org)
  // or the currently assigned driver. FloraSetu Ops/Admin have visibility, never
  // operational authority; ordinary members cannot touch unassigned/other-driver jobs.
  private async assertJobExecute(id: string): Promise<Record<string, unknown>> {
    const ctx = RequestContext.get();
    const s = await this.loadJob(id);
    const isManager = s.logistics_org_id === ctx.orgId && ctx.permissions.includes('logistics.execute');
    const isDriver = s.driver_user_id === ctx.userId && s.logistics_org_id === ctx.orgId;
    if (!isManager && !isDriver) {
      throw new ApiException(404, 'NOT_FOUND', 'Job not found');
    }
    return s;
  }

  // Append-only execution event. One-time milestones dedupe via the partial unique index
  // (migration 015), so mobile retries collapse to a single logical event.
  private async insertEvent(
    client: PoolClient,
    shipmentId: string,
    type: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const ctx = RequestContext.get();
    await client.query(
      `INSERT INTO logistics.execution_events (shipment_id, org_id, event_type, actor_user_id, actor_org_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [shipmentId, ctx.orgId ?? null, type, ctx.userId ?? null, ctx.orgId ?? null, JSON.stringify(metadata)]);
  }

  // ADR-012: FloraSetu staff select the logistics PARTNER only (commercial selection).
  // Driver/vehicle assignment is partner-controlled — staff attempts are rejected, and
  // partner-org (re)assignment clears any stale driver/vehicle from a previous partner.
  async assignJob(id: string, dto: AssignJobDto): Promise<unknown> {
    const ctx = RequestContext.get();
    if (!ctx.permissions.includes('procurement.manage')) {
      throw new ApiException(404, 'NOT_FOUND', 'Shipment not found');
    }
    if (dto.driverUserId) {
      throw new ApiException(403, 'FORBIDDEN',
        'Driver assignment is controlled by the logistics partner, not FloraSetu staff',
        { code_detail: 'DRIVER_ASSIGNMENT_PARTNER_ONLY' });
    }
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ id: string }>(
        `SELECT id FROM logistics.shipments WHERE id = $1 FOR UPDATE`, [id]);
      if (locked.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Shipment not found');
      }
      await client.query(
        `UPDATE logistics.shipments SET logistics_org_id = $2, driver_user_id = NULL, vehicle_ref = NULL,
           assigned_at = now(), updated_at = now()
         WHERE id = $1`,
        [id, dto.logisticsOrgId]);
      await this.audit.record(client, {
        action: 'shipment.assign', objectType: 'shipment', objectId: id,
        after: { logisticsOrgId: dto.logisticsOrgId }
      });
      return { id, logisticsOrgId: dto.logisticsOrgId };
    });
  }

  async listPartnerJobs(): Promise<{ items: unknown[] }> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    // ADR-012 §18: managers see all org jobs; members/drivers see only their assigned jobs.
    const isManager = ctx.permissions.includes('logistics.execute');
    const rows = await this.db.query(
      `SELECT s.*, (SELECT count(*)::int FROM logistics.shipment_exceptions e
              WHERE e.shipment_id = s.id AND e.status = 'OPEN') AS open_exceptions
       FROM logistics.shipments s
       WHERE s.logistics_org_id = $1 ${isManager ? '' : 'AND s.driver_user_id = $2'}
       ORDER BY s.created_at DESC LIMIT 100`,
      isManager ? [orgId] : [orgId, ctx.userId]);
    return { items: await this.withDriverNames(rows.rows) };
  }

  async listDriverJobs(): Promise<{ items: unknown[] }> {
    const ctx = RequestContext.get();
    const rows = await this.db.query(
      `SELECT s.*, (SELECT count(*)::int FROM logistics.shipment_exceptions e
              WHERE e.shipment_id = s.id AND e.status = 'OPEN') AS open_exceptions
       FROM logistics.shipments s WHERE s.driver_user_id = $1 ORDER BY s.created_at DESC LIMIT 100`,
      [ctx.userId]);
    return { items: await this.withDriverNames(rows.rows) };
  }

  private async withDriverNames(rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const ids = [...new Set(rows.map((r) => r.driver_user_id as string | null).filter((v): v is string => Boolean(v)))];
    const names = await this.identity.getUserDisplayNames(ids);
    const nameOf = new Map(names.map((n) => [n.userId, n.displayName]));
    return rows.map((r) => ({
      ...r,
      driver_name: r.driver_user_id ? nameOf.get(r.driver_user_id as string) ?? null : null
    }));
  }

  async getJob(id: string): Promise<unknown> {
    const s = await this.assertJobRead(id);
    const [media, exceptions, pods, events, assignments] = await Promise.all([
      this.db.query(`SELECT * FROM logistics.shipment_media WHERE shipment_id = $1 ORDER BY captured_at`, [id]),
      this.db.query(`SELECT * FROM logistics.shipment_exceptions WHERE shipment_id = $1 ORDER BY created_at`, [id]),
      this.db.query(`SELECT * FROM logistics.pod_records WHERE shipment_id = $1`, [id]),
      this.db.query(`SELECT * FROM logistics.execution_events WHERE shipment_id = $1 ORDER BY seq`, [id]),
      this.db.query(`SELECT * FROM logistics.driver_assignments WHERE shipment_id = $1 ORDER BY created_at`, [id])
    ]);
    // Display enrichment via contracts only (ADR-010/012): party names, actor names,
    // short-lived signed evidence URLs. No buyer pricing is exposed on partner surfaces.
    const snapshot = await this.orders.getOrderSnapshot(s.order_id as string).catch(() => null);
    const orgIds = [...new Set(
      [snapshot?.buyerOrgId ?? null, s.supplier_org_id as string | null, ...(snapshot?.supplierOrgIds ?? [])]
        .filter((v): v is string => Boolean(v)))];
    const profiles = await this.identity.getOrgPublicProfiles(orgIds);
    const orgName = (oid: string | null | undefined): string | null =>
      (oid ? profiles.find((p) => p.orgId === oid)?.name ?? null : null);
    const userIds = [...new Set([
      s.driver_user_id as string | null,
      ...events.rows.map((e) => e.actor_user_id as string | null),
      ...assignments.rows.flatMap((a) => [a.driver_user_id as string | null, a.previous_driver_user_id as string | null])
    ].filter((v): v is string => Boolean(v)))];
    const names = await this.identity.getUserDisplayNames(userIds);
    const userName = (uid: string | null | undefined): string | null =>
      (uid ? names.find((n) => n.userId === uid)?.displayName ?? null : null);
    const sign = async (objectId: string | null): Promise<string | null> =>
      (objectId ? (await this.media.signRead(objectId, 900)).url : null);
    const mediaItems = await Promise.all(
      media.rows.map(async (m) => ({ ...m, url: await sign(m.media_object_id as string) })));
    const podItems = await Promise.all(pods.rows.map(async (p) => ({
      ...p,
      url: await sign(p.media_object_id as string | null),
      signature_url: await sign(p.signature_media_object_id as string | null)
    })));
    return {
      ...s,
      order_ref: snapshot?.ref ?? null,
      driver_name: userName(s.driver_user_id as string | null),
      pickup_company: orgName((s.supplier_org_id as string | null) ?? snapshot?.supplierOrgIds[0] ?? null),
      delivery_company: orgName(snapshot?.buyerOrgId ?? null),
      media: mediaItems,
      exceptions: exceptions.rows,
      pods: podItems,
      events: events.rows.map((e) => ({ ...e, actor_name: userName(e.actor_user_id as string | null) })),
      assignments: assignments.rows.map((a) => ({
        ...a,
        driver_name: userName(a.driver_user_id as string | null),
        previous_driver_name: userName(a.previous_driver_user_id as string | null)
      }))
    };
  }

  async acceptJob(id: string): Promise<unknown> {
    await this.assertJobExecute(id);
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ job_accepted_at: string | null; status: string }>(
        `SELECT job_accepted_at, status FROM logistics.shipments WHERE id = $1 FOR UPDATE`, [id]);
      const s = locked.rows[0];
      if (s.status === 'DELIVERED') {
        throw new ApiException(409, 'CONFLICT', 'Job is already delivered', { code_detail: 'ILLEGAL_TRANSITION' });
      }
      if (s.job_accepted_at) {
        return { id, accepted: true, replayed: true };
      }
      await client.query(
        `UPDATE logistics.shipments SET job_accepted_at = now(), updated_at = now() WHERE id = $1`, [id]);
      await this.insertEvent(client, id, 'JOB_ACCEPTED');
      await this.audit.record(client, {
        action: 'shipment.job_accept', objectType: 'shipment', objectId: id, after: {}
      });
      return { id, accepted: true };
    });
  }

  async confirmPickup(id: string, dto: ConfirmPickupDto): Promise<unknown> {
    const ctx = RequestContext.get();
    await this.assertJobExecute(id);
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ job_accepted_at: string | null; status: string }>(
        `SELECT job_accepted_at, status FROM logistics.shipments WHERE id = $1 FOR UPDATE`, [id]);
      const s = locked.rows[0];
      if (!s.job_accepted_at) {
        throw new ApiException(409, 'CONFLICT', 'Accept the job before confirming pickup', { code_detail: 'ILLEGAL_TRANSITION' });
      }
      if (s.status !== 'PLANNED') {
        throw new ApiException(409, 'CONFLICT', `Job is ${s.status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      const dup = await client.query(
        `SELECT 1 FROM logistics.execution_events WHERE shipment_id = $1 AND event_type = 'PICKUP_CONFIRMED'`, [id]);
      if ((dup.rowCount ?? 0) > 0) {
        return { id, pickedUp: true, replayed: true };
      }
      await client.query(
        `UPDATE logistics.shipments SET pickup_at = COALESCE(pickup_at, now()),
           parcel_awb_ref = COALESCE($2, parcel_awb_ref), transport_ref = COALESCE($3, transport_ref),
           arrived_pickup_at = COALESCE(arrived_pickup_at, now()), updated_at = now() WHERE id = $1`,
        [id, dto.awbRef ?? null, dto.transportRef ?? null]);
      if (dto.mediaObjectId) {
        await client.query(
          `INSERT INTO logistics.shipment_media (shipment_id, media_object_id, purpose, uploaded_by)
           VALUES ($1, $2, 'PICKUP_EVIDENCE', $3)`,
          [id, dto.mediaObjectId, ctx.userId]);
      }
      await this.insertEvent(client, id, 'PICKUP_CONFIRMED', {
        awbRef: dto.awbRef ?? null, transportRef: dto.transportRef ?? null
      });
      await this.audit.record(client, {
        action: 'shipment.pickup', objectType: 'shipment', objectId: id,
        after: { awbRef: dto.awbRef ?? null }
      });
      return { id, pickedUp: true };
    });
  }

  async markInTransit(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    await this.assertJobExecute(id);
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ status: string; order_id: string }>(
        `SELECT status, order_id FROM logistics.shipments WHERE id = $1 FOR UPDATE`, [id]);
      const s = locked.rows[0];
      if (s.status === 'IN_TRANSIT') {
        return { id, status: 'IN_TRANSIT', replayed: true };
      }
      if (s.status !== 'PLANNED') {
        throw new ApiException(409, 'CONFLICT', `Job is ${s.status}`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      const pickedUp = await client.query(
        `SELECT 1 FROM logistics.execution_events WHERE shipment_id = $1 AND event_type = 'PICKUP_CONFIRMED'`, [id]);
      if ((pickedUp.rowCount ?? 0) === 0) {
        throw new ApiException(409, 'CONFLICT', 'Confirm pickup before starting transit', { code_detail: 'ILLEGAL_TRANSITION' });
      }
      await client.query(
        `UPDATE logistics.shipments SET status = 'IN_TRANSIT',
           dispatched_at = COALESCE(dispatched_at, now()), updated_at = now() WHERE id = $1`, [id]);
      await this.insertEvent(client, id, 'IN_TRANSIT');
      await this.audit.record(client, {
        action: 'shipment.transit', objectType: 'shipment', objectId: id, after: {}
      });
      await this.orders.markDispatched(s.order_id, ctx.userId ?? undefined, client);
      return { id, status: 'IN_TRANSIT' };
    });
  }

  // ADR-012: backend-persisted arrival events — never frontend-only markers.
  async arrivedAtPickup(id: string): Promise<unknown> {
    await this.assertJobExecute(id);
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ job_accepted_at: string | null; arrived_pickup_at: string | null; status: string }>(
        `SELECT job_accepted_at, arrived_pickup_at, status FROM logistics.shipments WHERE id = $1 FOR UPDATE`, [id]);
      const s = locked.rows[0];
      if (s.arrived_pickup_at) {
        return { id, arrivedPickupAt: s.arrived_pickup_at, replayed: true };
      }
      if (!s.job_accepted_at || s.status !== 'PLANNED') {
        throw new ApiException(409, 'CONFLICT', 'Job must be accepted and pre-pickup to mark arrival', { code_detail: 'ILLEGAL_TRANSITION' });
      }
      const upd = await client.query<{ arrived_pickup_at: string }>(
        `UPDATE logistics.shipments SET arrived_pickup_at = now(), updated_at = now() WHERE id = $1 RETURNING arrived_pickup_at`, [id]);
      await this.insertEvent(client, id, 'ARRIVED_AT_PICKUP');
      await this.audit.record(client, {
        action: 'shipment.arrived_pickup', objectType: 'shipment', objectId: id, after: {}
      });
      return { id, arrivedPickupAt: upd.rows[0].arrived_pickup_at };
    });
  }

  async arrivedAtDelivery(id: string): Promise<unknown> {
    await this.assertJobExecute(id);
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ arrived_delivery_at: string | null; status: string }>(
        `SELECT arrived_delivery_at, status FROM logistics.shipments WHERE id = $1 FOR UPDATE`, [id]);
      const s = locked.rows[0];
      if (s.arrived_delivery_at) {
        return { id, arrivedDeliveryAt: s.arrived_delivery_at, replayed: true };
      }
      if (s.status !== 'IN_TRANSIT') {
        throw new ApiException(409, 'CONFLICT', 'Job must be in transit to mark arrival at delivery', { code_detail: 'ILLEGAL_TRANSITION' });
      }
      const upd = await client.query<{ arrived_delivery_at: string }>(
        `UPDATE logistics.shipments SET arrived_delivery_at = now(), updated_at = now() WHERE id = $1 RETURNING arrived_delivery_at`, [id]);
      await this.insertEvent(client, id, 'ARRIVED_AT_DELIVERY');
      await this.audit.record(client, {
        action: 'shipment.arrived_delivery', objectType: 'shipment', objectId: id, after: {}
      });
      return { id, arrivedDeliveryAt: upd.rows[0].arrived_delivery_at };
    });
  }

  // Partner-side delivery + POD: same pod_records/POD invariants as the ops endpoint.
  // ADR-012: structured evidence (delivery photo + optional signature file + documentary
  // reference). POD never implies quality acceptance, claim closure or payment release.
  async deliverAsPartner(id: string, dto: PodDto): Promise<unknown> {
    const ctx = RequestContext.get();
    await this.assertJobExecute(id);
    const outcome = await this.db.withTransaction(async (client) => {
      const locked = await client.query<{ order_id: string; status: string }>(
        `SELECT order_id, status FROM logistics.shipments WHERE id = $1 FOR UPDATE`, [id]);
      const s = locked.rows[0];
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM logistics.pod_records WHERE shipment_id = $1`, [id]);
      if ((existing.rowCount ?? 0) > 0) {
        return { replayed: true };
      }
      if (s.status !== 'IN_TRANSIT') {
        throw new ApiException(409, 'CONFLICT', `Job is ${s.status}; delivery requires IN_TRANSIT`, { code_detail: 'ILLEGAL_TRANSITION' });
      }
      await client.query(
        `INSERT INTO logistics.pod_records
           (shipment_id, order_id, delivered_qty, uom_id, receiver_name, media_object_id,
            signature_ref, signature_media_object_id, pod_ref, notes, shortage_flag, damage_flag, exception_note, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id, s.order_id, dto.deliveredQty, dto.uomId ?? null, dto.receiverName ?? null,
         dto.mediaObjectId ?? null, dto.signatureRef ?? null, dto.signatureMediaObjectId ?? null,
         dto.podRef ?? null, dto.notes ?? null,
         dto.shortageFlag ?? false, dto.damageFlag ?? false, dto.exceptionNote ?? null, ctx.userId]);
      for (const mediaId of [dto.mediaObjectId, dto.signatureMediaObjectId]) {
        if (mediaId) {
          await client.query(
            `INSERT INTO logistics.shipment_media (shipment_id, media_object_id, purpose, uploaded_by)
             VALUES ($1, $2, 'POD', $3)`,
            [id, mediaId, ctx.userId]);
        }
      }
      await client.query(
        `UPDATE logistics.shipments SET status = 'DELIVERED', actual_arrival_at = now(),
           arrived_delivery_at = COALESCE(arrived_delivery_at, now()), updated_at = now() WHERE id = $1`,
        [id]);
      await this.insertEvent(client, id, 'DELIVERY_CONFIRMED', { deliveredQty: dto.deliveredQty });
      await this.insertEvent(client, id, 'POD_SUBMITTED', { podRef: dto.podRef ?? null, receiverName: dto.receiverName ?? null });
      await this.orders.markDelivered(s.order_id, ctx.userId ?? undefined, client);
      await this.audit.record(client, {
        action: 'shipment.pod', objectType: 'shipment', objectId: id,
        after: { deliveredQty: dto.deliveredQty, podRef: dto.podRef ?? null, channel: 'PARTNER' }
      });
      return { replayed: false };
    });
    if (!outcome.replayed) {
      const snap = await this.orders.getOrderSnapshot(
        (await this.loadJob(id)).order_id as string
      ).catch(() => null);
      if (snap?.buyerOrgId) {
        await this.notifications
          .queue(snap.buyerOrgId, null, 'shipment.delivered', { orderId: snap.id, shipmentId: id })
          .catch(() => undefined);
      }
    }
    return { id, status: 'DELIVERED', replayed: outcome.replayed };
  }

  // Partner/driver exception report: feeds Operations (blocks_* stay false — never
  // auto-decides buyer claims or holds, §21).
  async reportException(id: string, dto: ReportLogisticsExceptionDto): Promise<unknown> {
    const ctx = RequestContext.get();
    await this.assertJobExecute(id);
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
      await this.insertEvent(client, id, 'EXCEPTION_REPORTED', { exceptionId: row.rows[0].id, type: dto.type });
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

  // ---------- Phase 5 (ADR-012): partner-controlled execution ----------

  // Partner admin dashboard buckets. Counts are operational lenses and may overlap.
  async jobsDashboard(): Promise<Record<string, number>> {
    const orgId = RequestContext.requireOrgId();
    const r = await this.db.query<Record<string, number>>(
      `SELECT
         count(*) FILTER (WHERE s.job_accepted_at IS NULL AND s.status <> 'DELIVERED')::int AS new_jobs,
         count(*) FILTER (WHERE s.status = 'PLANNED' AND s.pickup_at::date = CURRENT_DATE)::int AS pickup_today,
         count(*) FILTER (WHERE s.job_accepted_at IS NOT NULL AND s.status = 'PLANNED')::int AS awaiting_pickup,
         count(*) FILTER (WHERE s.status = 'IN_TRANSIT')::int AS in_transit,
         count(*) FILTER (WHERE s.status = 'IN_TRANSIT' AND s.eta::date = CURRENT_DATE)::int AS delivery_today,
         count(*) FILTER (WHERE s.arrived_delivery_at IS NOT NULL AND s.status <> 'DELIVERED')::int AS pod_missing,
         count(*) FILTER (WHERE s.status <> 'DELIVERED' AND EXISTS (
           SELECT 1 FROM logistics.shipment_exceptions e
           WHERE e.shipment_id = s.id AND e.status = 'OPEN'))::int AS exceptions_open
       FROM logistics.shipments s WHERE s.logistics_org_id = $1`,
      [orgId]);
    return r.rows[0];
  }

  // Driver picker: ACTIVE members of the caller's own organization only (never cross-org).
  async listEligibleDrivers(): Promise<{ items: OrgMemberSummary[] }> {
    const ctx = RequestContext.get();
    const orgId = RequestContext.requireOrgId();
    if (!ctx.permissions.includes('logistics.assign_driver')) {
      throw new ApiException(403, 'FORBIDDEN', 'Missing required permission', { missing: ['logistics.assign_driver'] });
    }
    return { items: await this.identity.listActiveMembers(orgId) };
  }

  // ADR-012: partner-controlled driver assignment — own-org jobs, own-org ACTIVE members,
  // full history preserved. Staff/buyer/supplier/foreign partner attempts are denied.
  async assignDriver(id: string, dto: AssignDriverDto): Promise<unknown> {
    const ctx = RequestContext.get();
    if (!ctx.permissions.includes('logistics.assign_driver')) {
      throw new ApiException(403, 'FORBIDDEN', 'Missing required permission', { missing: ['logistics.assign_driver'] });
    }
    const orgId = RequestContext.requireOrgId();
    const eligible = await this.identity.isActiveMember(orgId, dto.driverUserId);
    if (!eligible) {
      throw new ApiException(404, 'NOT_FOUND', 'Member not found in your organization');
    }
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ status: string; logistics_org_id: string | null; driver_user_id: string | null }>(
        `SELECT status, logistics_org_id, driver_user_id FROM logistics.shipments WHERE id = $1 FOR UPDATE`, [id]);
      const s = locked.rows[0];
      if (!s || s.logistics_org_id !== orgId) {
        throw new ApiException(404, 'NOT_FOUND', 'Job not found');
      }
      if (s.status === 'DELIVERED') {
        throw new ApiException(409, 'CONFLICT', 'Job is already delivered', { code_detail: 'ILLEGAL_TRANSITION' });
      }
      const previous = s.driver_user_id;
      const action = previous ? 'REASSIGNED' : 'ASSIGNED';
      await client.query(
        `UPDATE logistics.shipments SET driver_user_id = $2,
           vehicle_ref = COALESCE($3, vehicle_ref), updated_at = now() WHERE id = $1`,
        [id, dto.driverUserId, dto.vehicleRef ?? null]);
      await client.query(
        `INSERT INTO logistics.driver_assignments
           (shipment_id, org_id, action, previous_driver_user_id, driver_user_id, vehicle_ref, reason, actor_user_id, actor_org_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, orgId, action, previous, dto.driverUserId, dto.vehicleRef ?? null, dto.reason ?? null, ctx.userId, orgId]);
      await this.insertEvent(client, id, previous ? 'DRIVER_REASSIGNED' : 'DRIVER_ASSIGNED', {
        previousDriverUserId: previous, driverUserId: dto.driverUserId, vehicleRef: dto.vehicleRef ?? null
      });
      await this.audit.record(client, {
        action: 'shipment.driver_assign', objectType: 'shipment', objectId: id,
        before: { driverUserId: previous },
        after: { driverUserId: dto.driverUserId, vehicleRef: dto.vehicleRef ?? null }
      });
      return { id, driverUserId: dto.driverUserId, action };
    });
  }

  async unassignDriver(id: string, dto: UnassignDriverDto): Promise<unknown> {
    const ctx = RequestContext.get();
    if (!ctx.permissions.includes('logistics.assign_driver')) {
      throw new ApiException(403, 'FORBIDDEN', 'Missing required permission', { missing: ['logistics.assign_driver'] });
    }
    const orgId = RequestContext.requireOrgId();
    return this.db.withTransaction(async (client) => {
      const locked = await client.query<{ status: string; logistics_org_id: string | null; driver_user_id: string | null }>(
        `SELECT status, logistics_org_id, driver_user_id FROM logistics.shipments WHERE id = $1 FOR UPDATE`, [id]);
      const s = locked.rows[0];
      if (!s || s.logistics_org_id !== orgId) {
        throw new ApiException(404, 'NOT_FOUND', 'Job not found');
      }
      if (s.status === 'DELIVERED') {
        throw new ApiException(409, 'CONFLICT', 'Job is already delivered', { code_detail: 'ILLEGAL_TRANSITION' });
      }
      if (!s.driver_user_id) {
        throw new ApiException(409, 'CONFLICT', 'No driver is assigned to this job', { code_detail: 'ILLEGAL_TRANSITION' });
      }
      const previous = s.driver_user_id;
      await client.query(
        `UPDATE logistics.shipments SET driver_user_id = NULL, vehicle_ref = NULL, updated_at = now() WHERE id = $1`, [id]);
      await client.query(
        `INSERT INTO logistics.driver_assignments
           (shipment_id, org_id, action, previous_driver_user_id, driver_user_id, reason, actor_user_id, actor_org_id)
         VALUES ($1,$2,'UNASSIGNED',$3,NULL,$4,$5,$6)`,
        [id, orgId, previous, dto.reason ?? null, ctx.userId, orgId]);
      await this.insertEvent(client, id, 'DRIVER_UNASSIGNED', { previousDriverUserId: previous });
      await this.audit.record(client, {
        action: 'shipment.driver_unassign', objectType: 'shipment', objectId: id,
        before: { driverUserId: previous }, after: { driverUserId: null }
      });
      return { id, driverUserId: null, action: 'UNASSIGNED' };
    });
  }
}
