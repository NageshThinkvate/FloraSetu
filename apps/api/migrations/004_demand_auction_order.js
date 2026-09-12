// 004 — demand-rfq + auction-market + order-allocation (docs/05 DR/AM/OA; ADR-001)
exports.up = async (client) => {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS demand;
    CREATE SCHEMA IF NOT EXISTS auction;
    CREATE SCHEMA IF NOT EXISTS ordering;

    CREATE TABLE demand.demand_intents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      variety_id UUID NOT NULL,
      qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
      needed_by DATE,
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE demand.procurement_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      name TEXT NOT NULL,
      opens_at TIMESTAMPTZ,
      closes_at TIMESTAMPTZ,
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE demand.rfqs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      event_id UUID REFERENCES demand.procurement_events(id),
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED','AWARDED','CANCELLED')),
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE demand.rfq_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rfq_id UUID NOT NULL REFERENCES demand.rfqs(id),
      variety_id UUID NOT NULL,
      qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
      allow_partial_fill BOOLEAN NOT NULL DEFAULT false,
      minimum_acceptable_quantity NUMERIC(14,3),
      CHECK (allow_partial_fill = false OR minimum_acceptable_quantity IS NOT NULL)
    );

    CREATE TABLE demand.rfq_invitations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rfq_id UUID NOT NULL REFERENCES demand.rfqs(id),
      supplier_org_id UUID NOT NULL,
      invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (rfq_id, supplier_org_id)
    );

    CREATE TABLE demand.rfq_bids (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rfq_line_id UUID NOT NULL REFERENCES demand.rfq_lines(id),
      supplier_org_id UUID NOT NULL,
      qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
      unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
      currency CHAR(3) NOT NULL,
      round_no INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ADR-001: multi-supplier award (sum per line enforced in service layer).
    CREATE TABLE demand.rfq_awards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      rfq_line_id UUID NOT NULL REFERENCES demand.rfq_lines(id),
      supplier_org_id UUID NOT NULL,
      awarded_qty NUMERIC(14,3) NOT NULL CHECK (awarded_qty > 0),
      unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
      currency CHAR(3) NOT NULL,
      awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (rfq_line_id, supplier_org_id)
    );

    CREATE TABLE auction.auctions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      org_id UUID NOT NULL,
      title TEXT NOT NULL,
      opens_at TIMESTAMPTZ NOT NULL,
      closes_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','OPEN','CLOSED','SETTLED','CANCELLED')),
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (closes_at > opens_at)
    );

    CREATE TABLE auction.auction_lots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      auction_id UUID NOT NULL REFERENCES auction.auctions(id),
      lot_ref TEXT NOT NULL,
      reserve_price_minor BIGINT CHECK (reserve_price_minor >= 0),
      currency CHAR(3) NOT NULL,
      UNIQUE (auction_id, lot_ref)
    );

    CREATE TABLE auction.bids (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      auction_lot_id UUID NOT NULL REFERENCES auction.auction_lots(id),
      bidder_org_id UUID NOT NULL,
      amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
      currency CHAR(3) NOT NULL,
      placed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TRIGGER bids_immutable BEFORE UPDATE OR DELETE ON auction.bids
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    CREATE TABLE auction.auction_results (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      auction_lot_id UUID NOT NULL UNIQUE REFERENCES auction.auction_lots(id),
      winner_org_id UUID,
      clearing_price_minor BIGINT CHECK (clearing_price_minor >= 0),
      currency CHAR(3) NOT NULL,
      closed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TRIGGER auction_results_immutable BEFORE UPDATE OR DELETE ON auction.auction_results
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    CREATE TABLE auction.market_price_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      variety_ref TEXT NOT NULL,
      terminal_ref TEXT,
      price_minor BIGINT NOT NULL CHECK (price_minor >= 0),
      currency CHAR(3) NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TRIGGER price_snapshots_immutable BEFORE UPDATE OR DELETE ON auction.market_price_snapshots
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();

    CREATE TABLE ordering.orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ref TEXT NOT NULL UNIQUE,
      buyer_org_id UUID NOT NULL,
      source_type TEXT CHECK (source_type IN ('RFQ','AUCTION','DIRECT')),
      source_id UUID,
      total_minor BIGINT NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
      currency CHAR(3) NOT NULL,
      status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN
        ('CREATED','CONFIRMED','ALLOCATED','FULFILLED','INVOICED','CLOSED','CANCELLED')),
      version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    );

    CREATE TABLE ordering.order_lines (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES ordering.orders(id),
      variety_id UUID NOT NULL,
      qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
      agreed_unit_price_minor BIGINT NOT NULL CHECK (agreed_unit_price_minor >= 0),
      currency CHAR(3) NOT NULL
    );

    -- ADR-001: allocations created under transactional row lock on the lot.
    CREATE TABLE ordering.allocations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_line_id UUID NOT NULL REFERENCES ordering.order_lines(id),
      lot_id UUID NOT NULL,
      qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (order_line_id, lot_id)
    );

    CREATE TABLE ordering.order_status_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES ordering.orders(id),
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor_user_id UUID,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TRIGGER order_history_immutable BEFORE UPDATE OR DELETE ON ordering.order_status_history
      FOR EACH ROW EXECUTE FUNCTION core.prevent_mutation();
  `);
};

exports.down = async (client) => {
  await client.query(`DROP SCHEMA IF EXISTS ordering CASCADE; DROP SCHEMA IF EXISTS auction CASCADE; DROP SCHEMA IF EXISTS demand CASCADE`);
};
