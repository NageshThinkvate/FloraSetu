// 012 — Build 4: Pilot Fulfilment Core.
// Extends the frozen Build-0 tables (ordering/supply/quality/logistics/payments/claims)
// with the pilot columns and activates the Master state machines. No destructive edits:
// columns are additive; status CHECKs are widened to the Master-defined sets; Build-4
// rows are purged before restoring legacy constraints on down-migration.
// Money in minor units. Quantities numeric with non-negative CHECKs; balance invariants
// (reserved <= available, allocated <= QC-accepted, packed <= allocated,
// dispatched <= packed, delivered <= dispatched) are enforced in service transactions
// under row locks (ADR-001), with CHECKs as backstop.
exports.up = async (client) => {
  await client.query(`
    -- ============ ORDERING: award -> order conversion, multi-supplier allocations
    ALTER TABLE ordering.orders DROP CONSTRAINT orders_status_check;
    ALTER TABLE ordering.orders DROP CONSTRAINT orders_source_type_check;
    ALTER TABLE ordering.orders ADD CONSTRAINT orders_source_type_check
      CHECK (source_type IN ('RFQ','AUCTION','DIRECT','AWARD'));
    ALTER TABLE ordering.orders ADD CONSTRAINT orders_status_check CHECK (status IN
      ('DRAFT','PENDING_CONFIRMATION','CONFIRMED','ALLOCATING','SUPPLY_CONFIRMED','QC_PACK',
       'READY_FOR_DISPATCH','DISPATCHED','DELIVERED','ACCEPTANCE_PENDING','ACCEPTED',
       'CLAIM_OPEN','SETTLED','CLOSED','CANCELLED',
       'CREATED','ALLOCATED','FULFILLED','INVOICED'));
    ALTER TABLE ordering.orders
      ADD COLUMN requirement_id UUID,
      ADD COLUMN award_id UUID,
      ADD COLUMN delivery_destination TEXT,
      ADD COLUMN accepted_qty NUMERIC(14,3) CHECK (accepted_qty IS NULL OR accepted_qty >= 0),
      ADD COLUMN disputed_qty NUMERIC(14,3) CHECK (disputed_qty IS NULL OR disputed_qty >= 0),
      ADD COLUMN accepted_at TIMESTAMPTZ,
      ADD COLUMN accepted_by UUID,
      ADD COLUMN cancel_reason TEXT,
      ADD COLUMN closed_at TIMESTAMPTZ;
    -- One order per award (idempotent conversion, §2/§30).
    CREATE UNIQUE INDEX orders_one_per_award ON ordering.orders (award_id)
      WHERE award_id IS NOT NULL AND deleted_at IS NULL;

    ALTER TABLE ordering.order_lines
      ALTER COLUMN variety_id DROP NOT NULL,
      ADD COLUMN requirement_line_id UUID,
      ADD COLUMN award_line_id UUID,
      ADD COLUMN uom_id UUID,
      ADD COLUMN spec_snapshot JSONB;
    ALTER TABLE ordering.order_status_history ADD COLUMN reason TEXT;

    -- Supplier-level obligations inside one buyer order (§4).
    CREATE TABLE ordering.supplier_allocations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      order_id UUID NOT NULL REFERENCES ordering.orders(id),
      supplier_org_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION' CHECK (status IN
        ('PENDING_CONFIRMATION','CONFIRMED','IN_FULFILMENT','QC_PACK','READY_FOR_DISPATCH',
         'DISPATCHED','DELIVERED','SETTLED','CANCELLED')),
      delivery_commitment TEXT,
      commercial_snapshot JSONB NOT NULL DEFAULT '{}',
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX supplier_allocations_order_idx ON ordering.supplier_allocations (order_id);
    CREATE INDEX supplier_allocations_supplier_idx ON ordering.supplier_allocations (supplier_org_id, status);

    CREATE TABLE ordering.supplier_allocation_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      allocation_id UUID NOT NULL REFERENCES ordering.supplier_allocations(id),
      order_line_id UUID NOT NULL REFERENCES ordering.order_lines(id),
      quotation_version_id UUID NOT NULL,
      awarded_qty NUMERIC(14,3) NOT NULL CHECK (awarded_qty > 0),
      uom_id UUID NOT NULL,
      unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
      currency CHAR(3) NOT NULL DEFAULT 'INR',
      accepted_spec JSONB,
      fulfilment_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (fulfilment_status IN
        ('OPEN','LOT_CONFIRMED','ALLOCATED','PACKED','DISPATCHED','DELIVERED','SHORT','CANCELLED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX supplier_allocation_lines_alloc_idx ON ordering.supplier_allocation_lines (allocation_id);

    -- Lot-level allocation rows (frozen table) gain reservation + fulfilment state.
    ALTER TABLE ordering.allocations
      ADD COLUMN supplier_allocation_line_id UUID REFERENCES ordering.supplier_allocation_lines(id),
      ADD COLUMN reservation_id UUID,
      ADD COLUMN uom_id UUID,
      ADD COLUMN status TEXT NOT NULL DEFAULT 'ALLOCATED' CHECK (status IN
        ('ALLOCATED','PACKED','DISPATCHED','DELIVERED','RELEASED')),
      ADD COLUMN created_by UUID;

    -- ============ SUPPLY: physical lots (harvest flow + wholesaler stock entry)
    ALTER TABLE supply.supply_lots DROP CONSTRAINT supply_lots_status_check;
    ALTER TABLE supply.supply_lots ADD CONSTRAINT supply_lots_status_check CHECK (status IN
      ('FORECAST','EXPECTED','HARVESTED','STOCK_RECEIVED','QC_PENDING','APPROVED','HOLD',
       'REJECTED','AVAILABLE','RESERVED','PACKED','DISPATCHED','DELIVERED','CONSUMED',
       'CLOSED','WITHDRAWN','DRAFT','ACTIVE','DEPLETED','EXPIRED'));
    ALTER TABLE supply.supply_lots
      ADD COLUMN commodity_id UUID,
      ADD COLUMN colour_code TEXT,
      ADD COLUMN grade_profile_id UUID,
      ADD COLUMN origin_type TEXT CHECK (origin_type IS NULL OR origin_type IN
        ('OWN_FARM','PARTNER_FARM','WHOLESALE_STOCK','IMPORTER_STOCK','MARKET_PURCHASE','OTHER_APPROVED_SOURCE')),
      ADD COLUMN origin_detail TEXT,
      ADD COLUMN source_flow TEXT CHECK (source_flow IS NULL OR source_flow IN ('HARVEST_FLOW','STOCK_ENTRY')),
      ADD COLUMN harvest_at TIMESTAMPTZ,
      ADD COLUMN received_at TIMESTAMPTZ,
      ADD COLUMN declared_qty NUMERIC(14,3) CHECK (declared_qty IS NULL OR declared_qty >= 0),
      ADD COLUMN qc_submitted_qty NUMERIC(14,3) CHECK (qc_submitted_qty IS NULL OR qc_submitted_qty >= 0),
      ADD COLUMN qc_accepted_qty NUMERIC(14,3) CHECK (qc_accepted_qty IS NULL OR qc_accepted_qty >= 0),
      ADD COLUMN qc_rejected_qty NUMERIC(14,3) CHECK (qc_rejected_qty IS NULL OR qc_rejected_qty >= 0),
      ADD COLUMN qc_held_qty NUMERIC(14,3) CHECK (qc_held_qty IS NULL OR qc_held_qty >= 0),
      ADD COLUMN packed_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (packed_qty >= 0),
      ADD COLUMN dispatched_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (dispatched_qty >= 0),
      ADD COLUMN delivered_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (delivered_qty >= 0),
      ADD COLUMN handling_profile_id UUID,
      ADD COLUMN handling_profile_version_no INT,
      ADD COLUMN created_by UUID;
    ALTER TABLE supply.supply_lots ALTER COLUMN status SET DEFAULT 'STOCK_RECEIVED';
    -- Lots are commodity-level; variety stays optional (matches LotCoreDto).
    ALTER TABLE supply.supply_lots ALTER COLUMN variety_id DROP NOT NULL;

    CREATE TABLE supply.harvest_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      commodity_id UUID NOT NULL,
      variety_id UUID,
      qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
      uom_id UUID NOT NULL,
      harvested_at TIMESTAMPTZ NOT NULL,
      farm_name TEXT,
      farm_block TEXT,
      notes TEXT,
      lot_id UUID,
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX harvest_records_org_idx ON supply.harvest_records (org_id);

    CREATE TABLE supply.lot_media (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lot_id UUID NOT NULL REFERENCES supply.supply_lots(id),
      media_object_id UUID NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'LOT_PHOTO' CHECK (purpose IN
        ('LOT_PHOTO','INSPECTION','PACKING','POD','CLAIM_EVIDENCE','OTHER')),
      inspection_id UUID,
      uploaded_by UUID NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX lot_media_lot_idx ON supply.lot_media (lot_id);

    ALTER TABLE supply.inventory_reservations
      ADD COLUMN order_id UUID,
      ADD COLUMN supplier_allocation_line_id UUID,
      ADD COLUMN uom_id UUID,
      ADD COLUMN created_by UUID,
      ADD COLUMN released_at TIMESTAMPTZ,
      ADD COLUMN release_reason TEXT;

    -- ============ QUALITY: inspections against versioned grade profiles (§10–12)
    ALTER TABLE quality.qc_inspections
      ADD COLUMN org_id UUID,               -- inspector organization
      ADD COLUMN supplier_org_id UUID,      -- lot owner (conflict control)
      ADD COLUMN inspection_scope TEXT CHECK (inspection_scope IS NULL OR inspection_scope IN ('SAMPLE','FULL')),
      ADD COLUMN status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','COMPLETED')),
      ADD COLUMN uom_id UUID,
      ADD COLUMN submitted_qty NUMERIC(14,3) CHECK (submitted_qty IS NULL OR submitted_qty >= 0),
      ADD COLUMN accepted_qty NUMERIC(14,3) CHECK (accepted_qty IS NULL OR accepted_qty >= 0),
      ADD COLUMN rejected_qty NUMERIC(14,3) CHECK (rejected_qty IS NULL OR rejected_qty >= 0),
      ADD COLUMN held_qty NUMERIC(14,3) CHECK (held_qty IS NULL OR held_qty >= 0),
      ADD COLUMN conflict_flag BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN conflict_override_by UUID,
      ADD COLUMN notes TEXT,
      ADD COLUMN completed_at TIMESTAMPTZ;

    ALTER TABLE quality.qc_results
      ADD COLUMN grade_profile_id UUID,
      ADD COLUMN grade_profile_version_no INT;

    CREATE TABLE quality.inspection_defects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inspection_id UUID NOT NULL REFERENCES quality.qc_inspections(id),
      defect_type_id UUID,
      qty NUMERIC(14,3) CHECK (qty IS NULL OR qty >= 0),
      severity TEXT CHECK (severity IS NULL OR severity IN ('MINOR','MAJOR','CRITICAL')),
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE quality.custody_events
      ADD COLUMN actor_user_id UUID,
      ADD COLUMN order_id UUID,
      ADD COLUMN shipment_id UUID,
      ADD COLUMN location_text TEXT,
      ADD COLUMN condition_note TEXT,
      ADD COLUMN temperature_c NUMERIC(5,2),
      ADD COLUMN media_object_id UUID;
    ALTER TABLE quality.custody_events DROP CONSTRAINT custody_events_event_type_check;
    ALTER TABLE quality.custody_events ADD CONSTRAINT custody_events_event_type_check CHECK (event_type IN
      ('DISPATCH','RECEIPT','TRANSFER','SUPPLIER_POSSESSION','QC_HANDOFF','PACKED',
       'CARRIER_HANDOFF','DESTINATION_RECEIPT','BUYER_RECEIPT'));
    -- Append-only: custody events are never edited or deleted (§16).
    CREATE RULE custody_events_no_update AS ON UPDATE TO quality.custody_events DO INSTEAD NOTHING;
    CREATE RULE custody_events_no_delete AS ON DELETE TO quality.custody_events DO INSTEAD NOTHING;

    -- ============ LOGISTICS: packing, manual transport record, POD (§15–18)
    CREATE TABLE logistics.pack_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      order_id UUID NOT NULL,
      lot_id UUID NOT NULL,
      supplier_allocation_line_id UUID,
      pack_type TEXT,
      bunch_count INT CHECK (bunch_count IS NULL OR bunch_count >= 0),
      carton_count INT CHECK (carton_count IS NULL OR carton_count >= 0),
      packed_qty NUMERIC(14,3) NOT NULL CHECK (packed_qty > 0),
      uom_id UUID NOT NULL,
      label_ref TEXT,
      seal_ref TEXT,
      storage_condition_note TEXT,
      packed_by UUID NOT NULL,
      packed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX pack_records_order_idx ON logistics.pack_records (order_id);
    CREATE INDEX pack_records_lot_idx ON logistics.pack_records (lot_id);

    ALTER TABLE logistics.shipments
      ADD COLUMN supplier_org_id UUID,
      ADD COLUMN mode TEXT CHECK (mode IS NULL OR mode IN
        ('BUS_PARCEL','RAIL_PARCEL','AIR_CARGO','NORMAL_ROAD','INSULATED_ROAD','REEFER_ROAD',
         'LOCAL_PICKUP','SPECIAL_EXPRESS')),
      ADD COLUMN carrier_name TEXT,
      ADD COLUMN origin_text TEXT,
      ADD COLUMN destination_text TEXT,
      ADD COLUMN origin_terminal TEXT,
      ADD COLUMN destination_terminal TEXT,
      ADD COLUMN transport_ref TEXT,          -- bus/train/flight/vehicle reference
      ADD COLUMN parcel_awb_ref TEXT,
      ADD COLUMN package_count INT CHECK (package_count IS NULL OR package_count >= 0),
      ADD COLUMN pickup_at TIMESTAMPTZ,
      ADD COLUMN etd TIMESTAMPTZ,
      ADD COLUMN eta TIMESTAMPTZ,
      ADD COLUMN actual_arrival_at TIMESTAMPTZ,
      ADD COLUMN last_mile_detail TEXT,
      ADD COLUMN temp_controlled BOOLEAN,     -- explicit YES/NO; never inferred (§17)
      ADD COLUMN exception_note TEXT,
      ADD COLUMN dispatched_at TIMESTAMPTZ,
      ADD COLUMN dispatched_by UUID;

    CREATE TABLE logistics.pod_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_id UUID NOT NULL UNIQUE REFERENCES logistics.shipments(id),  -- one POD per shipment (idempotent)
      order_id UUID NOT NULL,
      delivered_qty NUMERIC(14,3) NOT NULL CHECK (delivered_qty >= 0),
      uom_id UUID,
      receiver_name TEXT,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      media_object_id UUID,
      signature_ref TEXT,
      notes TEXT,
      shortage_flag BOOLEAN NOT NULL DEFAULT false,
      damage_flag BOOLEAN NOT NULL DEFAULT false,
      exception_note TEXT,
      recorded_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE logistics.temperature_excursion_events
      ALTER COLUMN shipment_leg_id DROP NOT NULL,
      ADD COLUMN shipment_id UUID,
      ADD COLUMN manual BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN reported_by UUID;
    -- Manual excursion reports may not know duration (§21): allow 0 = unknown.
    ALTER TABLE logistics.temperature_excursion_events DROP CONSTRAINT temperature_excursion_events_duration_seconds_check;
    ALTER TABLE logistics.temperature_excursion_events ADD CONSTRAINT temperature_excursion_events_duration_seconds_check CHECK (duration_seconds >= 0);
    -- Pilot severity vocabulary (ReportTemperatureExceptionDto) uses WARNING/CRITICAL.
    ALTER TABLE logistics.temperature_excursion_events DROP CONSTRAINT temperature_excursion_events_severity_check;
    ALTER TABLE logistics.temperature_excursion_events ADD CONSTRAINT temperature_excursion_events_severity_check
      CHECK (severity IN ('LOW','MEDIUM','HIGH','WARNING','CRITICAL'));
    -- Build 0 froze payments.settlements with a blanket no-update trigger; Build 4 adds the
    -- RECORDED->VERIFIED->COMPLETED lifecycle. COMPLETED-row immutability (ADR-003) stays
    -- enforced by settlements_no_update_completed -> payments.settlement_immutable().
    DROP TRIGGER IF EXISTS settlements_immutable ON payments.settlements;

    -- ============ PAYMENTS: manual external payment + manual settlement (§22–23)
    ALTER TABLE payments.payments DROP CONSTRAINT payments_status_check;
    ALTER TABLE payments.payments ADD CONSTRAINT payments_status_check CHECK (status IN
      ('INITIATED','CAPTURED','FAILED','REFUNDED','RECORDED','VERIFIED','DISPUTED'));
    ALTER TABLE payments.payments
      ADD COLUMN record_kind TEXT NOT NULL DEFAULT 'GATEWAY' CHECK (record_kind IN ('GATEWAY','EXTERNAL')),
      ADD COLUMN order_id UUID,
      ADD COLUMN buyer_org_id UUID,
      ADD COLUMN method TEXT CHECK (method IS NULL OR method IN
        ('BANK_TRANSFER','UPI','NEFT','RTGS','IMPS','OTHER_APPROVED_EXTERNAL')),
      ADD COLUMN external_ref TEXT,           -- UTR / reference
      ADD COLUMN paid_at TIMESTAMPTZ,
      ADD COLUMN evidence_media_id UUID,
      ADD COLUMN recorded_by UUID,
      ADD COLUMN verified_by UUID,
      ADD COLUMN verified_at TIMESTAMPTZ;
    ALTER TABLE payments.payments ALTER COLUMN invoice_id DROP NOT NULL;

    ALTER TABLE payments.settlements
      ADD COLUMN status TEXT NOT NULL DEFAULT 'RECORDED' CHECK (status IN
        ('RECORDED','VERIFIED','COMPLETED','CANCELLED')),
      ADD COLUMN version INT NOT NULL DEFAULT 1,
      ADD COLUMN gross_minor BIGINT CHECK (gross_minor IS NULL OR gross_minor >= 0),
      ADD COLUMN deductions JSONB NOT NULL DEFAULT '[]',
      ADD COLUMN claim_adjustment_minor BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN net_minor BIGINT,
      ADD COLUMN payout_ref TEXT,
      ADD COLUMN payout_date TIMESTAMPTZ,
      ADD COLUMN recorded_by UUID,
      ADD COLUMN verified_by UUID,
      ADD COLUMN verified_at TIMESTAMPTZ,
      ADD COLUMN completed_at TIMESTAMPTZ,
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    -- ADR-003 + Build 1 invariant merge: the only permitted UPDATE is the exact lifecycle step
    -- RECORDED->VERIFIED->COMPLETED, and money/party/reference fields may never change during it.
    -- Legacy rows and COMPLETED rows are fully immutable; corrections are new adjustment rows.
    CREATE OR REPLACE FUNCTION payments.settlement_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF (OLD.status = 'RECORDED' AND NEW.status = 'VERIFIED')
         OR (OLD.status = 'VERIFIED' AND NEW.status = 'COMPLETED') THEN
        IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
           OR NEW.currency IS DISTINCT FROM OLD.currency
           OR NEW.org_id IS DISTINCT FROM OLD.org_id
           OR NEW.ref IS DISTINCT FROM OLD.ref
           OR NEW.gross_minor IS DISTINCT FROM OLD.gross_minor
           OR NEW.net_minor IS DISTINCT FROM OLD.net_minor
           OR NEW.deductions IS DISTINCT FROM OLD.deductions
           OR NEW.claim_adjustment_minor IS DISTINCT FROM OLD.claim_adjustment_minor
           OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
           OR NEW.order_id IS DISTINCT FROM OLD.order_id THEN
          RAISE EXCEPTION 'immutable record: settlement money fields cannot change (ADR-003)';
        END IF;
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'immutable record: settlements rows are immutable outside the RECORDED->VERIFIED->COMPLETED lifecycle (ADR-003)';
    END;
    $fn$;
    CREATE TRIGGER settlements_no_update_completed BEFORE UPDATE ON payments.settlements
      FOR EACH ROW EXECUTE FUNCTION payments.settlement_immutable();
    CREATE RULE settlements_no_delete AS ON DELETE TO payments.settlements DO INSTEAD NOTHING;

    -- ============ CLAIMS: structured pilot claim (§20)
    ALTER TABLE claims.claims DROP CONSTRAINT claims_status_check;
    ALTER TABLE claims.claims ADD CONSTRAINT claims_status_check CHECK (status IN
      ('DRAFT','SUBMITTED','EVIDENCE_VALIDATION','COUNTERPARTY_RESPONSE','UNDER_REVIEW',
       'PROPOSED_RESOLUTION','APPROVED','FINANCIAL_ADJUSTMENT','REPLACEMENT','CLOSED','REJECTED',
       'OPENED','DECIDED'));
    ALTER TABLE claims.claims
      ADD COLUMN category TEXT CHECK (category IS NULL OR category IN
        ('QUALITY_MISMATCH','GRADE_MISMATCH','SHORT_QUANTITY','DAMAGED','WRONG_PRODUCT',
         'LATE_DELIVERY','TEMPERATURE_EXCEPTION','OTHER')),
      ADD COLUMN buyer_org_id UUID,
      ADD COLUMN supplier_org_id UUID,
      ADD COLUMN lot_id UUID,
      ADD COLUMN inspection_id UUID,
      ADD COLUMN pod_id UUID,
      ADD COLUMN disputed_qty NUMERIC(14,3) CHECK (disputed_qty IS NULL OR disputed_qty >= 0),
      ADD COLUMN uom_id UUID,
      ADD COLUMN submitted_by UUID,
      ADD COLUMN counterparty_response TEXT,
      ADD COLUMN response_at TIMESTAMPTZ,
      ADD COLUMN resolution_note TEXT;
    ALTER TABLE claims.claim_evidences
      ADD COLUMN lot_id UUID,
      ADD COLUMN inspection_id UUID,
      ADD COLUMN pod_id UUID;

    -- ============ PERMISSIONS + ROLES (§29)
    INSERT INTO identity.permissions (code, description) VALUES
      ('order.read','Read orders'), ('order.manage','Manage order lifecycle'),
      ('lot.read','Read supply lots'), ('lot.write','Create/update supply lots and media'),
      ('inventory.reserve','Reserve lot quantity'), ('inventory.allocate','Allocate lots to orders'),
      ('qc.read','Read inspections'), ('qc.inspect','Perform QC inspections'),
      ('pack.manage','Record packing'), ('dispatch.manage','Record transport/dispatch'),
      ('delivery.accept','Buyer delivery acceptance'),
      ('claim.create','Raise claims'), ('claim.manage','Operations claim management'),
      ('payment.record','Record external payments'), ('payment.verify','Verify external payments'),
      ('settlement.record','Record supplier settlements'), ('settlement.verify','Verify/complete settlements')
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO identity.roles (org_id, name, is_system, mfa_required)
    SELECT NULL, 'QC_AGENT', true, false
    WHERE NOT EXISTS (SELECT 1 FROM identity.roles WHERE name = 'QC_AGENT' AND org_id IS NULL);
    INSERT INTO identity.roles (org_id, name, is_system, mfa_required)
    SELECT NULL, 'FINANCE_OPS', true, false
    WHERE NOT EXISTS (SELECT 1 FROM identity.roles WHERE name = 'FINANCE_OPS' AND org_id IS NULL);

    INSERT INTO identity.role_permissions (role_id, permission_id)
    SELECT ro.id, pe.id FROM identity.roles ro, identity.permissions pe
    WHERE ro.org_id IS NULL AND pe.code = ANY (CASE ro.name
      WHEN 'PLATFORM_ADMIN' THEN ARRAY['order.read','order.manage','lot.read','lot.write',
        'inventory.reserve','inventory.allocate','qc.read','qc.inspect','pack.manage','dispatch.manage',
        'delivery.accept','claim.create','claim.manage','payment.record','payment.verify',
        'settlement.record','settlement.verify']
      WHEN 'PROCUREMENT_OPS' THEN ARRAY['order.read','order.manage','lot.read','inventory.reserve',
        'inventory.allocate','qc.read','pack.manage','dispatch.manage','claim.manage','claim.create']
      WHEN 'QC_AGENT' THEN ARRAY['qc.read','qc.inspect','lot.read']
      WHEN 'FINANCE_OPS' THEN ARRAY['payment.record','payment.verify','settlement.record',
        'settlement.verify','order.read']
      WHEN 'ORG_ADMIN' THEN ARRAY['order.read','order.manage','lot.read','lot.write','inventory.reserve',
        'inventory.allocate','qc.read','pack.manage','dispatch.manage','delivery.accept','claim.create']
      WHEN 'MEMBER' THEN ARRAY['order.read','lot.read','qc.read']
      ELSE ARRAY[]::text[] END)
    ON CONFLICT DO NOTHING;
  `);
};

