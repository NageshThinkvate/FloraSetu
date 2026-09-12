import { Module } from '@nestjs/common';
import { CatalogStandards_SERVICE } from './contracts';
import { CatalogStandardsServiceImpl } from './internal/catalog-standards.service';

@Module({
  providers: [{ provide: CatalogStandards_SERVICE, useClass: CatalogStandardsServiceImpl }],
  exports: [CatalogStandards_SERVICE]
})
export class CatalogStandardsModule {}
