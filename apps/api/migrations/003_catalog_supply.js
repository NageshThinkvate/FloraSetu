// 003 — catalog-standards + supply-inventory (docs/05 CS/SI; ADR-001)
exports.up = async (client) => {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS catalog;
    CREATE SCHEMA IF NOT EXISTS supply;

    CREATE TABLE catalog.units_of_measure (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      base_code TEXT,
      conversion_factor NUMERIC(18,6) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0)
    );

    CREATE TABLE catalog.categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE catalog.commodities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      category_id UUID NOT NULL REFERENCES catalog.categories(id),
      name TEXT NOT NULL,
      default_uom_id UUID NOT NULL REFERENCES catalog.units_of_measure(id),
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE catalog.varieties (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      commodity_id UUID NOT NULL REFERENCES catalog.commodities(id),
      name TEXT NOT NULL,
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    -- Versioned effective-dated grade standards.
    CREATE TABLE catalog.grade_standards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      commodity_id UUID NOT NULL REFERENCES catalog.commodities(id),
      grade_code TEXT NOT NULL,
      version_no INT NOT NULL CHECK (version_no >= 1),
      criteria JSONB NOT NULL DEFAULT '{}',
      valid_from TIMESTAMPTZ NOT NULL,
      valid_to TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (commodity_id, grade_code, version_no),
      CHECK (valid_to IS NULL OR valid_to > valid_from)
    );

    CREATE TABLE catalog.pack_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      capacity_qty NUMERIC(14,3) NOT NULL CHECK (capacity_qty > 0),
      uom_id UUID NOT NULL REFERENCES catalog.units_of_measure(id)
    );

    CREATE TABLE supply.terminals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      geog GEOGRAPHY(Point, 4326) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE supply.warehouses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      terminal_id UUID REFERENCES supply.terminals(id),
      name TEXT NOT NULL,
      cold_storage BOOLEAN NOT NULL DEFAULT false,
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    -- ADR-001: DB-enforced available/reserved/allocated; never oversell.
    CREATE TABLE supply.supply_lots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      variety_id UUID NOT NULL,
      warehouse_id UUID,
      available_qty NUMERIC(14,3) NOT NULL CHECK (available_qty >= 0),
      reserved_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
      allocated_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (allocated_qty >= 0),
      uom_id UUID NOT NULL,
      allow_partial_fill BOOLEAN NOT NULL DEFAULT false,
      minimum_acceptable_quantity NUMERIC(14,3),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','DEPLETED','WITHDRAWN','EXPIRED')),
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      CHECK (reserved_qty + allocated_qty <= available_qty),
      CHECK (allow_partial_fill = false OR minimum_acceptable_quantity IS NOT NULL)
    );

    CREATE TABLE supply.inventory_reservations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lot_id UUID NOT NULL REFERENCES supply.supply_lots(id),
      org_id UUID NOT NULL,
      owner_ref TEXT NOT NULL,
      qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
      status TEXT NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD','COMMITTED','RELEASED','CONSUMED')),
      expires_at TIMESTAMPTZ,
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ADR-001: forecast reduction preserves committed reservations.
    CREATE TABLE supply.availability_forecasts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lot_id UUID NOT NULL REFERENCES supply.supply_lots(id),
      forecast_date DATE NOT NULL,
      expected_qty NUMERIC(14,3) NOT NULL CHECK (expected_qty >= 0),
      committed_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (committed_qty >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (lot_id, forecast_date)
    );

    CREATE TABLE supply.supply_risk_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lot_id UUID NOT NULL REFERENCES supply.supply_lots(id),
      org_id UUID NOT NULL,
      shortfall_qty NUMERIC(14,3) NOT NULL CHECK (shortfall_qty > 0),
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = async (client) => {
  await client.query('DROP SCHEMA IF EXISTS supply CASCADE; DROP SCHEMA IF EXISTS catalog CASCADE');
};
