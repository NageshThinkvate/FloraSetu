// 007 — Build 1: Identity & Party full model (Master v2.0). Extends 002.
exports.up = async (client) => {
  await client.query(`
    -- Full organization category vocabulary (exporter/government are feature-gated at the service layer).
    ALTER TABLE identity.organizations DROP CONSTRAINT organizations_type_check;
    ALTER TABLE identity.organizations ADD CONSTRAINT organizations_type_check CHECK (type IN (
      'BUYER','FLORIST','WHOLESALER','DECORATOR','EVENT_PLANNER','HOTEL','CORPORATE_BUYER',
      'GROWER','GROWER_GROUP','IMPORTER','AGGREGATION_HUB','QC_PARTNER','LOGISTICS_PROVIDER',
      'COLD_CHAIN_PARTNER','PLATFORM_OPS','FINANCE','ADMIN','EXPORTER','GOVERNMENT'));
    ALTER TABLE identity.organizations
      ADD COLUMN kyb_status TEXT NOT NULL DEFAULT 'NOT_STARTED'
        CHECK (kyb_status IN ('NOT_STARTED','IN_REVIEW','VERIFIED','REJECTED'));

    CREATE TABLE identity.addresses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES identity.organizations(id),
      label TEXT NOT NULL DEFAULT 'PRIMARY',
      line1 TEXT NOT NULL,
      line2 TEXT,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country CHAR(2) NOT NULL DEFAULT 'IN',
      geog GEOGRAPHY(Point, 4326),
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE identity.organization_branches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL REFERENCES identity.organizations(id),
      name TEXT NOT NULL,
      address_id UUID REFERENCES identity.addresses(id),
      is_primary BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE identity.contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES identity.organizations(id),
      kind TEXT NOT NULL CHECK (kind IN ('EMAIL','PHONE','WHATSAPP')),
      value TEXT NOT NULL,
      is_primary BOOLEAN NOT NULL DEFAULT false,
      verified BOOLEAN NOT NULL DEFAULT false,
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      UNIQUE (org_id, kind, value)
    );

    CREATE TABLE identity.user_credentials (
      user_id UUID PRIMARY KEY REFERENCES identity.users(id),
      password_hash TEXT NOT NULL,
      password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE identity.refresh_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES identity.users(id),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      ip TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE identity.documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES identity.organizations(id),
      doc_type TEXT NOT NULL CHECK (doc_type IN ('GST','PAN','TRADE_LICENSE','BANK_PROOF','OTHER')),
      media_object_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','REJECTED')),
      uploaded_by UUID NOT NULL REFERENCES identity.users(id),
      reviewed_by UUID REFERENCES identity.users(id),
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Immutable verification/KYB history.
    CREATE TABLE identity.verification_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES identity.organizations(id),
      subject_type TEXT NOT NULL CHECK (subject_type IN ('ORGANIZATION','DOCUMENT','BANK')),
      subject_id UUID,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor_user_id UUID REFERENCES identity.users(id),
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TRIGGER verification_history_immutable BEFORE UPDATE OR DELETE ON identity.verification_history
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    CREATE TABLE identity.org_restrictions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES identity.organizations(id),
      restriction_type TEXT NOT NULL CHECK (restriction_type IN ('SUSPENSION','TRANSACTION_BLOCK')),
      reason TEXT NOT NULL,
      created_by UUID NOT NULL REFERENCES identity.users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      lifted_at TIMESTAMPTZ,
      lifted_by UUID REFERENCES identity.users(id),
      version INT NOT NULL DEFAULT 1
    );
    CREATE INDEX org_restrictions_active_idx ON identity.org_restrictions (org_id) WHERE lifted_at IS NULL;

    -- Audited support access: immutable, time-boxed grants. No shared admin passwords.
    CREATE TABLE identity.support_access_grants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      support_user_id UUID NOT NULL REFERENCES identity.users(id),
      org_id UUID NOT NULL REFERENCES identity.organizations(id),
      reason TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TRIGGER support_grants_immutable BEFORE UPDATE OR DELETE ON identity.support_access_grants
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    -- Permission catalog (master data).
    INSERT INTO identity.permissions (code, description) VALUES
      ('org.create.platform','Create platform-internal organizations'),
      ('org.read','Read own organization'),
      ('org.write','Update own organization'),
      ('branch.write','Manage branches'),
      ('contact.write','Manage contacts'),
      ('member.read','List members'),
      ('member.invite','Invite/manage members'),
      ('role.manage','Assign org-scoped roles'),
      ('kyb.submit','Submit KYB documents'),
      ('kyb.review','Review KYB submissions'),
      ('bank.read','Read masked bank/payout profile'),
      ('bank.write','Submit bank/payout changes'),
      ('bank.approve','Approve bank changes (dual control)'),
      ('restriction.manage','Suspend/restrict organizations'),
      ('support.access','Request audited support access'),
      ('admin.org.read','Platform-level org read (masked)'),
      ('audit.read','Read audit events'),
      ('config.read','Read config entries'),
      ('config.write','Write config entries')
    ON CONFLICT (code) DO NOTHING;

    -- System roles (org_id NULL = platform/system role). MFA-ready privileged roles flagged.
    INSERT INTO identity.roles (org_id, name, is_system, mfa_required)
    SELECT NULL, r.name, true, r.mfa FROM (VALUES
      ('PLATFORM_ADMIN', true),
      ('FINANCE_OPS', true),
      ('SUPPORT_AGENT', false),
      ('KYB_REVIEWER', false),
      ('ORG_ADMIN', false),
      ('MEMBER', false)
    ) AS r(name, mfa)
    WHERE NOT EXISTS (SELECT 1 FROM identity.roles WHERE name = r.name AND org_id IS NULL);

    INSERT INTO identity.role_permissions (role_id, permission_id)
    SELECT ro.id, pe.id FROM identity.roles ro, identity.permissions pe
    WHERE ro.name = 'PLATFORM_ADMIN' AND ro.org_id IS NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO identity.role_permissions (role_id, permission_id)
    SELECT ro.id, pe.id FROM identity.roles ro, identity.permissions pe
    WHERE ro.org_id IS NULL AND pe.code = ANY (CASE ro.name
      WHEN 'FINANCE_OPS' THEN ARRAY['bank.read','bank.approve','audit.read','admin.org.read']
      WHEN 'SUPPORT_AGENT' THEN ARRAY['support.access','admin.org.read']
      WHEN 'KYB_REVIEWER' THEN ARRAY['kyb.review','admin.org.read']
      WHEN 'ORG_ADMIN' THEN ARRAY['org.read','org.write','branch.write','contact.write','member.read','member.invite','role.manage','kyb.submit','bank.read','bank.write']
      WHEN 'MEMBER' THEN ARRAY['org.read','member.read']
      ELSE ARRAY[]::text[] END)
    ON CONFLICT DO NOTHING;
  `);
};

