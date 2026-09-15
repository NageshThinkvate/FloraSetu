// 013 — Phase 2 UI/UX: explicit org workspace capabilities (UX-ADR-001) + notification read state (B2).
exports.up = async (client) => {
  await client.query(`
    ALTER TABLE identity.organizations
      ADD COLUMN capabilities TEXT[] NOT NULL DEFAULT '{}';

    -- Category-derived DEFAULTS only: capabilities are explicit configuration and freely
    -- overridable per organization (UX-ADR-001 — category alone never decides workspaces).
    UPDATE identity.organizations SET capabilities = CASE
      WHEN type IN ('BUYER','FLORIST','DECORATOR','EVENT_PLANNER','HOTEL','CORPORATE_BUYER') THEN ARRAY['BUYER']
      WHEN type IN ('GROWER','GROWER_GROUP','IMPORTER','AGGREGATION_HUB','WHOLESALER') THEN ARRAY['SUPPLIER']
      WHEN type = 'QC_PARTNER' THEN ARRAY['PARTNER_QC']
      ELSE '{}'::text[] END;

    ALTER TABLE notifications.notifications ADD COLUMN read_at TIMESTAMPTZ;
  `);
};

exports.down = async (client) => {
  await client.query(`
    ALTER TABLE notifications.notifications DROP COLUMN IF EXISTS read_at;
    ALTER TABLE identity.organizations DROP COLUMN IF EXISTS capabilities;
  `);
};
