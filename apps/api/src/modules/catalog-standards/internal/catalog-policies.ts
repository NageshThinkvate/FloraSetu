// Catalog-local copy of the supplier-side category set (contexts must not import
// identity-party internals; org type arrives via RequestContext).
export const SUPPLIER_SIDE_ORG_TYPES = new Set([
  'GROWER', 'GROWER_GROUP', 'IMPORTER', 'AGGREGATION_HUB',
  'WHOLESALER', 'QC_PARTNER', 'LOGISTICS_PROVIDER', 'COLD_CHAIN_PARTNER'
]);