exports.down = async (client) => {
  await client.query(`
    DELETE FROM identity.user_roles WHERE role_id IN (SELECT id FROM identity.roles WHERE org_id IS NULL);
    DELETE FROM identity.role_permissions WHERE role_id IN (SELECT id FROM identity.roles WHERE org_id IS NULL);
    DELETE FROM identity.roles WHERE org_id IS NULL;
    DELETE FROM identity.permissions WHERE code IN (
      'org.create.platform','org.read','org.write','branch.write','contact.write','member.read',
      'member.invite','role.manage','kyb.submit','kyb.review','bank.read','bank.write','bank.approve',
      'restriction.manage','support.access','admin.org.read','audit.read');
    DROP TABLE IF EXISTS identity.support_access_grants, identity.org_restrictions,
      identity.verification_history, identity.documents, identity.refresh_tokens,
      identity.user_credentials, identity.contacts, identity.organization_branches,
      identity.addresses CASCADE;
    ALTER TABLE identity.organizations DROP COLUMN kyb_status;
    ALTER TABLE identity.organizations DROP CONSTRAINT organizations_type_check;
    UPDATE identity.organizations SET type = CASE
      WHEN type IN ('BUYER','FLORIST','DECORATOR','EVENT_PLANNER','HOTEL','CORPORATE_BUYER') THEN 'BUYER'
      WHEN type IN ('PLATFORM_OPS','FINANCE','ADMIN') THEN 'ADMIN'
      WHEN type IN ('GROWER','GROWER_GROUP','IMPORTER','AGGREGATION_HUB','WHOLESALER','QC_PARTNER',
                    'LOGISTICS_PROVIDER','COLD_CHAIN_PARTNER') THEN 'SUPPLIER'
      ELSE 'BOTH' END;
    ALTER TABLE identity.organizations ADD CONSTRAINT organizations_type_check
      CHECK (type IN ('BUYER','SUPPLIER','BOTH','ADMIN'));
  `);
};
