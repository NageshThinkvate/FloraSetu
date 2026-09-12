import { Body, Controller, ForbiddenException, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { RbacGuard, RequirePermission } from '../authz/rbac.guard';
import { DevTokenVerifier } from '../authz/token-verifier';
import { RequestContext } from '../request-context';
import { ApiException } from '../errors/error-envelope';
import { claimIdempotencyKey, completeIdempotencyKey, hashRequest, IDEMPOTENCY_HEADER } from '../idempotency/idempotency.service';
import { ReferenceIdService } from '../pagination/reference-id.service';
import { AppConfig } from '../../config/configuration';
import { Inject } from '@nestjs/common';
import { APP_CONFIG } from '../database/database.module';

// Build 0 acceptance-gate harness. Dev/test only; NOT business functionality.
// Exercises: org isolation, RBAC, idempotency, audit, outbox — over core.config_entries.
@Controller('_baseline')
export class BaselineController {
  private readonly verifier: DevTokenVerifier;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly refIds: ReferenceIdService,
    @Inject(APP_CONFIG) config: AppConfig
  ) {
    this.verifier = new DevTokenVerifier(config.jwtDevSecret);
  }

  @Post('dev-token')
  mintDevToken(
    @Body() body: { sub: string; orgId: string; roles?: string[]; permissions?: string[] },
    @Res() res: Response
  ): void {
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new ForbiddenException('dev tokens disabled outside development/test');
    }
    const token = this.verifier.sign({
      sub: body.sub,
      orgId: body.orgId,
      roles: body.roles ?? [],
      permissions: body.permissions ?? []
    });
    res.status(200).json({ token });
  }

  @Post('entries')
  @UseGuards(RbacGuard)
  @RequirePermission('config.write')
  async createEntry(
    @Body() body: { key: string; value: unknown },
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    const orgId = RequestContext.requireOrgId();
    const key = req.header(IDEMPOTENCY_HEADER);
    if (!key) {
      throw new ApiException(400, 'VALIDATION_FAILED', 'Idempotency-Key header required');
    }
    const requestHash = hashRequest(body);
    const outcome = await this.db.withTransaction(async (client) => {
      const claim = await claimIdempotencyKey(client, orgId, 'baseline.entries.create', key, requestHash);
      if (claim.state === 'replay') {
        return claim;
      }
      const ref = await this.refIds.next(client, 'CFG');
      const inserted = await client.query<{ id: string; ref: string }>(
        `INSERT INTO core.config_entries (org_id, key, value, ref, version_no, valid_from)
         VALUES ($1,$2,$3,$4,1,now()) RETURNING id, ref`,
        [orgId, body.key, JSON.stringify(body.value ?? null), ref]
      );
      const row = inserted.rows[0];
      await this.audit.record(client, {
        action: 'config.entry.create',
        objectType: 'config_entry',
        objectId: row.id,
        objectRef: row.ref,
        after: { key: body.key }
      });
      await this.outbox.emit(client, {
        aggregateType: 'config_entry',
        aggregateId: row.id,
        type: 'baseline.entry.created',
        payload: { id: row.id, ref: row.ref, orgId }
      });
      const responseBody = { id: row.id, ref: row.ref };
      await completeIdempotencyKey(client, orgId, 'baseline.entries.create', key, 201, responseBody);
      return { state: 'fresh' as const, responseStatus: 201, responseBody };
    });
    if (outcome.state === 'replay') {
      res.setHeader('Idempotency-Replayed', 'true');
    }
    res.status(outcome.responseStatus ?? 201).json(outcome.responseBody);
  }

  @Get('entries')
  @UseGuards(RbacGuard)
  @RequirePermission('config.read')
  async listEntries(): Promise<{ items: unknown[] }> {
    const orgId = RequestContext.requireOrgId();
    const result = await this.db.query(
      `SELECT id, ref, key, value, version_no FROM core.config_entries
       WHERE org_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [orgId]
    );
    return { items: result.rows };
  }

  @Get('entries/:id')
  @UseGuards(RbacGuard)
  @RequirePermission('config.read')
  async getEntry(@Param('id') id: string): Promise<unknown> {
    const orgId = RequestContext.requireOrgId();
    const result = await this.db.query(
      `SELECT id, ref, key, value, version_no FROM core.config_entries WHERE id = $1 AND org_id = $2`,
      [id, orgId]
    );
    if (result.rowCount === 0) {
      throw new ApiException(404, 'NOT_FOUND', 'Entry not found');
    }
    return result.rows[0];
  }
}
