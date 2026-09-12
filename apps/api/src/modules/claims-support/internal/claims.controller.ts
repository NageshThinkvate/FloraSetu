import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { ClaimsService } from './claims.service';
import { AddEvidenceDto, ClaimTransitionDto, CreateClaimDto, RespondClaimDto } from './dto';

@Controller('claims')
@UseGuards(RbacGuard)
export class ClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Post()
  @RequirePermission('claim.create')
  create(@Body() dto: CreateClaimDto, @Headers('idempotency-key') idemKey?: string) {
    return this.claims.create(dto, idemKey);
  }

  @Get()
  @RequirePermission('claim.create')
  listMine() {
    return this.claims.listMine();
  }

  @Get(':id')
  @RequirePermission('claim.create')
  get(@Param('id') id: string) {
    return this.claims.get(id);
  }

  @Post(':id/submit')
  @RequirePermission('claim.create')
  submit(@Param('id') id: string, @Headers('idempotency-key') idemKey?: string) {
    return this.claims.submit(id, idemKey);
  }

  @Post(':id/respond')
  @RequirePermission('claim.create')
  respond(@Param('id') id: string, @Body() dto: RespondClaimDto) {
    return this.claims.respond(id, dto);
  }

  @Post(':id/evidence')
  @RequirePermission('claim.create')
  addEvidence(@Param('id') id: string, @Body() dto: AddEvidenceDto) {
    return this.claims.addEvidence(id, dto);
  }

  @Post(':id/transition')
  @RequirePermission('claim.manage')
  transition(@Param('id') id: string, @Body() dto: ClaimTransitionDto) {
    return this.claims.transition(id, dto);
  }
}
