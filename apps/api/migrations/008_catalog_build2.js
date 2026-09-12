// 008 — Build 2: Catalog & Standards (Master v2.0). Canonical product model,
// versioned grade/pack/conversion/handling masters, defect taxonomy, transport
// compatibility metadata, supplier capabilities. DEMO/VALIDATED classification.
exports.up = async (client) => {
  await client.query(`
    -- Categories: stable code, optional hierarchy, status.
    ALTER TABLE catalog.categories
      ADD COLUMN code TEXT,
      ADD COLUMN parent_id UUID REFERENCES catalog.categories(id),
      ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      ADD COLUMN data_classification TEXT NOT NULL DEFAULT 'DEMO' CHECK (data_classification IN ('DEMO','VALIDATED')),
      ADD COLUMN created_by UUID;
    UPDATE catalog.categories SET code = 'CAT-' || left(md5(id::text), 8) WHERE code IS NULL;
    ALTER TABLE catalog.categories ALTER COLUMN code SET NOT NULL;
    CREATE UNIQUE INDEX categories_code_uidx ON catalog.categories (code);

    -- Canonical product (commodity) identity.
    -- default_uom_id relaxed: not all products use stems (Master v2.0 §UOM).
    ALTER TABLE catalog.commodities ALTER COLUMN default_uom_id DROP NOT NULL;
    ALTER TABLE catalog.commodities
      ADD COLUMN botanical_name TEXT,
      ADD COLUMN common_name TEXT,
      ADD COLUMN commercial_name TEXT,
      ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      ADD COLUMN data_classification TEXT NOT NULL DEFAULT 'DEMO' CHECK (data_classification IN ('DEMO','VALIDATED')),
      ADD COLUMN seasonality JSONB,
      ADD COLUMN launch_cities TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN launch_enabled BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN substitution_defaults JSONB,
      ADD COLUMN created_by UUID,
      ADD COLUMN approved_by UUID;
    CREATE INDEX commodities_fts_idx ON catalog.commodities
      USING gin (to_tsvector('english', coalesce(name,'') || ' ' || coalesce(common_name,'') || ' ' ||
                             coalesce(commercial_name,'') || ' ' || coalesce(botanical_name,'')));

    -- Canonical aliases: market-name synonyms resolve to ONE product; no duplicate commodities.
    CREATE TABLE catalog.product_aliases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      commodity_id UUID NOT NULL REFERENCES catalog.commodities(id),
      alias TEXT NOT NULL,
      alias_type TEXT NOT NULL CHECK (alias_type IN ('BOTANICAL','COMMON','COMMERCIAL','SYNONYM')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX product_aliases_active_uidx
      ON catalog.product_aliases (lower(alias)) WHERE status = 'ACTIVE';

    CREATE TABLE catalog.colours (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      hex TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE catalog.varieties
      ADD COLUMN colour_id UUID REFERENCES catalog.colours(id),
      ADD COLUMN product_form TEXT,
      ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      ADD COLUMN data_classification TEXT NOT NULL DEFAULT 'DEMO' CHECK (data_classification IN ('DEMO','VALIDATED')),
      ADD COLUMN commercial_use TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN stem_length_cm_min NUMERIC(6,2) CHECK (stem_length_cm_min IS NULL OR stem_length_cm_min >= 0),
      ADD COLUMN stem_length_cm_max NUMERIC(6,2) CHECK (stem_length_cm_max IS NULL OR stem_length_cm_max >= 0),
      ADD COLUMN created_by UUID,
      ADD COLUMN stem_length_check BOOLEAN GENERATED ALWAYS AS
        (stem_length_cm_min IS NULL OR stem_length_cm_max IS NULL OR stem_length_cm_min <= stem_length_cm_max) STORED;
    ALTER TABLE catalog.varieties ADD CONSTRAINT varieties_stem_len_ck CHECK (stem_length_check);

    -- Gradable attribute dictionary (drives declarative grade rules).
    CREATE TABLE catalog.quality_attributes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      data_type TEXT NOT NULL CHECK (data_type IN ('NUMERIC','INTEGER','ENUM','BOOLEAN','TEXT')),
      uom_id UUID REFERENCES catalog.units_of_measure(id),
      allowed_values TEXT[],
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Defect taxonomy (configuration for later QC/claims; no transactional QC here).
    CREATE TABLE catalog.defect_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      defect_class TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Versioned declarative grade profiles. Historical versions resolve forever.
    CREATE TABLE catalog.grade_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      commodity_id UUID NOT NULL REFERENCES catalog.commodities(id),
      grade_code TEXT NOT NULL,
      version_no INT NOT NULL CHECK (version_no >= 1),
      rules JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
      effective_from TIMESTAMPTZ NOT NULL,
      effective_to TIMESTAMPTZ,
      change_reason TEXT,
      created_by UUID NOT NULL,
      approved_by UUID,
      data_classification TEXT NOT NULL DEFAULT 'DEMO' CHECK (data_classification IN ('DEMO','VALIDATED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (commodity_id, grade_code, version_no),
      CHECK (effective_to IS NULL OR effective_to > effective_from)
    );

    -- Versioned pack/bunch/carton definitions (nestable).
    CREATE TABLE catalog.pack_definitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      commodity_id UUID REFERENCES catalog.commodities(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('UNIT','BUNCH','PACK','BOX','CARTON')),
      contains_qty NUMERIC(14,3) NOT NULL CHECK (contains_qty > 0),
      contains_uom_id UUID NOT NULL REFERENCES catalog.units_of_measure(id),
      parent_pack_id UUID REFERENCES catalog.pack_definitions(id),
      version_no INT NOT NULL CHECK (version_no >= 1),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
      effective_from TIMESTAMPTZ NOT NULL,
      effective_to TIMESTAMPTZ,
      change_reason TEXT,
      created_by UUID NOT NULL,
      approved_by UUID,
      data_classification TEXT NOT NULL DEFAULT 'DEMO' CHECK (data_classification IN ('DEMO','VALIDATED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (effective_to IS NULL OR effective_to > effective_from)
    );
    CREATE UNIQUE INDEX pack_definitions_uidx ON catalog.pack_definitions
      (code, COALESCE(commodity_id, '00000000-0000-0000-0000-000000000000'::uuid), version_no);

    -- Versioned, product/pack-scoped unit conversions. Never a hidden global assumption.
    CREATE TABLE catalog.unit_conversions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      commodity_id UUID REFERENCES catalog.commodities(id),
      pack_definition_id UUID REFERENCES catalog.pack_definitions(id),
      from_uom_id UUID NOT NULL REFERENCES catalog.units_of_measure(id),
      to_uom_id UUID NOT NULL REFERENCES catalog.units_of_measure(id),
      factor NUMERIC(18,6) NOT NULL CHECK (factor > 0),
      version_no INT NOT NULL CHECK (version_no >= 1),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
      effective_from TIMESTAMPTZ NOT NULL,
      effective_to TIMESTAMPTZ,
      change_reason TEXT,
      created_by UUID NOT NULL,
      approved_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (from_uom_id <> to_uom_id),
      CHECK (effective_to IS NULL OR effective_to > effective_from)
    );
    CREATE UNIQUE INDEX unit_conversions_uidx ON catalog.unit_conversions
      (COALESCE(commodity_id, '00000000-0000-0000-0000-000000000000'::uuid), from_uom_id, to_uom_id, version_no);

    -- Canonical handling profiles (standards). Excursion SEVERITY policy remains in
    -- logistics.handling_profiles (ADR-002); this table holds requirement ranges.
    CREATE TABLE catalog.handling_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      commodity_id UUID REFERENCES catalog.commodities(id),
      code TEXT NOT NULL,
      version_no INT NOT NULL CHECK (version_no >= 1),
      temp_min_c NUMERIC(5,2),
      temp_max_c NUMERIC(5,2),
      humidity_min_pct NUMERIC(5,2) CHECK (humidity_min_pct IS NULL OR (humidity_min_pct >= 0 AND humidity_min_pct <= 100)),
      humidity_max_pct NUMERIC(5,2) CHECK (humidity_max_pct IS NULL OR (humidity_max_pct >= 0 AND humidity_max_pct <= 100)),
      light_sensitivity TEXT CHECK (light_sensitivity IS NULL OR light_sensitivity IN ('LOW','MEDIUM','HIGH')),
      ethylene_sensitivity TEXT CHECK (ethylene_sensitivity IS NULL OR ethylene_sensitivity IN ('NONE','LOW','MEDIUM','HIGH')),
      hydration_note TEXT,
      max_holding_hours INT CHECK (max_holding_hours IS NULL OR max_holding_hours >= 0),
      precooling_required BOOLEAN,
      packaging_requirements TEXT,
      orientation_fragility_notes TEXT,
      transport_restrictions TEXT,
      handling_group_code TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
      effective_from TIMESTAMPTZ NOT NULL,
      effective_to TIMESTAMPTZ,
      change_reason TEXT,
      created_by UUID NOT NULL,
      approved_by UUID,
      data_classification TEXT NOT NULL DEFAULT 'DEMO' CHECK (data_classification IN ('DEMO','VALIDATED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (temp_min_c IS NULL OR temp_max_c IS NULL OR temp_min_c <= temp_max_c),
      CHECK (humidity_min_pct IS NULL OR humidity_max_pct IS NULL OR humidity_min_pct <= humidity_max_pct),
      CHECK ((temp_min_c IS NULL) = (temp_max_c IS NULL)),
      CHECK ((humidity_min_pct IS NULL) = (humidity_max_pct IS NULL)),
      CHECK (effective_to IS NULL OR effective_to > effective_from)
    );
    CREATE UNIQUE INDEX handling_profiles_uidx ON catalog.handling_profiles
      (code, COALESCE(commodity_id, '00000000-0000-0000-0000-000000000000'::uuid), version_no);

    -- Transport compatibility metadata (foundation only; no shipment blocking in Build 2).
    CREATE TABLE catalog.transport_compatibility_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_a_id UUID NOT NULL REFERENCES catalog.handling_profiles(id),
      profile_b_id UUID NOT NULL REFERENCES catalog.handling_profiles(id),
      compatible BOOLEAN NOT NULL,
      reason TEXT,
      version_no INT NOT NULL CHECK (version_no >= 1),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
      effective_from TIMESTAMPTZ NOT NULL,
      effective_to TIMESTAMPTZ,
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (profile_a_id <> profile_b_id),
      CHECK (effective_to IS NULL OR effective_to > effective_from)
    );
    CREATE UNIQUE INDEX transport_rules_uidx ON catalog.transport_compatibility_rules
      (LEAST(profile_a_id::text, profile_b_id::text), GREATEST(profile_a_id::text, profile_b_id::text), version_no);

    -- Product media metadata architecture (media bytes via core.media_objects signed access).
    CREATE TABLE catalog.product_media (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      commodity_id UUID REFERENCES catalog.commodities(id),
      variety_id UUID REFERENCES catalog.varieties(id),
      media_object_id UUID NOT NULL,
      kind TEXT NOT NULL DEFAULT 'GALLERY' CHECK (kind IN ('PRIMARY','GALLERY','SPEC_SHEET')),
      alt_text TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (commodity_id IS NOT NULL OR variety_id IS NOT NULL)
    );

    -- Supplier-product capability (supplier-owned; object-level authz by org).
    CREATE TABLE catalog.supplier_product_capabilities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      variety_id UUID NOT NULL REFERENCES catalog.varieties(id),
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (org_id, variety_id)
    );

    ALTER TABLE catalog.units_of_measure
      ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
      ADD COLUMN data_classification TEXT NOT NULL DEFAULT 'VALIDATED' CHECK (data_classification IN ('DEMO','VALIDATED')),
      ADD COLUMN created_by UUID;

    -- Permissions + role wiring.
    INSERT INTO identity.permissions (code, description) VALUES
      ('catalog.read','Read canonical catalog'),
      ('catalog.write','Administer canonical catalog master data'),
      ('catalog.capability.write','Manage own-org supplier product capabilities')
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO identity.roles (org_id, name, is_system, mfa_required)
    SELECT NULL, 'CATALOG_MANAGER', true, false
    WHERE NOT EXISTS (SELECT 1 FROM identity.roles WHERE name = 'CATALOG_MANAGER' AND org_id IS NULL);

    INSERT INTO identity.role_permissions (role_id, permission_id)
    SELECT ro.id, pe.id FROM identity.roles ro, identity.permissions pe
    WHERE ro.org_id IS NULL AND pe.code = ANY (CASE ro.name
      WHEN 'PLATFORM_ADMIN' THEN ARRAY['catalog.read','catalog.write','catalog.capability.write']
      WHEN 'CATALOG_MANAGER' THEN ARRAY['catalog.read','catalog.write']
      WHEN 'ORG_ADMIN' THEN ARRAY['catalog.read','catalog.capability.write']
      WHEN 'MEMBER' THEN ARRAY['catalog.read']
      ELSE ARRAY[]::text[] END)
    ON CONFLICT DO NOTHING;
  `);
};

