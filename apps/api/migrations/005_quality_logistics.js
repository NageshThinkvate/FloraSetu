// 005 — quality-traceability + logistics-coldchain (docs/05 QT/LC; ADR-002)
exports.up = async (client) => {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS quality;
    CREATE SCHEMA IF NOT EXISTS logistics;

    CREATE TABLE quality.qc_inspections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      lot_id UUID NOT NULL,
      inspector_user_id UUID,
      inspected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE quality.qc_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inspection_id UUID NOT NULL REFERENCES quality.qc_inspections(id),
      grade_standard_id UUID NOT NULL,
      passed BOOLEAN NOT NULL,
      measurements JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TRIGGER qc_results_immutable BEFORE UPDATE OR DELETE ON quality.qc_results
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    CREATE TABLE quality.certificates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inspection_id UUID NOT NULL REFERENCES quality.qc_inspections(id),
      media_object_id UUID NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE quality.traceability_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_lot_id UUID NOT NULL,
      child_lot_id UUID NOT NULL,
      link_type TEXT NOT NULL CHECK (link_type IN ('SPLIT','MERGE','REPACK')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (parent_lot_id, child_lot_id, link_type)
    );
    CREATE TRIGGER traceability_immutable BEFORE UPDATE OR DELETE ON quality.traceability_links
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    CREATE TABLE quality.custody_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lot_id UUID NOT NULL,
      from_org_id UUID,
      to_org_id UUID NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('DISPATCH','RECEIPT','TRANSFER')),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TRIGGER custody_immutable BEFORE UPDATE OR DELETE ON quality.custody_events
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    CREATE TABLE logistics.routes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      path GEOGRAPHY(LineString, 4326),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE logistics.shipments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      order_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN
        ('PLANNED','IN_TRANSIT','DELIVERED','ACCEPTED','ACCEPTED_WITH_EXCEPTION')),
      acceptance_hold BOOLEAN NOT NULL DEFAULT false,
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE logistics.shipment_legs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_id UUID NOT NULL REFERENCES logistics.shipments(id),
      route_id UUID REFERENCES logistics.routes(id),
      sequence INT NOT NULL CHECK (sequence >= 1),
      departed_at TIMESTAMPTZ,
      arrived_at TIMESTAMPTZ,
      UNIQUE (shipment_id, sequence)
    );

    CREATE TABLE logistics.temperature_readings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_leg_id UUID NOT NULL REFERENCES logistics.shipment_legs(id),
      device_ref TEXT NOT NULL,
      celsius NUMERIC(5,2) NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ADR-002: immutable excursion events; severity via versioned handling profile at occurred_at.
    CREATE TABLE logistics.temperature_excursion_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_leg_id UUID NOT NULL REFERENCES logistics.shipment_legs(id),
      handling_profile_id UUID,
      severity TEXT NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
      celsius NUMERIC(5,2) NOT NULL,
      duration_seconds INT NOT NULL CHECK (duration_seconds > 0),
      occurred_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TRIGGER excursion_immutable BEFORE UPDATE OR DELETE ON logistics.temperature_excursion_events
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    CREATE TABLE logistics.shipment_exceptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_id UUID NOT NULL REFERENCES logistics.shipments(id),
      excursion_event_id UUID REFERENCES logistics.temperature_excursion_events(id),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN
        ('OPEN','PENDING_REVIEW','RESOLVED_HOLD_RELEASED','RESOLVED_ESCALATED')),
      blocks_buyer_acceptance BOOLEAN NOT NULL DEFAULT false,
      blocks_supplier_settlement BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE logistics.handling_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      commodity_ref TEXT NOT NULL,
      version_no INT NOT NULL CHECK (version_no >= 1),
      thresholds JSONB NOT NULL,
      valid_from TIMESTAMPTZ NOT NULL,
      valid_to TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (commodity_ref, version_no),
      CHECK (valid_to IS NULL OR valid_to > valid_from)
    );
  `);
};

exports.down = async (client) => {
  await client.query('DROP SCHEMA IF EXISTS logistics CASCADE; DROP SCHEMA IF EXISTS quality CASCADE');
};
