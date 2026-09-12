import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { EventsService } from './events.service';
import { CreateBomLineDto, CreateCeremonyDto, CreateEventDto, UpdateEventDto } from './dto';

@Controller('demand/events')
@UseGuards(RbacGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @RequirePermission('event.write')
  create(@Body() dto: CreateEventDto) {
    return this.events.create(dto);
  }

  @Get()
  @RequirePermission('event.read')
  list() {
    return this.events.listMine();
  }

  @Get(':id')
  @RequirePermission('event.read')
  get(@Param('id') id: string) {
    return this.events.get(id);
  }

  @Patch(':id')
  @RequirePermission('event.write')
  update(@Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.events.update(id, dto);
  }

  @Post(':id/ceremonies')
  @RequirePermission('event.write')
  addCeremony(@Param('id') id: string, @Body() dto: CreateCeremonyDto) {
    return this.events.addCeremony(id, dto);
  }

  @Post(':id/bom-lines')
  @RequirePermission('event.write')
  addBomLine(@Param('id') id: string, @Body() dto: CreateBomLineDto) {
    return this.events.addBomLine(id, dto);
  }
}
