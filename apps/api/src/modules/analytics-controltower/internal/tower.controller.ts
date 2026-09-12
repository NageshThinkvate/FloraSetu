import { Controller, Get, UseGuards } from '@nestjs/common';
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
}
