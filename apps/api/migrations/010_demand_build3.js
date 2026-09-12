// 010 — Build 3: Demand / Events / RFQ / Quotations / Evaluation / Award.
// Single canonical domain model (QUICK/EVENT/FORMAL all converge here — no parallel
// lightweight model). Money in minor units. Public refs via core.reference_counters.
exports.up = async (client) => {
  await client.query(`
    -- ============ EVENT DOMAIN (first-class; ceremonies user-defined, never hardcoded)
    CREATE TABLE demand.events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PLANNING','CONFIRMED','COMPLETED','CANCELLED')),
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      venue_name TEXT,
      venue_address TEXT,
      contact_name TEXT,
      contact_phone TEXT,
      notes TEXT,
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
    );
    CREATE INDEX events_org_idx ON demand.events (org_id, status);

    CREATE TABLE demand.event_ceremonies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES demand.events(id),
      name TEXT NOT NULL,
      starts_at TIMESTAMPTZ,
      venue_name TEXT,
      notes TEXT,
      sort_order INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX event_ceremonies_event_idx ON demand.event_ceremonies (event_id);

    CREATE TABLE demand.event_bom_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID NOT NULL REFERENCES demand.events(id),
      ceremony_id UUID REFERENCES demand.event_ceremonies(id),
      commodity_id UUID NOT NULL,
      variety_id UUID,
      quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
      uom_id UUID NOT NULL,
      needed_at TIMESTAMPTZ,
      delivery_milestone TEXT,
      sourcing_status TEXT NOT NULL DEFAULT 'PLANNED'
        CHECK (sourcing_status IN ('PLANNED','SOURCING','PARTIALLY_COVERED','COVERED')),
      requirement_line_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX bom_event_idx ON demand.event_bom_lines (event_id);

    -- ============ REQUIREMENT DOMAIN (canonical buyer demand — singular)
    CREATE TABLE demand.requirements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      event_id UUID REFERENCES demand.events(id),
      mode TEXT NOT NULL CHECK (mode IN ('QUICK','EVENT','FORMAL')),
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN
        ('DRAFT','SUBMITTED','SOURCING','QUOTING','CLARIFICATION','EVALUATION',
         'AWARDED','PARTIALLY_AWARDED','CONVERTED','CLOSED','CANCELLED')),
      current_version_no INT NOT NULL DEFAULT 1,
      assistance_requested BOOLEAN NOT NULL DEFAULT false,
      cancelled_by UUID,
      cancelled_at TIMESTAMPTZ,
      cancel_reason TEXT,
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX requirements_org_idx ON demand.requirements (org_id, status);
    CREATE INDEX requirements_status_idx ON demand.requirements (status) WHERE status NOT IN ('CLOSED','CANCELLED');

    CREATE TABLE demand.requirement_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      requirement_id UUID NOT NULL REFERENCES demand.requirements(id),
      version_no INT NOT NULL,
      change_reason TEXT,
      changed_by UUID NOT NULL,
      consent_required BOOLEAN NOT NULL DEFAULT false,
      consented_by UUID,
      consented_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (requirement_id, version_no)
    );

    -- Requirement lines preserve the full commercial snapshot (master refs + denormalized view).
    CREATE TABLE demand.requirement_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      requirement_id UUID NOT NULL REFERENCES demand.requirements(id),
      requirement_version_id UUID NOT NULL REFERENCES demand.requirement_versions(id),
      bom_line_id UUID REFERENCES demand.event_bom_lines(id),
      commodity_id UUID NOT NULL,
      variety_id UUID,
      colour_code TEXT,
      grade_profile_id UUID,
      stem_length_cm_min NUMERIC(6,2),
      stem_length_cm_max NUMERIC(6,2),
      bloom_stage TEXT,
      pack_definition_id UUID,
      quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
      uom_id UUID NOT NULL,                       -- OD-07: explicit, never inferred
      needed_at TIMESTAMPTZ NOT NULL,
      delivery_destination TEXT NOT NULL,
      substitution_policy JSONB NOT NULL DEFAULT '{}',
      notes TEXT,
      attachments JSONB NOT NULL DEFAULT '[]',
      master_snapshot JSONB NOT NULL,             -- codes/names/version_nos at write time
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (stem_length_cm_min IS NULL OR stem_length_cm_max IS NULL
             OR stem_length_cm_min <= stem_length_cm_max)
    );
    CREATE INDEX requirement_lines_req_idx ON demand.requirement_lines (requirement_id, requirement_version_id);

    -- ============ RFQ DOMAIN (extend Build-0 tables; derive, never drift-copy)
    ALTER TABLE demand.rfqs DROP CONSTRAINT rfqs_status_check;
    ALTER TABLE demand.rfqs ADD CONSTRAINT rfqs_status_check CHECK (status IN
      ('DRAFT','PUBLISHED','CLOSED','AWARDED','PARTIALLY_AWARDED','CANCELLED'));
    ALTER TABLE demand.rfqs
      ADD COLUMN requirement_id UUID REFERENCES demand.requirements(id),
      ADD COLUMN requirement_version_id UUID REFERENCES demand.requirement_versions(id),
      ADD COLUMN mode TEXT CHECK (mode IS NULL OR mode IN ('QUICK','EVENT','FORMAL')),
      ADD COLUMN quote_deadline TIMESTAMPTZ,
      ADD COLUMN clarification_deadline TIMESTAMPTZ,
      ADD COLUMN commercial_instructions TEXT,
      ADD COLUMN delivery_requirements TEXT,
      ADD COLUMN published_at TIMESTAMPTZ,
      ADD COLUMN published_by UUID,
      ADD COLUMN cancel_reason TEXT;
    -- One open RFQ per requirement (duplicate-publish protection).
    CREATE UNIQUE INDEX rfqs_one_open_per_requirement ON demand.rfqs (requirement_id)
      WHERE requirement_id IS NOT NULL AND status IN ('DRAFT','PUBLISHED');

    ALTER TABLE demand.rfq_lines
      ADD COLUMN requirement_line_id UUID REFERENCES demand.requirement_lines(id),
      ADD COLUMN master_snapshot JSONB;

    ALTER TABLE demand.rfq_invitations
      ADD COLUMN status TEXT NOT NULL DEFAULT 'INVITED'
        CHECK (status IN ('INVITED','VIEWED','DECLINED','INTENDS_TO_QUOTE','QUOTED')),
      ADD COLUMN decline_reason TEXT,
      ADD COLUMN viewed_at TIMESTAMPTZ,
      ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    CREATE INDEX rfq_invitations_supplier_idx ON demand.rfq_invitations (supplier_org_id, status);

    -- ============ CLARIFICATION (structured; never mutates commercial terms)
    CREATE TABLE demand.clarifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rfq_id UUID NOT NULL REFERENCES demand.rfqs(id),
      author_user_id UUID NOT NULL,
      author_org_id UUID NOT NULL,
      question TEXT NOT NULL,
      response TEXT,
      responded_by UUID,
      responded_at TIMESTAMPTZ,
      visibility TEXT NOT NULL DEFAULT 'BUYER_PRIVATE' CHECK (visibility IN ('BUYER_PRIVATE','PUBLIC')),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ANSWERED','CLOSED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX clarifications_rfq_idx ON demand.clarifications (rfq_id, status);

    -- ============ QUOTATION DOMAIN (original values immutable; versions preserved)
    CREATE TABLE demand.quotations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      rfq_id UUID NOT NULL REFERENCES demand.rfqs(id),
      supplier_org_id UUID NOT NULL,
      current_version_no INT NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','WITHDRAWN','CLOSED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (rfq_id, supplier_org_id)
    );
    CREATE INDEX quotations_rfq_idx ON demand.quotations (rfq_id);

    CREATE TABLE demand.quotation_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quotation_id UUID NOT NULL REFERENCES demand.quotations(id),
      version_no INT NOT NULL,
      valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
      valid_to TIMESTAMPTZ NOT NULL,
      lead_time_days INT CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
      delivery_commitment TEXT,
      moq NUMERIC(14,3) CHECK (moq IS NULL OR moq > 0),
      partial_fulfilment_offered BOOLEAN NOT NULL DEFAULT false,
      commercial_terms TEXT,
      supplier_notes TEXT,
      status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN
        ('SUBMITTED','RECONFIRMATION_REQUIRED','SUPERSEDED','ACCEPTED','PARTIALLY_ACCEPTED','REJECTED')),
      submitted_by UUID NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revision_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (quotation_id, version_no)
    );
    CREATE INDEX quotation_versions_current_idx ON demand.quotation_versions (quotation_id, version_no DESC);

    CREATE TABLE demand.quotation_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quotation_version_id UUID NOT NULL REFERENCES demand.quotation_versions(id),
      requirement_line_id UUID NOT NULL REFERENCES demand.requirement_lines(id),
      quoted_qty NUMERIC(14,3) NOT NULL CHECK (quoted_qty > 0),          -- supplier original, immutable
      quoted_uom_id UUID NOT NULL,                                        -- supplier original, immutable
      unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
      currency CHAR(3) NOT NULL DEFAULT 'INR',
      components JSONB NOT NULL DEFAULT '{}',   -- packing/handling/freight/other: {state, amount_minor} w/ KNOWN|UNKNOWN|BUYER_ARRANGED|SUPPLIER_ARRANGED|PLATFORM_QUOTE_PENDING
      normalized_qty NUMERIC(14,3),             -- metadata only; never overwrites originals
      normalized_uom_id UUID,
      conversion_version_id UUID,
      conversion_version_no INT,
      normalization_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED'
        CHECK (normalization_status IN ('NORMALIZED','NO_CONVERSION','NOT_REQUESTED')),
      deviation_note TEXT,
      proposes_substitution BOOLEAN NOT NULL DEFAULT false,
      substitution_detail JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX quotation_lines_version_idx ON demand.quotation_lines (quotation_version_id);

    -- ============ AWARD DOMAIN (Build-3 terminal commercial decision)
    CREATE TABLE demand.awards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      rfq_id UUID NOT NULL REFERENCES demand.rfqs(id),
      requirement_id UUID NOT NULL REFERENCES demand.requirements(id),
      buyer_org_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'FINAL' CHECK (status IN ('FINAL','CANCELLED')),
      conditions TEXT,
      buyer_consent JSONB,   -- required when accepting deviations/substitutions
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      cancelled_by UUID,
      cancelled_at TIMESTAMPTZ,
      cancel_reason TEXT
    );
    CREATE INDEX awards_rfq_idx ON demand.awards (rfq_id);
    CREATE INDEX awards_requirement_idx ON demand.awards (requirement_id);

    CREATE TABLE demand.award_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      award_id UUID NOT NULL REFERENCES demand.awards(id),
      requirement_line_id UUID NOT NULL REFERENCES demand.requirement_lines(id),
      quotation_version_id UUID NOT NULL REFERENCES demand.quotation_versions(id),
      supplier_org_id UUID NOT NULL,
      awarded_qty NUMERIC(14,3) NOT NULL CHECK (awarded_qty > 0),
      uom_id UUID NOT NULL,
      unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
      currency CHAR(3) NOT NULL DEFAULT 'INR',
      normalized_awarded_qty NUMERIC(14,3),
      accepted_spec JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX award_lines_req_line_idx ON demand.award_lines (requirement_line_id);

    -- ============ MANAGED PROCUREMENT DESK
    CREATE TABLE demand.sourcing_notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      requirement_id UUID NOT NULL REFERENCES demand.requirements(id),
      operator_user_id UUID NOT NULL,
      note TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX sourcing_notes_req_idx ON demand.sourcing_notes (requirement_id);

    -- ============ PERMISSIONS + ROLES
    INSERT INTO identity.permissions (code, description) VALUES
      ('event.read','Read events'), ('event.write','Manage events and BOM'),
      ('demand.read','Read requirements'), ('demand.write','Create/revise requirements'),
      ('demand.submit','Submit requirements'),
      ('rfq.read','Read RFQs'), ('rfq.publish','Publish RFQs'), ('rfq.manage','Operations RFQ management'),
      ('quote.read','Read quotations'), ('quote.submit','Submit/revise quotations'),
      ('quote.evaluate','Compare/evaluate quotations'),
      ('award.read','Read awards'), ('award.create','Create awards'),
      ('procurement.manage','Operations procurement desk')
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO identity.roles (org_id, name, is_system, mfa_required)
    SELECT NULL, 'PROCUREMENT_OPS', true, false
    WHERE NOT EXISTS (SELECT 1 FROM identity.roles WHERE name = 'PROCUREMENT_OPS' AND org_id IS NULL);

    INSERT INTO identity.role_permissions (role_id, permission_id)
    SELECT ro.id, pe.id FROM identity.roles ro, identity.permissions pe
    WHERE ro.org_id IS NULL AND pe.code = ANY (CASE ro.name
      WHEN 'PLATFORM_ADMIN' THEN ARRAY['event.read','event.write','demand.read','demand.write','demand.submit',
        'rfq.read','rfq.publish','rfq.manage','quote.read','quote.submit','quote.evaluate',
        'award.read','award.create','procurement.manage']
      WHEN 'PROCUREMENT_OPS' THEN ARRAY['procurement.manage','demand.read','demand.write','rfq.read',
        'rfq.publish','rfq.manage','quote.read','quote.evaluate','award.read','event.read','catalog.read','admin.org.read']
      WHEN 'ORG_ADMIN' THEN ARRAY['event.read','event.write','demand.read','demand.write','demand.submit',
        'rfq.read','rfq.publish','quote.read','quote.submit','quote.evaluate','award.read','award.create']
      WHEN 'MEMBER' THEN ARRAY['event.read','demand.read','rfq.read','quote.read','award.read']
      ELSE ARRAY[]::text[] END)
    ON CONFLICT DO NOTHING;
  `);
};

