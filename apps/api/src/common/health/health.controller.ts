import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async check(): Promise<{ status: string; db: string; time: string }> {
    await this.db.query('SELECT 1');
    return { status: 'ok', db: 'up', time: new Date().toISOString() };
  }
}
