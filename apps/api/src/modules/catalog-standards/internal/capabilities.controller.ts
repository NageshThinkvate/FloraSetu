import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CapabilitiesService } from './capabilities.service';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { CreateCapabilityDto } from './dto';

@Controller('catalog/capabilities')
@UseGuards(RbacGuard)
export class CapabilitiesController {
  constructor(private readonly capabilities: CapabilitiesService) {}

  @Get()
  @RequirePermission('catalog.read')
  listMine() {
    return this.capabilities.listMine();
  }

  @Post()
  @RequirePermission('catalog.capability.write')
  add(@Body() dto: CreateCapabilityDto) {
    return this.capabilities.add(dto.varietyId, dto.notes);
  }

  @Delete(':id')
  @RequirePermission('catalog.capability.write')
  remove(@Param('id') id: string) {
    return this.capabilities.remove(id);
  }
}
