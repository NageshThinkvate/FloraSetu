// Public contract surface of the CatalogStandards bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface CatalogStandardsService {
  contextKey(): 'catalog-standards';
  commodityExists(commodityId: string): Promise<boolean>;
  varietyExists(varietyId: string): Promise<boolean>;
  // Canonical UOM conversion (versioned, product-scoped). Null when no chain exists.
  convert(commodityId: string | null, fromUomCode: string, toUomCode: string, qty: number): Promise<number | null>;
}

export const CatalogStandards_SERVICE = 'CatalogStandards_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type CatalogStandardsEvent =
  | { v: 1; type: 'catalog.product.created'; commodityId: string; ref: string; at: string }
  | { v: 1; type: 'catalog.standard.published'; entity: string; id: string; versionNo: number; at: string };
