import { Global, Module } from '@nestjs/common';
import { CatalogStandards_SERVICE } from './contracts';
import { CatalogStandardsServiceImpl } from './internal/catalog-standards.service';
import { CatalogService } from './internal/catalog.service';
import { CatalogController } from './internal/catalog.controller';
import { CatalogAdminService } from './internal/catalog-admin.service';
import { CatalogAdminController } from './internal/catalog-admin.controller';
import { CapabilitiesService } from './internal/capabilities.service';
import { CapabilitiesController } from './internal/capabilities.controller';
import { ValidationService } from './internal/validation.service';

// Global contract provider: other contexts inject CatalogStandards_SERVICE without
// importing this module (docs/04 — contracts-only boundary, enforced mechanically).
@Global()
@Module({
  controllers: [CatalogController, CatalogAdminController, CapabilitiesController],
  providers: [
    CatalogService,
    CatalogAdminService,
    CapabilitiesService,
    ValidationService,
    { provide: CatalogStandards_SERVICE, useClass: CatalogStandardsServiceImpl }
  ],
  exports: [CatalogStandards_SERVICE]
})
export class CatalogStandardsModule {}
