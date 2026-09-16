import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RbacGuard, RequirePermission } from '../authz/rbac.guard';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { ApiException } from '../errors/error-envelope';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

// Phase 7 (ADR-014): runtime configuration + feature-flag governance.
// Only keys that already exist are writable — this page never invents new configuration.
// Every change is effective-dated (flags) and recorded in the immutable audit stream
// with old value, new value, actor and timestamp. Flags never bypass RBAC.
@Controller('admin')
@UseGuards(RbacGuard)
export class AdminConfigController {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService
  ) {}

  @Get('config')
  @RequirePermission('config.read')
  async config(): Promise<{ items: unknown[] }> {
    const result = await this.db.query(
      `SELECT key, value::text AS value, updated_at FROM core.pilot_settings ORDER BY key`
    );
    return { items: result.rows };
  }

  @Patch('config/:key')
  @RequirePermission('config.write')
  async updateConfig(@Param('key') key: string, @Body() body: { value: unknown; reason?: string }): Promise<unknown> {
    if (body.value === undefined || body.value === null || typeof body.value === 'object') {
      throw new ApiException(400, 'VALIDATION_FAILED', 'A scalar value is required');
    }
    return this.db.withTransaction(async (client) => {
      const current = await client.query<{ value: string }>(
        `SELECT value::text AS value FROM core.pilot_settings WHERE key = $1 FOR UPDATE`,
        [key]
      );
      if (current.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Unknown configuration key');
      }
      await client.query(
        `UPDATE core.pilot_settings SET value = $2::jsonb, updated_at = now() WHERE key = $1`,
        [key, JSON.stringify(body.value)]
      );
      await this.audit.record(client, {
        action: 'admin.config.update', objectType: 'config', objectId: NIL_UUID, objectRef: key,
        before: { value: current.rows[0].value },
        after: { value: body.value, reason: body.reason ?? null }
      });
      return { key, value: body.value };
    });
  }

  @Get('flags')
  @RequirePermission('config.read')
  async flags(): Promise<{ items: unknown[] }> {
    const result = await this.db.query(
      `SELECT key, enabled, valid_from, valid_to, created_at
       FROM core.feature_flags ORDER BY key, valid_from DESC`
    );
    return { items: result.rows };
  }

  @Post('flags/:key')
  @RequirePermission('flag.manage')
  async setFlag(@Param('key') key: string, @Body() body: { enabled: boolean; reason?: string }): Promise<unknown> {
    if (typeof body.enabled !== 'boolean') {
      throw new ApiException(400, 'VALIDATION_FAILED', 'enabled must be a boolean');
    }
    return this.db.withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT 1 FROM core.feature_flags WHERE key = $1 LIMIT 1`,
        [key]
      );
      if (existing.rowCount === 0) {
        throw new ApiException(404, 'NOT_FOUND', 'Unknown feature flag');
      }
      // Effective-dated history: close the current window, open a new one — never overwrite.
      await client.query(
        `UPDATE core.feature_flags SET valid_to = now() WHERE key = $1 AND valid_to IS NULL AND valid_from < now()`,
        [key]
      );
      await client.query(
        `INSERT INTO core.feature_flags (key, enabled, valid_from) VALUES ($1, $2, now())`,
        [key, body.enabled]
      );
      await this.audit.record(client, {
        action: 'admin.flag.update', objectType: 'feature_flag', objectId: NIL_UUID, objectRef: key,
        after: { enabled: body.enabled, reason: body.reason ?? null }
      });
      return { key, enabled: body.enabled };
    });
  }
}
