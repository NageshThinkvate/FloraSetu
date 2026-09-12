import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { OpsService } from './ops.service';
import { SourcingNoteDto } from './dto';

@Controller('demand/ops')
@UseGuards(RbacGuard)
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('desk')
  @RequirePermission('procurement.manage')
  desk() {
    return this.ops.desk();
  }

  @Post('requirements/:id/sourcing-notes')
  @RequirePermission('procurement.manage')
  addSourcingNote(@Param('id') id: string, @Body() dto: SourcingNoteDto) {
    return this.ops.addSourcingNote(id, dto);
  }

  @Get('requirements/:id/sourcing-notes')
  @RequirePermission('procurement.manage')
  sourcingNotes(@Param('id') id: string) {
    return this.ops.sourcingNotes(id);
  }
}
