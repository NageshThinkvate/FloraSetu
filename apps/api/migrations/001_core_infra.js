// 001 — cross-cutting core schema (docs/05 XC, docs/07, docs/08, docs/10)
exports.up = async (client) => {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS core;

    CREATE OR REPLACE FUNCTION core.prevent_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'immutable record: % rows cannot be %', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'raise_exception';
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TABLE core.reference_counters (
      entity TEXT NOT NULL,
      year INT NOT NULL,
      next_value BIGINT NOT NULL,
      PRIMARY KEY (entity, year)
    );

    CREATE TABLE core.outbox_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      aggregate_type TEXT NOT NULL,
      aggregate_id UUID NOT NULL,
      type TEXT NOT NULL,
      payload JSONB NOT NULL,
      trace_id TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      published_at TIMESTAMPTZ,
      attempts INT NOT NULL DEFAULT 0,
      CHECK (attempts >= 0)
    );
    CREATE INDEX outbox_unpublished_idx ON core.outbox_events (occurred_at) WHERE published_at IS NULL;

    CREATE TABLE core.idempotency_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      endpoint TEXT NOT NULL,
      key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('IN_PROGRESS','COMPLETED')),
      response_status INT,
      response_body JSONB,
      locked_until TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (org_id, endpoint, key)
    );

    CREATE TABLE core.audit_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      org_id UUID,
      actor_user_id UUID,
      actor_roles TEXT[] NOT NULL DEFAULT '{}',
      action TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id UUID NOT NULL,
      object_ref TEXT,
      before JSONB,
      after JSONB,
      trace_id TEXT,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX audit_org_time_idx ON core.audit_events (org_id, occurred_at DESC);
    CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON core.audit_events
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    CREATE TABLE core.security_audit_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      org_id UUID,
      actor_user_id UUID,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('INFO','WARN','HIGH')),
      detail JSONB NOT NULL DEFAULT '{}',
      trace_id TEXT,
      ip TEXT
    );
    CREATE TRIGGER security_audit_immutable BEFORE UPDATE OR DELETE ON core.security_audit_events
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    CREATE TABLE core.feature_flags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key TEXT NOT NULL,
      enabled BOOLEAN NOT NULL,
      valid_from TIMESTAMPTZ NOT NULL,
      valid_to TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (valid_to IS NULL OR valid_to > valid_from)
    );
    CREATE INDEX feature_flags_window_idx ON core.feature_flags (key, valid_from DESC);

    CREATE TABLE core.config_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      ref TEXT NOT NULL UNIQUE,
      key TEXT NOT NULL,
      value JSONB,
      version_no INT NOT NULL CHECK (version_no >= 1),
      valid_from TIMESTAMPTZ NOT NULL,
      valid_to TIMESTAMPTZ,
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ,
      CHECK (valid_to IS NULL OR valid_to > valid_from)
    );
    CREATE INDEX config_entries_org_idx ON core.config_entries (org_id, key);

    CREATE TABLE core.media_objects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      bucket TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      content_type TEXT NOT NULL,
      byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = async (client) => {
  await client.query(`
    DROP TABLE IF EXISTS core.media_objects, core.config_entries, core.feature_flags,
      core.security_audit_events, core.audit_events, core.idempotency_keys,
      core.outbox_events, core.reference_counters CASCADE;
    DROP FUNCTION IF EXISTS core.prevent_mutation();
    DROP SCHEMA IF EXISTS core CASCADE;
  `);
};
