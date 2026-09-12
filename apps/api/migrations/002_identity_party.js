// 002 — identity-party (docs/05 IP; ADR-004, ADR-006)
exports.up = async (client) => {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS identity;

    CREATE TABLE identity.organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('BUYER','SUPPLIER','BOTH','ADMIN')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE identity.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DEACTIVATED')),
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    -- ADR-006: bearer/OIDC subject mapping; no cookie-only sessions.
    CREATE TABLE identity.auth_identities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES identity.users(id),
      provider TEXT NOT NULL,
      subject TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (provider, subject)
    );

    CREATE TABLE identity.org_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES identity.organizations(id),
      user_id UUID NOT NULL REFERENCES identity.users(id),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED','ACTIVE','SUSPENDED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (org_id, user_id)
    );

    CREATE TABLE identity.roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID REFERENCES identity.organizations(id),
      name TEXT NOT NULL,
      is_system BOOLEAN NOT NULL DEFAULT false,
      mfa_required BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (org_id, name)
    );

    CREATE TABLE identity.permissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE identity.role_permissions (
      role_id UUID NOT NULL REFERENCES identity.roles(id),
      permission_id UUID NOT NULL REFERENCES identity.permissions(id),
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE identity.user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES identity.users(id),
      role_id UUID NOT NULL REFERENCES identity.roles(id),
      org_id UUID NOT NULL REFERENCES identity.organizations(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, role_id, org_id)
    );

    CREATE TABLE identity.mfa_enrollments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES identity.users(id),
      method TEXT NOT NULL CHECK (method IN ('TOTP')),
      secret_ref TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','REVOKED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE identity.kyc_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES identity.organizations(id),
      status TEXT NOT NULL CHECK (status IN ('SUBMITTED','VERIFIED','REJECTED')),
      reviewer_user_id UUID REFERENCES identity.users(id),
      detail JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TRIGGER kyc_immutable BEFORE UPDATE OR DELETE ON identity.kyc_records
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    -- ADR-004: protected historical bank record — new immutable row per change.
    CREATE TABLE identity.bank_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES identity.organizations(id),
      account_ref TEXT NOT NULL,
      ifsc TEXT NOT NULL,
      account_number_enc TEXT NOT NULL,
      holder_name TEXT NOT NULL,
      effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
      superseded_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TRIGGER bank_accounts_immutable BEFORE UPDATE OR DELETE ON identity.bank_accounts
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    CREATE TABLE identity.bank_change_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES identity.organizations(id),
      new_bank_account_id UUID NOT NULL REFERENCES identity.bank_accounts(id),
      status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN
        ('SUBMITTED','PENDING_REVERIFICATION','APPROVED_FIRST','APPROVED_FINAL','REJECTED')),
      payout_freeze BOOLEAN NOT NULL DEFAULT true,
      approver_1_id UUID REFERENCES identity.users(id),
      approver_1_at TIMESTAMPTZ,
      approver_2_id UUID REFERENCES identity.users(id),
      approver_2_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (approver_1_id IS NULL OR approver_2_id IS NULL OR approver_1_id <> approver_2_id)
    );
  `);
};

exports.down = async (client) => {
  await client.query('DROP SCHEMA IF EXISTS identity CASCADE');
};
