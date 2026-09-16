import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { TowerService } from './tower.service';

@Controller('tower')
@UseGuards(RbacGuard)
export class TowerController {
  constructor(private readonly tower: TowerService) {}

  @Get('exceptions')
  @RequirePermission('procurement.manage')
  exceptions() {
    return this.tower.exceptions();
  }

  // ---------- Phase 6 (ADR-013): composed staff control tower ----------

  @Get('board')
  @RequirePermission('tower.read')
  board() {
    return this.tower.board();
  }

  @Get('board/export')
  @RequirePermission('tower.read')
  async boardExport(@Res() res: Response): Promise<void> {
    const csv = await this.tower.boardCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ops-exceptions-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }

  @Get('orders')
  @RequirePermission('tower.read')
  ordersMonitor() {
    return this.tower.ordersMonitor();
  }

  @Get('logistics')
  @RequirePermission('tower.read')
  logisticsMonitor() {
    return this.tower.logisticsMonitor();
  }

  @Get('search')
  @RequirePermission('tower.read')
  search(@Query('q') q?: string) {
    return this.tower.search(q ?? '');
  }
}
