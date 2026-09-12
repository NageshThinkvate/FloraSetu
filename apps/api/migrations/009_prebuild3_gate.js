// 009 — Pre-Build-3 control gate: OD-07 (explicit commercial UoM + preferred UoM)
// and OD-08 (validation lifecycle DEMO→PENDING_REVIEW→VALIDATED/REJECTED, reviewer
// ≠ proposer on protected masters). data_classification renamed to validation_status
// (unit_conversions gains the column fresh — it never had one).
const RENAMED = ['grade_profiles', 'pack_definitions', 'handling_profiles'];

exports.up = async (client) => {
  const renamedSql = RENAMED.map(
    (t) => `
    ALTER TABLE catalog.${t} RENAME COLUMN data_classification TO validation_status;
    ALTER TABLE catalog.${t} DROP CONSTRAINT ${t}_data_classification_check;
    ALTER TABLE catalog.${t} ALTER COLUMN validation_status SET DEFAULT 'DEMO';`
  ).join('\n');
  const all = [...RENAMED, 'unit_conversions'];
  const reviewCols = all.map(
    (t) => `
    ALTER TABLE catalog.${t}
      ADD COLUMN requested_by UUID, ADD COLUMN requested_at TIMESTAMPTZ,
      ADD COLUMN reviewed_by UUID, ADD COLUMN reviewed_at TIMESTAMPTZ,
      ADD COLUMN validation_reference TEXT, ADD COLUMN reviewer_notes TEXT,
      ADD COLUMN rejection_reason TEXT;
    ALTER TABLE catalog.${t} ADD CONSTRAINT ${t}_validation_status_check
      CHECK (validation_status IN ('DEMO','PENDING_REVIEW','VALIDATED','REJECTED'));`
  ).join('\n');
  await client.query(`
    ${renamedSql}
    ALTER TABLE catalog.unit_conversions
      ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'DEMO';
    ${reviewCols}

    -- Non-versioned masters: same lifecycle vocabulary (identity column rename).
    ALTER TABLE catalog.commodities RENAME COLUMN data_classification TO validation_status;
    ALTER TABLE catalog.varieties RENAME COLUMN data_classification TO validation_status;
    ALTER TABLE catalog.categories RENAME COLUMN data_classification TO validation_status;
    ALTER TABLE catalog.units_of_measure RENAME COLUMN data_classification TO validation_status;
    ALTER TABLE catalog.commodities ALTER COLUMN validation_status SET DEFAULT 'DEMO';
    ALTER TABLE catalog.varieties ALTER COLUMN validation_status SET DEFAULT 'DEMO';
    ALTER TABLE catalog.categories ALTER COLUMN validation_status SET DEFAULT 'DEMO';
    ALTER TABLE catalog.units_of_measure ALTER COLUMN validation_status SET DEFAULT 'VALIDATED';
    ALTER TABLE catalog.commodities DROP CONSTRAINT commodities_data_classification_check;
    ALTER TABLE catalog.varieties DROP CONSTRAINT varieties_data_classification_check;
    ALTER TABLE catalog.categories DROP CONSTRAINT categories_data_classification_check;
    ALTER TABLE catalog.units_of_measure DROP CONSTRAINT units_of_measure_data_classification_check;
    ALTER TABLE catalog.commodities ADD CONSTRAINT commodities_validation_status_check
      CHECK (validation_status IN ('DEMO','PENDING_REVIEW','VALIDATED','REJECTED'));
    ALTER TABLE catalog.varieties ADD CONSTRAINT varieties_validation_status_check
      CHECK (validation_status IN ('DEMO','PENDING_REVIEW','VALIDATED','REJECTED'));
    ALTER TABLE catalog.categories ADD CONSTRAINT categories_validation_status_check
      CHECK (validation_status IN ('DEMO','PENDING_REVIEW','VALIDATED','REJECTED'));
    ALTER TABLE catalog.units_of_measure ADD CONSTRAINT units_of_measure_validation_status_check
      CHECK (validation_status IN ('DEMO','PENDING_REVIEW','VALIDATED','REJECTED'));

    -- OD-07: preferred order UoM is UI convenience only; transactions persist explicit uom_id.
    ALTER TABLE catalog.commodities
      ADD COLUMN preferred_order_uom_id UUID REFERENCES catalog.units_of_measure(id);
    ALTER TABLE catalog.pack_definitions
      ADD COLUMN preferred_order_uom_id UUID REFERENCES catalog.units_of_measure(id);

    -- OD-08: validation permission + validator role.
    INSERT INTO identity.permissions (code, description) VALUES
      ('catalog.validate','Review and validate catalog master versions (separate from proposer)')
    ON CONFLICT (code) DO NOTHING;
    INSERT INTO identity.roles (org_id, name, is_system, mfa_required)
    SELECT NULL, 'CATALOG_VALIDATOR', true, false
    WHERE NOT EXISTS (SELECT 1 FROM identity.roles WHERE name = 'CATALOG_VALIDATOR' AND org_id IS NULL);
    INSERT INTO identity.role_permissions (role_id, permission_id)
    SELECT ro.id, pe.id FROM identity.roles ro, identity.permissions pe
    WHERE ro.org_id IS NULL AND pe.code = 'catalog.validate'
      AND ro.name IN ('PLATFORM_ADMIN','CATALOG_VALIDATOR')
    ON CONFLICT DO NOTHING;
  `);
};