exports.down = async (client) => {
  await client.query(`
    DELETE FROM identity.user_roles WHERE role_id IN
      (SELECT id FROM identity.roles WHERE name = 'CATALOG_MANAGER' AND org_id IS NULL);
    DELETE FROM identity.role_permissions WHERE permission_id IN
      (SELECT id FROM identity.permissions WHERE code IN ('catalog.read','catalog.write','catalog.capability.write'));
    DELETE FROM identity.roles WHERE name = 'CATALOG_MANAGER' AND org_id IS NULL;
    DELETE FROM identity.permissions WHERE code IN ('catalog.read','catalog.write','catalog.capability.write');
    DROP TABLE IF EXISTS catalog.supplier_product_capabilities, catalog.product_media,
      catalog.transport_compatibility_rules, catalog.handling_profiles, catalog.unit_conversions,
      catalog.pack_definitions, catalog.grade_profiles, catalog.defect_types,
      catalog.quality_attributes, catalog.product_aliases, catalog.colours CASCADE;
    ALTER TABLE catalog.units_of_measure DROP COLUMN status, DROP COLUMN data_classification, DROP COLUMN created_by;
    ALTER TABLE catalog.varieties DROP CONSTRAINT varieties_stem_len_ck;
    ALTER TABLE catalog.varieties
      DROP COLUMN stem_length_check, DROP COLUMN colour_id, DROP COLUMN product_form, DROP COLUMN status,
      DROP COLUMN data_classification, DROP COLUMN commercial_use, DROP COLUMN stem_length_cm_min,
      DROP COLUMN stem_length_cm_max, DROP COLUMN created_by;
    ALTER TABLE catalog.commodities
      DROP COLUMN botanical_name, DROP COLUMN common_name, DROP COLUMN commercial_name, DROP COLUMN status,
      DROP COLUMN data_classification, DROP COLUMN seasonality, DROP COLUMN launch_cities,
      DROP COLUMN launch_enabled, DROP COLUMN substitution_defaults, DROP COLUMN created_by, DROP COLUMN approved_by;
    UPDATE catalog.commodities SET default_uom_id = (SELECT id FROM catalog.units_of_measure LIMIT 1)
      WHERE default_uom_id IS NULL AND EXISTS (SELECT 1 FROM catalog.units_of_measure);
    DELETE FROM catalog.commodities WHERE default_uom_id IS NULL;
    ALTER TABLE catalog.commodities ALTER COLUMN default_uom_id SET NOT NULL;
    ALTER TABLE catalog.categories
      DROP COLUMN code, DROP COLUMN parent_id, DROP COLUMN status, DROP COLUMN data_classification, DROP COLUMN created_by;
  `);
};
