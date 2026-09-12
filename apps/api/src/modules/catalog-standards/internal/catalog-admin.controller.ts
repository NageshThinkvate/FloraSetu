import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CatalogAdminService } from './catalog-admin.service';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import {
  CreateAliasDto, CreateCategoryDto, CreateColourDto, CreateConversionDto, CreateDefectTypeDto,
  CreateGradeProfileDto, CreateHandlingProfileDto, CreatePackDto, CreateProductDto,
  CreateQualityAttributeDto, CreateTransportRuleDto, CreateUomDto, CreateVarietyDto,
  LaunchFlagsDto, StatusChangeDto
} from './dto';

@Controller('catalog/admin')
@UseGuards(RbacGuard)
@RequirePermission('catalog.write')
export class CatalogAdminController {
  constructor(private readonly admin: CatalogAdminService) {}

  @Get('masters')
  masters() {
    return this.admin.listMasters();
  }

  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.admin.createCategory(dto);
  }

  @Post('products')
  createProduct(@Body() dto: CreateProductDto) {
    return this.admin.createProduct(dto);
  }

  @Post('aliases')
  createAlias(@Body() dto: CreateAliasDto) {
    return this.admin.createAlias(dto);
  }

  @Post('colours')
  createColour(@Body() dto: CreateColourDto) {
    return this.admin.createColour(dto);
  }

  @Post('varieties')
  createVariety(@Body() dto: CreateVarietyDto) {
    return this.admin.createVariety(dto);
  }

  @Post('units')
  createUom(@Body() dto: CreateUomDto) {
    return this.admin.createUom(dto);
  }

  @Post('conversions')
  createConversion(@Body() dto: CreateConversionDto) {
    return this.admin.createConversion(dto);
  }

  @Post('packs')
  createPack(@Body() dto: CreatePackDto) {
    return this.admin.createPack(dto);
  }

  @Post('grade-profiles')
  createGradeProfile(@Body() dto: CreateGradeProfileDto) {
    return this.admin.createGradeProfile(dto);
  }

  @Post('quality-attributes')
  createQualityAttribute(@Body() dto: CreateQualityAttributeDto) {
    return this.admin.createQualityAttribute(dto);
  }

  @Post('defect-types')
  createDefectType(@Body() dto: CreateDefectTypeDto) {
    return this.admin.createDefectType(dto);
  }

  @Post('handling-profiles')
  createHandlingProfile(@Body() dto: CreateHandlingProfileDto) {
    return this.admin.createHandlingProfile(dto);
  }

  @Post('transport-rules')
  createTransportRule(@Body() dto: CreateTransportRuleDto) {
    return this.admin.createTransportRule(dto);
  }

  @Patch('products/:id/launch-flags')
  updateLaunchFlags(@Param('id') id: string, @Body() dto: LaunchFlagsDto) {
    return this.admin.updateLaunchFlags(id, dto);
  }

  @Get('versions/:entity')
  versions(@Param('entity') entity: 'grade_profiles' | 'pack_definitions' | 'unit_conversions' | 'handling_profiles') {
    return this.admin.listVersions(entity);
  }

  @Patch(':entity/:id/status')
  changeStatus(
    @Param('entity') entity: 'grade_profiles' | 'pack_definitions' | 'unit_conversions' | 'handling_profiles' | 'commodities' | 'varieties',
    @Param('id') id: string,
    @Body() dto: StatusChangeDto
  ) {
    return this.admin.changeStatus(entity, id, dto.status, dto.reason);
  }
}
