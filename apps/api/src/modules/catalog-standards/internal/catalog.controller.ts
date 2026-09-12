import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { RbacGuard, RequirePermission } from '../../../common/authz/rbac.guard';

@Controller('catalog')
@UseGuards(RbacGuard)
@RequirePermission('catalog.read')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

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
