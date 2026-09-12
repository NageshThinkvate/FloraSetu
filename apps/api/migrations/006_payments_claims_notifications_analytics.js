// 006 — payments-settlement + claims-support + notifications + analytics (docs/05 PS/CX/NT/AN; ADR-003/004/005/006)
exports.up = async (client) => {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS payments;
    CREATE SCHEMA IF NOT EXISTS claims;
    CREATE SCHEMA IF NOT EXISTS notifications;
    CREATE SCHEMA IF NOT EXISTS analytics;

    CREATE TABLE payments.invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      order_id UUID NOT NULL,
      amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
      currency CHAR(3) NOT NULL,
      status TEXT NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','PARTIALLY_PAID','PAID','VOID')),
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE payments.payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      invoice_id UUID NOT NULL REFERENCES payments.invoices(id),
      amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
      currency CHAR(3) NOT NULL,
      provider TEXT,
      provider_ref TEXT,
      status TEXT NOT NULL DEFAULT 'INITIATED' CHECK (status IN ('INITIATED','CAPTURED','FAILED','REFUNDED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ADR-004: SUBMITTED_IRREVERSIBLE; payout_freeze on bank change.
    CREATE TABLE payments.payouts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
      currency CHAR(3) NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN
        ('DRAFT','APPROVED','SUBMITTED_IRREVERSIBLE','SETTLED','FAILED')),
      payout_freeze BOOLEAN NOT NULL DEFAULT false,
      bank_account_id UUID,
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ADR-003: settlements immutable; corrections only via adjustments/recoveries.
    CREATE TABLE payments.settlements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      order_id UUID,
      amount_minor BIGINT NOT NULL,
      currency CHAR(3) NOT NULL,
      settled_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TRIGGER settlements_immutable BEFORE UPDATE OR DELETE ON payments.settlements
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    CREATE TABLE payments.financial_adjustments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      settlement_id UUID NOT NULL REFERENCES payments.settlements(id),
      claim_id UUID,
      direction TEXT NOT NULL CHECK (direction IN ('CREDIT','DEBIT')),
      amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
      currency CHAR(3) NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE payments.recoveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      adjustment_id UUID NOT NULL REFERENCES payments.financial_adjustments(id),
      mechanism TEXT NOT NULL DEFAULT 'DEFERRED',
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RECOVERED','WRITTEN_OFF')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ADR-005: dedupe independent of client idempotency keys.
    CREATE TABLE payments.webhook_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      processed_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (provider, provider_event_id)
    );

    CREATE TABLE payments.payment_provider_refs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id UUID NOT NULL,
      provider_ref TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (provider, entity_type, entity_id)
    );

    CREATE TABLE claims.claims (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      order_id UUID,
      settlement_id UUID,
      claim_type TEXT NOT NULL CHECK (claim_type IN ('QUALITY','SHORTAGE','COLD_CHAIN','PAYMENT','OTHER')),
      status TEXT NOT NULL DEFAULT 'OPENED' CHECK (status IN ('OPENED','UNDER_REVIEW','DECIDED','CLOSED')),
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE claims.claim_evidences (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      claim_id UUID NOT NULL REFERENCES claims.claims(id),
      media_object_id UUID NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE claims.claim_decisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      claim_id UUID NOT NULL UNIQUE REFERENCES claims.claims(id),
      outcome TEXT NOT NULL CHECK (outcome IN ('APPROVED','PARTIAL','REJECTED')),
      adjustment_minor BIGINT CHECK (adjustment_minor >= 0),
      currency CHAR(3),
      decided_by UUID,
      decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TRIGGER claim_decisions_immutable BEFORE UPDATE OR DELETE ON claims.claim_decisions
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    CREATE TABLE claims.support_tickets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PENDING','RESOLVED','CLOSED')),
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE claims.ticket_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id UUID NOT NULL REFERENCES claims.support_tickets(id),
      author_user_id UUID,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE notifications.notification_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key TEXT NOT NULL,
      version_no INT NOT NULL CHECK (version_no >= 1),
      channel TEXT NOT NULL CHECK (channel IN ('WEB_PUSH','FCM','APNS','EMAIL','SMS')),
      body_template TEXT NOT NULL,
      valid_from TIMESTAMPTZ NOT NULL,
      valid_to TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (key, version_no),
      CHECK (valid_to IS NULL OR valid_to > valid_from)
    );

    CREATE TABLE notifications.notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      user_id UUID,
      template_id UUID REFERENCES notifications.notification_templates(id),
      payload JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE notifications.notification_deliveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notification_id UUID NOT NULL REFERENCES notifications.notifications(id),
      channel TEXT NOT NULL CHECK (channel IN ('WEB_PUSH','FCM','APNS','EMAIL','SMS')),
      status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','FAILED')),
      attempted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE notifications.push_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      keys JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ADR-006: FCM/APNs later, behind the same gateway.
    CREATE TABLE notifications.device_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('FCM','APNS')),
      token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE analytics.kpi_definitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key TEXT NOT NULL,
      version_no INT NOT NULL CHECK (version_no >= 1),
      definition JSONB NOT NULL,
      valid_from TIMESTAMPTZ NOT NULL,
      valid_to TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (key, version_no),
      CHECK (valid_to IS NULL OR valid_to > valid_from)
    );

    CREATE TABLE analytics.analytics_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID,
      kpi_id UUID REFERENCES analytics.kpi_definitions(id),
      value NUMERIC(24,6),
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE analytics.control_tower_alerts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID,
      severity TEXT NOT NULL CHECK (severity IN ('INFO','WARN','CRITICAL')),
      source_event_type TEXT,
      detail JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE analytics.dashboard_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      name TEXT NOT NULL,
      layout JSONB NOT NULL DEFAULT '{}',
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );
  `);
};

exports.down = async (client) => {
  await client.query(`DROP SCHEMA IF EXISTS analytics CASCADE; DROP SCHEMA IF EXISTS notifications CASCADE;
    DROP SCHEMA IF EXISTS claims CASCADE; DROP SCHEMA IF EXISTS payments CASCADE`);
};