exports.down = async (client) => {
  await client.query(`
    DELETE FROM identity.role_permissions WHERE permission_id IN
      (SELECT id FROM identity.permissions WHERE code IN
        ('order.read','order.manage','lot.read','lot.write','inventory.reserve','inventory.allocate',
         'qc.read','qc.inspect','pack.manage','dispatch.manage','delivery.accept','claim.create',
         'claim.manage','payment.record','payment.verify','settlement.record','settlement.verify'));
    DELETE FROM identity.role_permissions WHERE role_id IN
      (SELECT id FROM identity.roles WHERE name IN ('QC_AGENT','FINANCE_OPS') AND org_id IS NULL);
    DELETE FROM identity.user_roles WHERE role_id IN
      (SELECT id FROM identity.roles WHERE name IN ('QC_AGENT','FINANCE_OPS') AND org_id IS NULL);
    DELETE FROM identity.roles WHERE name IN ('QC_AGENT','FINANCE_OPS') AND org_id IS NULL;
    DELETE FROM identity.permissions WHERE code IN
      ('order.read','order.manage','lot.read','lot.write','inventory.reserve','inventory.allocate',
       'qc.read','qc.inspect','pack.manage','dispatch.manage','delivery.accept','claim.create',
       'claim.manage','payment.record','payment.verify','settlement.record','settlement.verify');

    DROP TABLE IF EXISTS claims.claim_evidences_force; -- no-op guard
    ALTER TABLE claims.claim_evidences DROP COLUMN lot_id, DROP COLUMN inspection_id, DROP COLUMN pod_id;
    ALTER TABLE claims.claims
      DROP COLUMN category, DROP COLUMN buyer_org_id, DROP COLUMN supplier_org_id,
      DROP COLUMN lot_id, DROP COLUMN inspection_id, DROP COLUMN pod_id,
      DROP COLUMN disputed_qty, DROP COLUMN uom_id, DROP COLUMN submitted_by,
      DROP COLUMN counterparty_response, DROP COLUMN response_at, DROP COLUMN resolution_note;
    DELETE FROM payments.financial_adjustments WHERE claim_id IN
      (SELECT id FROM claims.claims WHERE status IN
        ('DRAFT','SUBMITTED','EVIDENCE_VALIDATION','COUNTERPARTY_RESPONSE','PROPOSED_RESOLUTION',
         'APPROVED','FINANCIAL_ADJUSTMENT','REPLACEMENT','REJECTED'))
      OR settlement_id IN
      (SELECT id FROM payments.settlements WHERE status IN ('RECORDED','VERIFIED','COMPLETED','CANCELLED'));
    DROP TRIGGER IF EXISTS claim_decisions_immutable ON claims.claim_decisions;
    DELETE FROM claims.claim_decisions WHERE claim_id IN
      (SELECT id FROM claims.claims WHERE status IN
        ('DRAFT','SUBMITTED','EVIDENCE_VALIDATION','COUNTERPARTY_RESPONSE','PROPOSED_RESOLUTION',
         'APPROVED','FINANCIAL_ADJUSTMENT','REPLACEMENT','REJECTED'));
    DELETE FROM claims.claim_evidences WHERE claim_id IN
      (SELECT id FROM claims.claims WHERE status IN
        ('DRAFT','SUBMITTED','EVIDENCE_VALIDATION','COUNTERPARTY_RESPONSE','PROPOSED_RESOLUTION',
         'APPROVED','FINANCIAL_ADJUSTMENT','REPLACEMENT','REJECTED'));
    DELETE FROM claims.claims WHERE status IN
      ('DRAFT','SUBMITTED','EVIDENCE_VALIDATION','COUNTERPARTY_RESPONSE','PROPOSED_RESOLUTION',
       'APPROVED','FINANCIAL_ADJUSTMENT','REPLACEMENT','REJECTED');
    CREATE TRIGGER claim_decisions_immutable BEFORE UPDATE OR DELETE ON claims.claim_decisions
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();
    ALTER TABLE claims.claims DROP CONSTRAINT claims_status_check;
    ALTER TABLE claims.claims ADD CONSTRAINT claims_status_check
      CHECK (status IN ('OPENED','UNDER_REVIEW','DECIDED','CLOSED'));

    DROP TRIGGER IF EXISTS settlements_no_update_completed ON payments.settlements;
    DROP RULE IF EXISTS settlements_no_delete ON payments.settlements;
    DROP FUNCTION IF EXISTS payments.settlement_immutable();
    DELETE FROM payments.settlements WHERE status IN ('RECORDED','VERIFIED','COMPLETED','CANCELLED');
    ALTER TABLE payments.settlements
      DROP COLUMN status, DROP COLUMN version, DROP COLUMN gross_minor, DROP COLUMN deductions,
      DROP COLUMN claim_adjustment_minor, DROP COLUMN net_minor, DROP COLUMN payout_ref,
      DROP COLUMN payout_date, DROP COLUMN recorded_by, DROP COLUMN verified_by,
      DROP COLUMN verified_at, DROP COLUMN completed_at, DROP COLUMN updated_at;
    DELETE FROM payments.payments WHERE record_kind = 'EXTERNAL' OR status IN ('RECORDED','VERIFIED','DISPUTED');
    ALTER TABLE payments.payments
      DROP COLUMN record_kind, DROP COLUMN order_id, DROP COLUMN buyer_org_id, DROP COLUMN method,
      DROP COLUMN external_ref, DROP COLUMN paid_at, DROP COLUMN evidence_media_id,
      DROP COLUMN recorded_by, DROP COLUMN verified_by, DROP COLUMN verified_at;
    ALTER TABLE payments.payments ALTER COLUMN invoice_id SET NOT NULL;
    ALTER TABLE payments.payments DROP CONSTRAINT payments_status_check;
    ALTER TABLE payments.payments ADD CONSTRAINT payments_status_check
      CHECK (status IN ('INITIATED','CAPTURED','FAILED','REFUNDED'));

    ALTER TABLE logistics.temperature_excursion_events
      DROP COLUMN shipment_id, DROP COLUMN manual, DROP COLUMN reported_by;
    DROP TRIGGER IF EXISTS excursion_immutable ON logistics.temperature_excursion_events;
    DELETE FROM logistics.shipment_exceptions WHERE excursion_event_id IN
      (SELECT id FROM logistics.temperature_excursion_events WHERE duration_seconds = 0 OR severity = 'WARNING');
    DELETE FROM logistics.temperature_excursion_events WHERE duration_seconds = 0;
    ALTER TABLE logistics.temperature_excursion_events DROP CONSTRAINT temperature_excursion_events_duration_seconds_check;
    ALTER TABLE logistics.temperature_excursion_events ADD CONSTRAINT temperature_excursion_events_duration_seconds_check CHECK (duration_seconds > 0);
    DELETE FROM logistics.temperature_excursion_events WHERE severity = 'WARNING';
    ALTER TABLE logistics.temperature_excursion_events DROP CONSTRAINT temperature_excursion_events_severity_check;
    ALTER TABLE logistics.temperature_excursion_events ADD CONSTRAINT temperature_excursion_events_severity_check
      CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL'));
    CREATE TRIGGER excursion_immutable BEFORE UPDATE OR DELETE ON logistics.temperature_excursion_events
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();
    ALTER TABLE logistics.temperature_excursion_events ALTER COLUMN shipment_leg_id SET NOT NULL;
    CREATE TRIGGER settlements_immutable BEFORE UPDATE ON payments.settlements
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();
    DROP TABLE IF EXISTS logistics.pod_records;
    ALTER TABLE logistics.shipments
      DROP COLUMN supplier_org_id, DROP COLUMN mode, DROP COLUMN carrier_name,
      DROP COLUMN origin_text, DROP COLUMN destination_text, DROP COLUMN origin_terminal,
      DROP COLUMN destination_terminal, DROP COLUMN transport_ref, DROP COLUMN parcel_awb_ref,
      DROP COLUMN package_count, DROP COLUMN pickup_at, DROP COLUMN etd, DROP COLUMN eta,
      DROP COLUMN actual_arrival_at, DROP COLUMN last_mile_detail, DROP COLUMN temp_controlled,
      DROP COLUMN exception_note, DROP COLUMN dispatched_at, DROP COLUMN dispatched_by;
    DROP TABLE IF EXISTS logistics.pack_records;

    DROP RULE IF EXISTS custody_events_no_update ON quality.custody_events;
    DROP RULE IF EXISTS custody_events_no_delete ON quality.custody_events;
    DROP TRIGGER IF EXISTS custody_immutable ON quality.custody_events;
    DELETE FROM quality.custody_events WHERE event_type IN
      ('SUPPLIER_POSSESSION','QC_HANDOFF','PACKED','CARRIER_HANDOFF','DESTINATION_RECEIPT','BUYER_RECEIPT');
    ALTER TABLE quality.custody_events DROP CONSTRAINT custody_events_event_type_check;
    ALTER TABLE quality.custody_events ADD CONSTRAINT custody_events_event_type_check
      CHECK (event_type IN ('DISPATCH','RECEIPT','TRANSFER'));
    ALTER TABLE quality.custody_events
      DROP COLUMN actor_user_id, DROP COLUMN order_id, DROP COLUMN shipment_id,
      DROP COLUMN location_text, DROP COLUMN condition_note, DROP COLUMN temperature_c,
      DROP COLUMN media_object_id;
    CREATE TRIGGER custody_immutable BEFORE UPDATE OR DELETE ON quality.custody_events
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();
    DROP TABLE IF EXISTS quality.inspection_defects;
    ALTER TABLE quality.qc_results DROP COLUMN grade_profile_id, DROP COLUMN grade_profile_version_no;
    ALTER TABLE quality.qc_inspections
      DROP COLUMN org_id, DROP COLUMN supplier_org_id, DROP COLUMN inspection_scope,
      DROP COLUMN status, DROP COLUMN uom_id, DROP COLUMN submitted_qty, DROP COLUMN accepted_qty,
      DROP COLUMN rejected_qty, DROP COLUMN held_qty, DROP COLUMN conflict_flag,
      DROP COLUMN conflict_override_by, DROP COLUMN notes, DROP COLUMN completed_at;

    ALTER TABLE supply.inventory_reservations
      DROP COLUMN order_id, DROP COLUMN supplier_allocation_line_id, DROP COLUMN uom_id,
      DROP COLUMN created_by, DROP COLUMN released_at, DROP COLUMN release_reason;
    DROP TABLE IF EXISTS supply.lot_media;
    DROP TABLE IF EXISTS supply.harvest_records;
    DELETE FROM ordering.allocations WHERE status IN ('ALLOCATED','PACKED','DISPATCHED','DELIVERED','RELEASED');
    DELETE FROM supply.inventory_reservations WHERE lot_id IN
      (SELECT id FROM supply.supply_lots WHERE status IN
        ('FORECAST','EXPECTED','HARVESTED','STOCK_RECEIVED','QC_PENDING','APPROVED','HOLD','REJECTED',
         'AVAILABLE','RESERVED','PACKED','DISPATCHED','DELIVERED','CONSUMED'));
    DELETE FROM supply.supply_lots WHERE status IN
      ('FORECAST','EXPECTED','HARVESTED','STOCK_RECEIVED','QC_PENDING','APPROVED','HOLD','REJECTED',
       'AVAILABLE','RESERVED','PACKED','DISPATCHED','DELIVERED','CONSUMED');
    UPDATE supply.supply_lots SET variety_id = '00000000-0000-0000-0000-000000000000' WHERE variety_id IS NULL;
    ALTER TABLE supply.supply_lots ALTER COLUMN variety_id SET NOT NULL;
    ALTER TABLE supply.supply_lots
      DROP COLUMN commodity_id, DROP COLUMN colour_code, DROP COLUMN grade_profile_id,
      DROP COLUMN origin_type, DROP COLUMN origin_detail, DROP COLUMN source_flow,
      DROP COLUMN harvest_at, DROP COLUMN received_at, DROP COLUMN declared_qty,
      DROP COLUMN qc_submitted_qty, DROP COLUMN qc_accepted_qty, DROP COLUMN qc_rejected_qty,
      DROP COLUMN qc_held_qty, DROP COLUMN packed_qty, DROP COLUMN dispatched_qty,
      DROP COLUMN delivered_qty, DROP COLUMN handling_profile_id,
      DROP COLUMN handling_profile_version_no, DROP COLUMN created_by;
    ALTER TABLE supply.supply_lots DROP CONSTRAINT supply_lots_status_check;
    ALTER TABLE supply.supply_lots ADD CONSTRAINT supply_lots_status_check
      CHECK (status IN ('DRAFT','ACTIVE','DEPLETED','WITHDRAWN','EXPIRED'));
    ALTER TABLE supply.supply_lots ALTER COLUMN status SET DEFAULT 'DRAFT';

    DELETE FROM ordering.allocations WHERE status IN ('ALLOCATED','PACKED','DISPATCHED','DELIVERED','RELEASED');
    ALTER TABLE ordering.allocations
      DROP COLUMN supplier_allocation_line_id, DROP COLUMN reservation_id, DROP COLUMN uom_id,
      DROP COLUMN status, DROP COLUMN created_by;
    DROP TABLE IF EXISTS ordering.supplier_allocation_lines;
    DROP TABLE IF EXISTS ordering.supplier_allocations;
    ALTER TABLE ordering.order_status_history DROP COLUMN reason;
    ALTER TABLE ordering.order_lines
      DROP COLUMN requirement_line_id, DROP COLUMN award_line_id, DROP COLUMN uom_id,
      DROP COLUMN spec_snapshot;
    UPDATE ordering.order_lines SET variety_id = '00000000-0000-0000-0000-000000000000' WHERE variety_id IS NULL;
    ALTER TABLE ordering.order_lines ALTER COLUMN variety_id SET NOT NULL;
    DROP INDEX IF EXISTS ordering.orders_one_per_award;
    DROP TRIGGER IF EXISTS order_history_immutable ON ordering.order_status_history;
    DELETE FROM ordering.order_status_history WHERE order_id IN
      (SELECT id FROM ordering.orders WHERE status IN
        ('DRAFT','PENDING_CONFIRMATION','ALLOCATING','SUPPLY_CONFIRMED','QC_PACK',
         'READY_FOR_DISPATCH','DISPATCHED','DELIVERED','ACCEPTANCE_PENDING','ACCEPTED',
         'CLAIM_OPEN','SETTLED') OR source_type = 'AWARD');
    DELETE FROM ordering.order_lines WHERE order_id IN
      (SELECT id FROM ordering.orders WHERE status IN
        ('DRAFT','PENDING_CONFIRMATION','ALLOCATING','SUPPLY_CONFIRMED','QC_PACK',
         'READY_FOR_DISPATCH','DISPATCHED','DELIVERED','ACCEPTANCE_PENDING','ACCEPTED',
         'CLAIM_OPEN','SETTLED') OR source_type = 'AWARD');
    DELETE FROM ordering.orders WHERE status IN
      ('DRAFT','PENDING_CONFIRMATION','ALLOCATING','SUPPLY_CONFIRMED','QC_PACK',
       'READY_FOR_DISPATCH','DISPATCHED','DELIVERED','ACCEPTANCE_PENDING','ACCEPTED',
       'CLAIM_OPEN','SETTLED');
    ALTER TABLE ordering.orders
      DROP COLUMN requirement_id, DROP COLUMN award_id, DROP COLUMN delivery_destination,
      DROP COLUMN accepted_qty, DROP COLUMN disputed_qty, DROP COLUMN accepted_at,
      DROP COLUMN accepted_by, DROP COLUMN cancel_reason, DROP COLUMN closed_at;
    ALTER TABLE ordering.orders DROP CONSTRAINT orders_status_check;
    ALTER TABLE ordering.orders ADD CONSTRAINT orders_status_check
      CHECK (status IN ('CREATED','CONFIRMED','ALLOCATED','FULFILLED','INVOICED','CLOSED','CANCELLED'));
    DELETE FROM ordering.orders WHERE source_type = 'AWARD';
    ALTER TABLE ordering.orders DROP CONSTRAINT orders_source_type_check;
    ALTER TABLE ordering.orders ADD CONSTRAINT orders_source_type_check
      CHECK (source_type IN ('RFQ','AUCTION','DIRECT'));
    CREATE TRIGGER order_history_immutable BEFORE UPDATE OR DELETE ON ordering.order_status_history
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();
  `);
};
