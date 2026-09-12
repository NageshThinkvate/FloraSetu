import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { ValidationService } from './validation.service';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';
import { CommercialLineDto, NormalizePreviewDto } from './dto';
import { Body, Post } from '@nestjs/common';

@Controller('catalog')
@UseGuards(RbacGuard)
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly validation: ValidationService
  ) {}

  @Post('commercial-line/validate')
  @RequirePermission('catalog.read')
  validateCommercialLine(@Body() dto: CommercialLineDto) {
    return this.validation.validateCommercialLine(dto);
  }

  @Post('normalize-preview')
  @RequirePermission('catalog.read')
  normalizePreview(@Body() dto: NormalizePreviewDto) {
    return this.validation.normalizePreview(dto);
  }

  @Get('commercial-check/:entity/:id')
  @RequirePermission('catalog.read')
  commercialCheck(@Param('entity') entity: string, @Param('id') id: string) {
    return this.validation.commercialCheck(entity, id);
  }

  @Get('search')
  search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.catalog.search(q, limit ? Math.min(Number(limit), 100) : 25);
  }

  @Get('categories')
  categories() {
    return this.catalog.listCategories();
  }

  @Get('products')
  products(@Query('category') category?: string) {
    return this.catalog.listProducts(category);
  }

  @Get('products/:id')
  product(@Param('id') id: string) {
    return this.catalog.getProduct(id);
  }

  @Get('varieties/:id')
  variety(@Param('id') id: string) {
    return this.catalog.getVariety(id);
  }
}
