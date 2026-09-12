import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class FeatureFlagsService {
  constructor(private readonly db: DatabaseService) {}

  async isEnabled(key: string, at: Date = new Date()): Promise<boolean> {
    const result = await this.db.query<{ enabled: boolean }>(
      `SELECT enabled FROM core.feature_flags
       WHERE key = $1 AND valid_from <= $2 AND (valid_to IS NULL OR valid_to > $2)
       ORDER BY valid_from DESC LIMIT 1`,
      [key, at.toISOString()]
    );
    return result.rows[0]?.enabled ?? false;
  }
}
