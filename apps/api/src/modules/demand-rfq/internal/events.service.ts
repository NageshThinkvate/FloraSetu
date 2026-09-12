import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { ReferenceIdService } from '../../../common/pagination/reference-id.service';
import { ApiException } from '../../../common/errors/error-envelope';
import { RequestContext } from '../../../common/request-context';
import { CatalogStandards_SERVICE, CatalogStandardsService } from '../../catalog-standards/contracts';
import { assertBuyerAccess } from './demand-policies';
import { CreateBomLineDto, CreateCeremonyDto, CreateEventDto, UpdateEventDto } from './dto';

@Injectable()
export class EventsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    @Inject(CatalogStandards_SERVICE) private readonly catalogService: CatalogStandardsService
  ) {}

  async create(dto: CreateEventDto): Promise<unknown> {
    const ctx = RequestContext.get();
    if (!ctx.orgId) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'X-Org-Id header required');
    }
    if (dto.startsAt && dto.endsAt && new Date(dto.endsAt) <= new Date(dto.startsAt)) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'endsAt must be after startsAt');
    }
    return this.db.withTransaction(async (client) => {
      const ref = await this.refIds.next(client, 'EVT');
      const result = await client.query(
        `INSERT INTO demand.events (ref, org_id, name, event_type, starts_at, ends_at, venue_name, venue_address, contact_name, contact_phone, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, ref, name, event_type, status`,
        [ref, ctx.orgId, dto.name, dto.eventType, dto.startsAt ?? null, dto.endsAt ?? null,
         dto.venueName ?? null, dto.venueAddress ?? null, dto.contactName ?? null,
         dto.contactPhone ?? null, dto.notes ?? null]
      );
      await this.audit.record(client, {
        action: 'event.create', objectType: 'event', objectId: result.rows[0].id, objectRef: ref,
        after: { name: dto.name, eventType: dto.eventType }
      });
      return result.rows[0];
    });
  }

  async listMine(): Promise<{ items: unknown[] }> {
    const ctx = RequestContext.get();
    const result = await this.db.query(
      `SELECT e.id, e.ref, e.name, e.event_type, e.status, e.starts_at, e.ends_at,
              (SELECT count(*)::int FROM demand.event_ceremonies c WHERE c.event_id = e.id) AS ceremonies,
              (SELECT count(*)::int FROM demand.event_bom_lines b WHERE b.event_id = e.id) AS bom_lines
       FROM demand.events e WHERE e.org_id = $1 AND e.deleted_at IS NULL ORDER BY e.created_at DESC`,
      [ctx.orgId]
    );
    return { items: result.rows };
  }

  async get(id: string): Promise<unknown> {
    const ctx = RequestContext.get();
    assertBuyerAccess(ctx, await this.orgOf(id));
    const event = await this.db.query(`SELECT * FROM demand.events WHERE id = $1 AND deleted_at IS NULL`, [id]);
    const [ceremonies, bom] = await Promise.all([
      this.db.query(`SELECT * FROM demand.event_ceremonies WHERE event_id = $1 ORDER BY sort_order, created_at`, [id]),
      this.db.query(
        `SELECT b.*, (b.requirement_line_id IS NOT NULL) AS linked
         FROM demand.event_bom_lines b WHERE b.event_id = $1 ORDER BY b.created_at`,
        [id]
      )
    ]);
    return { ...event.rows[0], ceremonies: ceremonies.rows, bomLines: bom.rows };
  }

  private async orgOf(eventId: string): Promise<string> {
    const r = await this.db.query<{ org_id: string }>(
      `SELECT org_id FROM demand.events WHERE id = $1 AND deleted_at IS NULL`, [eventId]);
    if (r.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Event not found');
    }
    return r.rows[0].org_id;
  }

  async update(id: string, dto: UpdateEventDto): Promise<unknown> {
    const ctx = RequestContext.get();
    assertBuyerAccess(ctx, await this.orgOf(id));
    if (dto.startsAt && dto.endsAt && new Date(dto.endsAt) <= new Date(dto.startsAt)) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'endsAt must be after startsAt');
    }
    return this.db.withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE demand.events SET
           name = COALESCE($2, name), event_type = COALESCE($3, event_type),
           starts_at = COALESCE($4, starts_at), ends_at = COALESCE($5, ends_at),
           venue_name = COALESCE($6, venue_name), venue_address = COALESCE($7, venue_address),
           notes = COALESCE($8, notes), status = COALESCE($9, status),
           version = version + 1, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL RETURNING id, ref, status`,
        [id, dto.name ?? null, dto.eventType ?? null, dto.startsAt ?? null, dto.endsAt ?? null,
         dto.venueName ?? null, dto.venueAddress ?? null, dto.notes ?? null, dto.status ?? null]
      );
      if (updated.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Event not found');
      }
      await this.audit.record(client, {
        action: 'event.update', objectType: 'event', objectId: id, objectRef: updated.rows[0].ref,
        after: dto as unknown as Record<string, unknown>
      });
      return updated.rows[0];
    });
  }

  async addCeremony(eventId: string, dto: CreateCeremonyDto): Promise<unknown> {
    assertBuyerAccess(RequestContext.get(), await this.orgOf(eventId));
    return this.db.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO demand.event_ceremonies (event_id, name, starts_at, venue_name, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name`,
        [eventId, dto.name, dto.startsAt ?? null, dto.venueName ?? null, dto.notes ?? null, dto.sortOrder ?? 1]
      );
      await this.audit.record(client, {
        action: 'event.ceremony.add', objectType: 'event_ceremony', objectId: result.rows[0].id,
        after: { eventId, name: dto.name }
      });
      return result.rows[0];
    });
  }

  async addBomLine(eventId: string, dto: CreateBomLineDto): Promise<unknown> {
    assertBuyerAccess(RequestContext.get(), await this.orgOf(eventId));
    if (!(await this.catalogService.commodityExists(dto.commodityId))) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Unknown product', { code_detail: 'UNKNOWN_REFERENCE' });
    }
    if (dto.ceremonyId) {
      const ceremony = await this.db.query(
        `SELECT 1 FROM demand.event_ceremonies WHERE id = $1 AND event_id = $2`, [dto.ceremonyId, eventId]);
      if (ceremony.rowCount === 0) {
        throw new ApiException(400, 'VALIDATION_FAILED', 'Ceremony not found in this event');
      }
    }
    return this.db.withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO demand.event_bom_lines (event_id, ceremony_id, commodity_id, variety_id, quantity, uom_id, needed_at, delivery_milestone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [eventId, dto.ceremonyId ?? null, dto.commodityId, dto.varietyId ?? null, dto.quantity,
         dto.uomId, dto.neededAt ?? null, dto.deliveryMilestone ?? null]
      );
      await this.audit.record(client, {
        action: 'event.bom.add', objectType: 'event_bom_line', objectId: result.rows[0].id,
        after: { eventId, commodityId: dto.commodityId, quantity: dto.quantity }
      });
      return result.rows[0];
    });
  }
}
