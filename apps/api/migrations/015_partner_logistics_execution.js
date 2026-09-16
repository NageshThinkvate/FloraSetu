// 015 — Phase 5 (ADR-012): independent logistics partner execution boundary.
// Additive only: append-only execution events, driver assignment history, vehicle/arrival
// milestone columns, structured POD evidence fields, partner execution permissions.
exports.up = async (client) => {
  await client.query(`
    -- 1. Shipment execution additions. Materialized milestone columns are read-optimized
    --    projections; logistics.execution_events is the authoritative history.
    ALTER TABLE logistics.shipments
      ADD COLUMN vehicle_ref TEXT,
      ADD COLUMN handling_note TEXT,
      ADD COLUMN arrived_pickup_at TIMESTAMPTZ,
      ADD COLUMN arrived_delivery_at TIMESTAMPTZ;

    -- 2. Structured POD evidence: documentary reference + signature photo/file
    --    (media object reference — never raw binaries in the database).
    ALTER TABLE logistics.pod_records
      ADD COLUMN pod_ref TEXT,
      ADD COLUMN signature_media_object_id UUID;

    -- 3. Append-only logistics execution events (audit-grade, server timestamps).
    CREATE TABLE logistics.execution_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      seq BIGINT GENERATED ALWAYS AS IDENTITY,
      shipment_id UUID NOT NULL REFERENCES logistics.shipments(id),
      org_id UUID NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN
        ('DRIVER_ASSIGNED','DRIVER_REASSIGNED','DRIVER_UNASSIGNED','JOB_ACCEPTED',
         'ARRIVED_AT_PICKUP','PICKUP_CONFIRMED','IN_TRANSIT','ARRIVED_AT_DELIVERY',
         'DELIVERY_CONFIRMED','POD_SUBMITTED','EXCEPTION_REPORTED','EXCEPTION_RESOLVED')),
      actor_user_id UUID,
      actor_org_id UUID,
      metadata JSONB NOT NULL DEFAULT '{}',
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX execution_events_shipment_idx ON logistics.execution_events (shipment_id, created_at);
    CREATE TRIGGER execution_events_immutable BEFORE UPDATE OR DELETE ON logistics.execution_events
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();
    -- One-time milestones: mobile retries / double-submits collapse to one logical event.
    CREATE UNIQUE INDEX execution_events_once_uidx ON logistics.execution_events (shipment_id, event_type)
      WHERE event_type IN ('JOB_ACCEPTED','ARRIVED_AT_PICKUP','PICKUP_CONFIRMED','IN_TRANSIT',
        'ARRIVED_AT_DELIVERY','DELIVERY_CONFIRMED','POD_SUBMITTED');

    -- 4. Driver assignment history — never overwritten (ADR-012 §7 audit rule).
    CREATE TABLE logistics.driver_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_id UUID NOT NULL REFERENCES logistics.shipments(id),
      org_id UUID NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('ASSIGNED','REASSIGNED','UNASSIGNED')),
      previous_driver_user_id UUID,
      driver_user_id UUID,
      vehicle_ref TEXT,
      reason TEXT,
      actor_user_id UUID NOT NULL,
      actor_org_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX driver_assignments_shipment_idx ON logistics.driver_assignments (shipment_id, created_at);
    CREATE TRIGGER driver_assignments_immutable BEFORE UPDATE OR DELETE ON logistics.driver_assignments
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    -- 5. Partner-side execution permissions. Granted to ORG_ADMIN only: partner managers
    --    execute org-wide; drivers execute via job assignment (no permission needed).
    --    PROCUREMENT_OPS / PLATFORM_ADMIN deliberately receive NEITHER (ADR-012).
    INSERT INTO identity.permissions (code, description) VALUES
      ('logistics.execute','Execute own-organization logistics jobs (milestones, POD, exceptions)'),
      ('logistics.assign_driver','Assign/reassign own-organization drivers on logistics jobs')
    ON CONFLICT (code) DO NOTHING;
    INSERT INTO identity.role_permissions (role_id, permission_id)
    SELECT ro.id, pe.id FROM identity.roles ro, identity.permissions pe
    WHERE ro.org_id IS NULL AND ro.name = 'ORG_ADMIN'
      AND pe.code IN ('logistics.execute','logistics.assign_driver')
    ON CONFLICT DO NOTHING;
  `);
};

exports.down = async (client) => {
  await client.query(`
    DELETE FROM identity.role_permissions WHERE permission_id IN
      (SELECT id FROM identity.permissions WHERE code IN ('logistics.execute','logistics.assign_driver'));
    DELETE FROM identity.permissions WHERE code IN ('logistics.execute','logistics.assign_driver');
    DROP TABLE IF EXISTS logistics.driver_assignments;
    DROP TABLE IF EXISTS logistics.execution_events;
    ALTER TABLE logistics.pod_records
      DROP COLUMN IF EXISTS pod_ref,
      DROP COLUMN IF EXISTS signature_media_object_id;
    ALTER TABLE logistics.shipments
      DROP COLUMN IF EXISTS vehicle_ref,
      DROP COLUMN IF EXISTS handling_note,
      DROP COLUMN IF EXISTS arrived_pickup_at,
      DROP COLUMN IF EXISTS arrived_delivery_at;
  `);
};
