import { Controller, Get, UseGuards } from '@nestjs/common';
import { RbacGuard } from '../authz/rbac.guard';
import { DatabaseService } from '../database/database.service';
import { FeatureFlagsService } from './feature-flags.service';

// Pilot runtime configuration for shells (ADR-011): inspection feature flag +
// evidence policy. Read-only; values come from core.feature_flags / core.pilot_settings.
@Controller('config')
@UseGuards(RbacGuard)
export class PilotConfigController {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly db: DatabaseService
  ) {}

  @Get('pilot')
  async pilot(): Promise<{ independentInspectionEnabled: boolean; lotEvidenceMinPhotos: number }> {
    const [independentInspectionEnabled, minPhotos] = await Promise.all([
      this.flags.isEnabled('INDEPENDENT_INSPECTION_ENABLED'),
      this.db.query<{ value: string }>(
        `SELECT value::text AS value FROM core.pilot_settings WHERE key = 'LOT_EVIDENCE_MIN_PHOTOS'`
      )
    ]);
    return {
      independentInspectionEnabled,
      lotEvidenceMinPhotos: Number(minPhotos.rows[0]?.value ?? 2)
    };
  }
}
