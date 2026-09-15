// 014 — Pre-Phase-3 correction gate (ADR-011): supplier-declaration quality model,
// lot/video evidence, logistics partner jobs, receipt evidence, logistics exceptions.
exports.up = async (client) => {
  await client.query(`
    -- 1. Orthogonal quality basis (physical state stays in status; basis is separate).
    ALTER TABLE supply.supply_lots
      ADD COLUMN quality_basis TEXT NOT NULL DEFAULT 'SUPPLIER_DECLARATION'
        CHECK (quality_basis IN ('SUPPLIER_DECLARATION','THIRD_PARTY_INSPECTION')),
      ADD COLUMN declared_stem_length_cm NUMERIC(6,1),
      ADD COLUMN bloom_stage TEXT,
      ADD COLUMN batch_ref TEXT,
      ADD COLUMN declaration_notes TEXT,
      ADD COLUMN declared_at TIMESTAMPTZ;

    -- 2. Extended evidence purposes (supplier actual-lot, video, logistics, receipt).
    ALTER TABLE supply.lot_media DROP CONSTRAINT IF EXISTS lot_media_purpose_check;
    ALTER TABLE supply.lot_media ADD CONSTRAINT lot_media_purpose_check CHECK (purpose IN
      ('LOT_PHOTO','LOT_ACTUAL','LOT_VIDEO','INSPECTION','PACKING','PACKED_LOT','POD',
       'DISPATCH_EVIDENCE','RECEIPT_EVIDENCE','PICKUP_EVIDENCE','CLAIM_EVIDENCE',
       'EXCEPTION_EVIDENCE','OTHER'));

    -- 3. Logistics partner assignment (driver optional — non-driver modes supported).
    ALTER TABLE logistics.shipments
      ADD COLUMN logistics_org_id UUID,
      ADD COLUMN driver_user_id UUID,
      ADD COLUMN assigned_at TIMESTAMPTZ,
      ADD COLUMN job_accepted_at TIMESTAMPTZ;
    CREATE INDEX shipments_logistics_org_idx ON logistics.shipments (logistics_org_id);
    CREATE INDEX shipments_driver_idx ON logistics.shipments (driver_user_id);

    -- 4. Shipment-level evidence (pickup / delivery / exception), distinct from lot evidence.
    CREATE TABLE logistics.shipment_media (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_id UUID NOT NULL REFERENCES logistics.shipments(id),
      media_object_id UUID NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN
        ('PICKUP_EVIDENCE','DELIVERY_PHOTO','POD','EXCEPTION_EVIDENCE','PARCEL_RECEIPT')),
      uploaded_by UUID NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX shipment_media_shipment_idx ON logistics.shipment_media (shipment_id);

    -- 5. Partner/driver-reported logistics exceptions — reuse the existing shipment_exceptions
    -- table (005) with additive partner-report columns; they feed Operations and never
    -- auto-decide buyer claims (blocks_* stay false for partner reports).
    ALTER TABLE logistics.shipment_exceptions
      ADD COLUMN org_id UUID,
      ADD COLUMN type TEXT,
      ADD COLUMN note TEXT,
      ADD COLUMN media_object_id UUID,
      ADD COLUMN reported_by UUID;
    ALTER TABLE logistics.shipment_exceptions DROP CONSTRAINT IF EXISTS shipment_exceptions_status_check;
    ALTER TABLE logistics.shipment_exceptions ADD CONSTRAINT shipment_exceptions_status_check
      CHECK (status IN ('OPEN','PENDING_REVIEW','RESOLVED','RESOLVED_HOLD_RELEASED','RESOLVED_ESCALATED'));
    CREATE INDEX shipment_exceptions_open_idx ON logistics.shipment_exceptions (status, created_at);

    -- 6. Buyer receipt/claim evidence at order level.
    CREATE TABLE ordering.order_media (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES ordering.orders(id),
      org_id UUID NOT NULL,
      media_object_id UUID NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN ('RECEIPT_EVIDENCE','CLAIM_EVIDENCE')),
      uploaded_by UUID NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX order_media_order_idx ON ordering.order_media (order_id);

    -- 7. Pilot configuration (effective-dated flag + pilot settings).
    INSERT INTO core.feature_flags (key, enabled, valid_from)
      VALUES ('INDEPENDENT_INSPECTION_ENABLED', false, now());
    CREATE TABLE core.pilot_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO core.pilot_settings (key, value) VALUES ('LOT_EVIDENCE_MIN_PHOTOS', '2');

    -- 8. Logistics partner orgs get the partner-workspace capability (UX-ADR-001).
    UPDATE identity.organizations SET capabilities = ARRAY['PARTNER_LOGISTICS']
      WHERE type IN ('LOGISTICS_PROVIDER','COLD_CHAIN_PARTNER') AND capabilities = '{}';
  `);
};

exports.down = async (client) => {
  await client.query(`
    -- Purge rows that use 014-only enum/column values before restoring narrower checks.
    DELETE FROM logistics.shipment_exceptions WHERE reported_by IS NOT NULL OR status = 'RESOLVED';
    DELETE FROM supply.lot_media WHERE purpose IN
      ('LOT_ACTUAL','LOT_VIDEO','PACKED_LOT','DISPATCH_EVIDENCE','RECEIPT_EVIDENCE','PICKUP_EVIDENCE','EXCEPTION_EVIDENCE');
    UPDATE identity.organizations SET capabilities = '{}'
      WHERE type IN ('LOGISTICS_PROVIDER','COLD_CHAIN_PARTNER') AND capabilities = ARRAY['PARTNER_LOGISTICS'];
    DELETE FROM core.feature_flags WHERE key = 'INDEPENDENT_INSPECTION_ENABLED';
    DROP TABLE IF EXISTS core.pilot_settings;
    DROP TABLE IF EXISTS ordering.order_media;
    ALTER TABLE logistics.shipment_exceptions
      DROP COLUMN IF EXISTS org_id,
      DROP COLUMN IF EXISTS type,
      DROP COLUMN IF EXISTS note,
      DROP COLUMN IF EXISTS media_object_id,
      DROP COLUMN IF EXISTS reported_by;
    ALTER TABLE logistics.shipment_exceptions DROP CONSTRAINT IF EXISTS shipment_exceptions_status_check;
    ALTER TABLE logistics.shipment_exceptions ADD CONSTRAINT shipment_exceptions_status_check
      CHECK (status IN ('OPEN','PENDING_REVIEW','RESOLVED_HOLD_RELEASED','RESOLVED_ESCALATED'));
    DROP TABLE IF EXISTS logistics.shipment_media;
    ALTER TABLE logistics.shipments
      DROP COLUMN IF EXISTS logistics_org_id,
      DROP COLUMN IF EXISTS driver_user_id,
      DROP COLUMN IF EXISTS assigned_at,
      DROP COLUMN IF EXISTS job_accepted_at;
    ALTER TABLE supply.lot_media DROP CONSTRAINT IF EXISTS lot_media_purpose_check;
    ALTER TABLE supply.lot_media ADD CONSTRAINT lot_media_purpose_check CHECK (purpose IN
      ('LOT_PHOTO','INSPECTION','PACKING','POD','CLAIM_EVIDENCE','OTHER'));
    ALTER TABLE supply.supply_lots
      DROP COLUMN IF EXISTS quality_basis,
      DROP COLUMN IF EXISTS declared_stem_length_cm,
      DROP COLUMN IF EXISTS bloom_stage,
      DROP COLUMN IF EXISTS batch_ref,
      DROP COLUMN IF EXISTS declaration_notes,
      DROP COLUMN IF EXISTS declared_at;
  `);
};
