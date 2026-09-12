import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { InspectionsService } from './inspections.service';
import { CustodyService } from './custody.service';
import { CompleteInspectionDto, CreateInspectionDto, CustodyEventDto } from './dto';

@Controller('quality')
@UseGuards(RbacGuard)
export class QualityController {
  constructor(
    private readonly inspections: InspectionsService,
    private readonly custody: CustodyService
  ) {}

  @Get('queue')
  @RequirePermission('qc.inspect')
  queue() {
    return this.inspections.queue();
  }

  @Post('inspections')
  @RequirePermission('qc.inspect')
  create(@Body() dto: CreateInspectionDto) {
    return this.inspections.create(dto);
  }

  @Post('inspections/:id/complete')
  @RequirePermission('qc.inspect')
  complete(@Param('id') id: string, @Body() dto: CompleteInspectionDto, @Headers('idempotency-key') idemKey?: string) {
    return this.inspections.complete(id, dto, idemKey);
  }

  @Get('inspections/:id')
  @RequirePermission('qc.read')
  get(@Param('id') id: string) {
    return this.inspections.get(id);
  }

  @Post('custody')
  @RequirePermission('pack.manage')
  recordCustody(@Body() dto: CustodyEventDto) {
    return this.custody.recordHttp(dto);
  }

  @Get('custody/lot/:lotId')
  @RequirePermission('qc.read')
  custodyForLot(@Param('lotId') lotId: string) {
    return this.custody.listForLot(lotId);
  }
}
