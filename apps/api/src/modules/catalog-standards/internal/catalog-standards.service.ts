import { Injectable } from '@nestjs/common';
import { CatalogStandardsService } from '../contracts';

@Injectable()
export class CatalogStandardsServiceImpl implements CatalogStandardsService {
  contextKey(): 'catalog-standards' {
    return 'catalog-standards';
  }
}