exports.down = async (client) => {
  const renamedSql = RENAMED.map(
    (t) => `
    ALTER TABLE catalog.${t} DROP CONSTRAINT ${t}_validation_status_check;
    ALTER TABLE catalog.${t} ADD CONSTRAINT ${t}_validation_status_check
      CHECK (validation_status IN ('DEMO','VALIDATED'));
    UPDATE catalog.${t} SET validation_status = 'DEMO'
      WHERE validation_status IN ('PENDING_REVIEW','REJECTED');
    ALTER TABLE catalog.${t} RENAME COLUMN validation_status TO data_classification;
    ALTER TABLE catalog.${t} ALTER COLUMN data_classification SET DEFAULT 'DEMO';`
  ).join('\n');
  const all = [...RENAMED, 'unit_conversions'];
  const dropCols = all.map(
    (t) => `
    ALTER TABLE catalog.${t}
      DROP COLUMN requested_by, DROP COLUMN requested_at, DROP COLUMN reviewed_by,
      DROP COLUMN reviewed_at, DROP COLUMN validation_reference, DROP COLUMN reviewer_notes,
      DROP COLUMN rejection_reason;`
  ).join('\n');
  await client.query(`
    ${dropCols}
    ${renamedSql}
    ALTER TABLE catalog.unit_conversions DROP CONSTRAINT unit_conversions_validation_status_check;
    ALTER TABLE catalog.unit_conversions DROP COLUMN validation_status;

    ALTER TABLE catalog.commodities DROP COLUMN preferred_order_uom_id;
    ALTER TABLE catalog.pack_definitions DROP COLUMN preferred_order_uom_id;

    ALTER TABLE catalog.commodities DROP CONSTRAINT commodities_validation_status_check;
    ALTER TABLE catalog.varieties DROP CONSTRAINT varieties_validation_status_check;
    ALTER TABLE catalog.categories DROP CONSTRAINT categories_validation_status_check;
    ALTER TABLE catalog.units_of_measure DROP CONSTRAINT units_of_measure_validation_status_check;
    ALTER TABLE catalog.commodities ADD CONSTRAINT commodities_validation_status_check CHECK (validation_status IN ('DEMO','VALIDATED'));
    ALTER TABLE catalog.varieties ADD CONSTRAINT varieties_validation_status_check CHECK (validation_status IN ('DEMO','VALIDATED'));
    ALTER TABLE catalog.categories ADD CONSTRAINT categories_validation_status_check CHECK (validation_status IN ('DEMO','VALIDATED'));
    ALTER TABLE catalog.units_of_measure ADD CONSTRAINT units_of_measure_validation_status_check CHECK (validation_status IN ('DEMO','VALIDATED'));
    UPDATE catalog.commodities SET validation_status = 'DEMO' WHERE validation_status IN ('PENDING_REVIEW','REJECTED');
    UPDATE catalog.varieties SET validation_status = 'DEMO' WHERE validation_status IN ('PENDING_REVIEW','REJECTED');
    UPDATE catalog.categories SET validation_status = 'DEMO' WHERE validation_status IN ('PENDING_REVIEW','REJECTED');
    UPDATE catalog.units_of_measure SET validation_status = 'VALIDATED' WHERE validation_status IN ('PENDING_REVIEW','REJECTED');
    ALTER TABLE catalog.commodities RENAME COLUMN validation_status TO data_classification;
    ALTER TABLE catalog.varieties RENAME COLUMN validation_status TO data_classification;
    ALTER TABLE catalog.categories RENAME COLUMN validation_status TO data_classification;
    ALTER TABLE catalog.units_of_measure RENAME COLUMN validation_status TO data_classification;

    DELETE FROM identity.role_permissions WHERE permission_id IN
      (SELECT id FROM identity.permissions WHERE code = 'catalog.validate');
    DELETE FROM identity.user_roles WHERE role_id IN
      (SELECT id FROM identity.roles WHERE name = 'CATALOG_VALIDATOR' AND org_id IS NULL);
    DELETE FROM identity.roles WHERE name = 'CATALOG_VALIDATOR' AND org_id IS NULL;
    DELETE FROM identity.permissions WHERE code = 'catalog.validate';
  `);
};
