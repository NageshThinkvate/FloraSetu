import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CatalogAdminService } from './catalog-admin.service';
import { ValidationService } from './validation.service';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import {
  CreateAliasDto, CreateCategoryDto, CreateColourDto, CreateConversionDto, CreateDefectTypeDto,
  CreateGradeProfileDto, CreateHandlingProfileDto, CreatePackDto, CreateProductDto,
  CreateQualityAttributeDto, CreateTransportRuleDto, CreateUomDto, CreateVarietyDto,
  LaunchFlagsDto, ReviewValidationDto, StatusChangeDto
} from './dto';

@Controller('catalog/admin')
@UseGuards(RbacGuard)
export class CatalogAdminController {
  constructor(
    private readonly admin: CatalogAdminService,
    private readonly validation: ValidationService
  ) {}

  @Post(':entity/:id/request-validation')
  @RequirePermission('catalog.write')
  requestValidation(@Param('entity') entity: string, @Param('id') id: string) {
    return this.validation.requestValidation(entity, id);
  }

  @Post(':entity/:id/review-validation')
  @RequirePermission('catalog.validate')
  reviewValidation(@Param('entity') entity: string, @Param('id') id: string, @Body() dto: ReviewValidationDto) {
    return this.validation.reviewValidation(entity, id, dto.decision as 'VALIDATED' | 'REJECTED', dto);
  }

  @Get('masters')
  @RequirePermission('catalog.write')
  masters() {
    return this.admin.listMasters();
  }

  @Post('categories')
  @RequirePermission('catalog.write')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.admin.createCategory(dto);
  }

  @Post('products')
  @RequirePermission('catalog.write')
  createProduct(@Body() dto: CreateProductDto) {
    return this.admin.createProduct(dto);
  }

  @Post('aliases')
  @RequirePermission('catalog.write')
  createAlias(@Body() dto: CreateAliasDto) {
    return this.admin.createAlias(dto);
  }

  @Post('colours')
  @RequirePermission('catalog.write')
  createColour(@Body() dto: CreateColourDto) {
    return this.admin.createColour(dto);
  }

  @Post('varieties')
  @RequirePermission('catalog.write')
  createVariety(@Body() dto: CreateVarietyDto) {
    return this.admin.createVariety(dto);
  }

  @Post('units')
  @RequirePermission('catalog.write')
  createUom(@Body() dto: CreateUomDto) {
    return this.admin.createUom(dto);
  }

  @Post('conversions')
  @RequirePermission('catalog.write')
  createConversion(@Body() dto: CreateConversionDto) {
    return this.admin.createConversion(dto);
  }

  @Post('packs')
  @RequirePermission('catalog.write')
  createPack(@Body() dto: CreatePackDto) {
    return this.admin.createPack(dto);
  }

  @Post('grade-profiles')
  @RequirePermission('catalog.write')
  createGradeProfile(@Body() dto: CreateGradeProfileDto) {
    return this.admin.createGradeProfile(dto);
  }

  @Post('quality-attributes')
  @RequirePermission('catalog.write')
  createQualityAttribute(@Body() dto: CreateQualityAttributeDto) {
    return this.admin.createQualityAttribute(dto);
  }

  @Post('defect-types')
  @RequirePermission('catalog.write')
  createDefectType(@Body() dto: CreateDefectTypeDto) {
    return this.admin.createDefectType(dto);
  }

  @Post('handling-profiles')
  @RequirePermission('catalog.write')
  createHandlingProfile(@Body() dto: CreateHandlingProfileDto) {
    return this.admin.createHandlingProfile(dto);
  }

  @Post('transport-rules')
  @RequirePermission('catalog.write')
  createTransportRule(@Body() dto: CreateTransportRuleDto) {
    return this.admin.createTransportRule(dto);
  }

  @Patch('products/:id/launch-flags')
  @RequirePermission('catalog.write')
  updateLaunchFlags(@Param('id') id: string, @Body() dto: LaunchFlagsDto) {
    return this.admin.updateLaunchFlags(id, dto);
  }

  @Get('versions/:entity')
  @RequirePermission('catalog.write')
  versions(@Param('entity') entity: 'grade_profiles' | 'pack_definitions' | 'unit_conversions' | 'handling_profiles') {
    return this.admin.listVersions(entity);
  }

  @Patch(':entity/:id/status')
  @RequirePermission('catalog.write')
  changeStatus(
    @Param('entity') entity: 'grade_profiles' | 'pack_definitions' | 'unit_conversions' | 'handling_profiles' | 'commodities' | 'varieties',
    @Param('id') id: string,
    @Body() dto: StatusChangeDto
  ) {
    return this.admin.changeStatus(entity, id, dto.status, dto.reason);
  }
}
