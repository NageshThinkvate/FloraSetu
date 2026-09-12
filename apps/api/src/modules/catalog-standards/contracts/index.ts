// Public contract surface of the CatalogStandards bounded context.
// Other contexts may import ONLY this file (see docs/03-module-boundaries.md).

export interface CatalogStandardsService {
  contextKey(): 'catalog-standards';
  commodityExists(commodityId: string): Promise<boolean>;
  varietyExists(varietyId: string): Promise<boolean>;
  // Canonical UOM conversion (versioned, product-scoped). Null when no chain exists.
  convert(commodityId: string | null, fromUomCode: string, toUomCode: string, qty: number): Promise<number | null>;
  // GUARDRAIL B: authoritative server-side commercial eligibility for a requirement line.
  // Throws ApiException unless every referenced master exists, is ACTIVE + VALIDATED
  // (unless env permits DEMO), inside its effective window, and relationships hold.
  assertCommercialLine(input: {
    commodityId: string;
    varietyId?: string | null;
    gradeProfileId?: string | null;
    packDefinitionId?: string | null;
    uomId: string;
  }): Promise<{ masterSnapshot: Record<string, unknown> }>;
  // Versioned conversion for supplier quote normalization; null when none valid (never invent).
  normalize(commodityId: string, fromUomId: string, toUomId: string, qty: number): Promise<{
    factor: number; conversionVersionId: string; conversionVersionNo: number; normalizedQty: number;
  } | null>;
  // Managed sourcing: orgs with ACTIVE capability on varieties of these commodities.
  findCapableSuppliers(commodityIds: string[]): Promise<string[]>;
  // QC: versioned grade-profile snapshot at inspection time (never invent grades).
  getGradeProfileSnapshot(gradeProfileId: string): Promise<{
    id: string; versionNo: number; rules: unknown; status: string; validationStatus: string;
  } | null>;
  // Lot registration: current ACTIVE handling profile for a commodity (null when none).
  getActiveHandlingProfile(commodityId: string): Promise<{ id: string; versionNo: number } | null>;
}

export const CatalogStandards_SERVICE = 'CatalogStandards_SERVICE';

// Domain events published by this context (payloads versioned, additive-only).
export type CatalogStandardsEvent =
  | { v: 1; type: 'catalog.product.created'; commodityId: string; ref: string; at: string }
  | { v: 1; type: 'catalog.standard.published'; entity: string; id: string; versionNo: number; at: string };