exports.down = async (client) => {
  await client.query(`
    DELETE FROM identity.role_permissions WHERE role_id IN
      (SELECT id FROM identity.roles WHERE name = 'PROCUREMENT_OPS' AND org_id IS NULL);
    DELETE FROM identity.role_permissions WHERE permission_id IN
      (SELECT id FROM identity.permissions WHERE code IN
        ('event.read','event.write','demand.read','demand.write','demand.submit','rfq.read','rfq.publish',
         'rfq.manage','quote.read','quote.submit','quote.evaluate','award.read','award.create','procurement.manage'));
    DELETE FROM identity.user_roles WHERE role_id IN
      (SELECT id FROM identity.roles WHERE name = 'PROCUREMENT_OPS' AND org_id IS NULL);
    DELETE FROM identity.roles WHERE name = 'PROCUREMENT_OPS' AND org_id IS NULL;
    DELETE FROM identity.permissions WHERE code IN
      ('event.read','event.write','demand.read','demand.write','demand.submit','rfq.read','rfq.publish',
       'rfq.manage','quote.read','quote.submit','quote.evaluate','award.read','award.create','procurement.manage');

    DROP TABLE IF EXISTS demand.sourcing_notes, demand.award_lines, demand.awards,
      demand.quotation_lines, demand.quotation_versions, demand.quotations,
      demand.clarifications, demand.requirement_lines, demand.requirement_versions,
      demand.requirements, demand.event_bom_lines, demand.event_ceremonies, demand.events CASCADE;

    -- Purge Build-3 RFQ rows before restoring the legacy status constraint
    -- (PARTIALLY_AWARDED did not exist pre-Build-3).
    DELETE FROM demand.rfq_invitations WHERE rfq_id IN
      (SELECT id FROM demand.rfqs WHERE requirement_id IS NOT NULL OR status = 'PARTIALLY_AWARDED');
    DELETE FROM demand.rfq_lines WHERE rfq_id IN
      (SELECT id FROM demand.rfqs WHERE requirement_id IS NOT NULL OR status = 'PARTIALLY_AWARDED');
    DELETE FROM demand.rfqs WHERE requirement_id IS NOT NULL OR status = 'PARTIALLY_AWARDED';

    ALTER TABLE demand.rfq_invitations
      DROP COLUMN status, DROP COLUMN decline_reason, DROP COLUMN viewed_at, DROP COLUMN updated_at;
    ALTER TABLE demand.rfq_lines DROP COLUMN requirement_line_id, DROP COLUMN master_snapshot;
    ALTER TABLE demand.rfqs
      DROP COLUMN requirement_id, DROP COLUMN requirement_version_id, DROP COLUMN mode,
      DROP COLUMN quote_deadline, DROP COLUMN clarification_deadline, DROP COLUMN commercial_instructions,
      DROP COLUMN delivery_requirements, DROP COLUMN published_at, DROP COLUMN published_by,
      DROP COLUMN cancel_reason;
    ALTER TABLE demand.rfqs DROP CONSTRAINT rfqs_status_check;
    ALTER TABLE demand.rfqs ADD CONSTRAINT rfqs_status_check
      CHECK (status IN ('DRAFT','PUBLISHED','CLOSED','AWARDED','CANCELLED'));
  `);
};
