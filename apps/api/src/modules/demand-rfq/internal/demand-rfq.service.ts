import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { DemandRfqService } from '../contracts';

@Injectable()
export class DemandRfqServiceImpl implements DemandRfqService {
  constructor(private readonly db: DatabaseService) {}

  contextKey(): 'demand-rfq' {
    return 'demand-rfq';
  }

  async requirementExists(requirementId: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM demand.requirements WHERE id = $1`,
      [requirementId]
    );
    return (r.rowCount ?? 0) > 0;
  }
}
