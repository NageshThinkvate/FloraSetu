import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { LotsService } from './lots.service';
import { AddLotMediaDto, CreateHarvestLotDto, CreateStockLotDto, ResolveHoldDto, SubmitDeclarationDto } from './dto';

@Controller('supply/lots')
@UseGuards(RbacGuard)
export class SupplyController {
  constructor(private readonly lots: LotsService) {}

  @Post('stock')
  @RequirePermission('lot.write')
  createStock(@Body() dto: CreateStockLotDto, @Headers('idempotency-key') idemKey?: string) {
    return this.lots.createStockLot(dto, idemKey);
  }

  @Post('harvest')
  @RequirePermission('lot.write')
  createHarvest(@Body() dto: CreateHarvestLotDto, @Headers('idempotency-key') idemKey?: string) {
    return this.lots.createHarvestLot(dto, idemKey);
  }

  @Get()
  @RequirePermission('lot.read')
  list() {
    return this.lots.listMine();
  }

  @Get(':id')
  @RequirePermission('lot.read')
  get(@Param('id') id: string) {
    return this.lots.get(id);
  }

  @Post(':id/media')
  @RequirePermission('lot.write')
  addMedia(@Param('id') id: string, @Body() dto: AddLotMediaDto) {
    return this.lots.addMedia(id, dto);
  }

  @Get(':id/media')
  @RequirePermission('lot.read')
  getMedia(@Param('id') id: string) {
    return this.lots.getMedia(id);
  }

  @Post(':id/submit-qc')
  @RequirePermission('lot.write')
  submitQc(@Param('id') id: string) {
    return this.lots.submitForQc(id);
  }

  // ADR-011: pilot supplier-declaration path (replaces QC submission for declared lots).
  @Post(':id/declaration')
  @RequirePermission('lot.write')
  submitDeclaration(@Param('id') id: string, @Body() dto: SubmitDeclarationDto) {
    return this.lots.submitDeclaration(id, dto);
  }

  @Post(':id/resolve-hold')
  @RequirePermission('lot.write')
  resolveHold(@Param('id') id: string, @Body() dto: ResolveHoldDto) {
    return this.lots.resolveHold(id, dto);
  }
}
