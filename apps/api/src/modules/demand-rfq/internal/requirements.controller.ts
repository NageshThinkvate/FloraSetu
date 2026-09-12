import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { RequirementsService } from './requirements.service';
import { CancelDto, ConsentDto, CreateRequirementDto, ReviseRequirementDto } from './dto';

@Controller('demand/requirements')
@UseGuards(RbacGuard)
export class RequirementsController {
  constructor(private readonly requirements: RequirementsService) {}

  @Post()
  @RequirePermission('demand.write')
  create(@Body() dto: CreateRequirementDto) {
    return this.requirements.createDraft(dto);
  }

  @Get()
  @RequirePermission('demand.read')
  list() {
    return this.requirements.listMine();
  }

  @Get(':id')
  @RequirePermission('demand.read')
  get(@Param('id') id: string) {
    return this.requirements.get(id);
  }

  @Post(':id/submit')
  @RequirePermission('demand.submit')
  submit(@Param('id') id: string, @Headers('idempotency-key') idemKey?: string) {
    return this.requirements.submit(id, idemKey);
  }

  @Post(':id/revise')
  @RequirePermission('demand.write')
  revise(@Param('id') id: string, @Body() dto: ReviseRequirementDto) {
    return this.requirements.revise(id, dto);
  }

  @Post(':id/evaluate')
  @RequirePermission('quote.evaluate')
  beginEvaluation(@Param('id') id: string) {
    return this.requirements.beginEvaluation(id);
  }

  @Post(':id/consent')
  @RequirePermission('demand.write')
  consent(@Param('id') id: string, @Body() dto: ConsentDto) {
    return this.requirements.consent(id, dto.versionNo);
  }

  @Post(':id/cancel')
  @RequirePermission('demand.write')
  cancel(@Param('id') id: string, @Body() dto: CancelDto) {
    return this.requirements.cancel(id, dto);
  }
}
