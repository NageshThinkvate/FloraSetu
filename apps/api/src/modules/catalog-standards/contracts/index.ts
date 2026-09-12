// Public contract surface of the CatalogStandards bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface CatalogStandardsService {
  contextKey(): 'catalog-standards';
}

export const CatalogStandards_SERVICE = 'CatalogStandards_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type CatalogStandardsEvent =
  | { v: 1; type: 'catalog-standards.scaffold.ready'; at: string };
