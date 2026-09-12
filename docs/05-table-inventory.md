# 05 — Table Inventory (all contexts; later-phase tables created, UI-inactive)

Legend: PK `id UUID`; tenant tables carry `org_id UUID NOT NULL`; `ref TEXT UNIQUE` = public reference ID; IMM = immutable (trigger + grants); VE = versioned effective-dated; `version INT` = optimistic concurrency; money columns `*_minor BIGINT`.

## identity-party (IP)
| table | notes |
|---|---|
| organizations | type (BUYER/SUPPLIER/BOTH/ADMIN), status, soft-delete, version |
| users | email UNIQUE, phone, status, soft-delete, version |
| auth_identities | OIDC/bearer subjects: (provider, subject) UNIQUE — ADR-006 |
| org_memberships | (org_id,user_id) UNIQUE, status |
| roles | (org_id nullable for system roles, name) UNIQUE |
| permissions | code UNIQUE (e.g. `supply.lot.write`) |
| role_permissions | (role_id, permission_id) UNIQUE |
| user_roles | (user_id, role_id, org_id) UNIQUE |
| mfa_enrollments | TOTP secret ref, status — privileged roles MFA-ready |
| kyc_records | IMM — status history, reviewer |
| bank_accounts | IMM history — protected: new row per change, never mutated (ADR-004) |
| bank_change_requests | PENDING_REVERIFICATION state, dual approval (two approver user ids + timestamps), freeze flag |

## catalog-standards (CS)
| table | notes |
|---|---|
| categories / commodities / varieties | hierarchy; soft-delete; version |
| units_of_measure | canonical units, conversion to base |
| grade_standards | VE — versioned quality standards |
| pack_types | weight/volume canonical |

## supply-inventory (SI)
| table | notes |
|---|---|
| terminals | PostGIS `geog GEOGRAPHY(Point,4326)` |
| warehouses | org-owned, terminal ref |
| supply_lots | qty fields: `available_qty/reserved_qty/allocated_qty NUMERIC(14,3)` + CHECK `reserved+allocated<=available+0`, `allow_partial_fill BOOL DEFAULT false`, `minimum_acceptable_quantity`, status; version |
| inventory_reservations | lot→owner ref, qty, status (HELD/COMMITTED/RELEASED/CONSUMED), expiry |
| availability_forecasts | VE-style dated projections; reduction never touches committed reservations |
| supply_risk_events | raised when forecast < committed (ADR-001) |

## demand-rfq (DR)
| table | notes |
|---|---|
| demand_intents | buyer demand signals |
| procurement_events | grouped buying events |
| rfqs / rfq_lines | line: variety, qty, `allow_partial_fill`, `minimum_acceptable_quantity` (default all-or-nothing) |
| rfq_invitations | (rfq_id, supplier_org_id) UNIQUE |
| rfq_bids | per supplier per line; versioned bid rounds |
| rfq_awards | line→supplier, awarded qty; CHECK sum per line enforced in service; MULTI-SUPPLIER ≠ partial fill (ADR-001) |

## auction-market (AM)
| table | notes |
|---|---|
| auctions / auction_lots | windows, lot→supply_lot |
| bids | IMM — amount_minor, placed_at |
| auction_results | IMM — winner, clearing price_minor |
| market_price_snapshots | IMM append-only |

## order-allocation (OA)
| table | notes |
|---|---|
| orders | buyer org, totals in minor units, status, version |
| order_lines | qty, agreed price_minor |
| allocations | line→lot qty; created under row lock (ADR-001) |
| order_status_history | IMM |

## quality-traceability (QT)
| table | notes |
|---|---|
| qc_inspections / qc_results | result→grade_standard version used; IMM results |
| certificates | media ref |
| traceability_links | IMM lot genealogy (parent→child) |
| custody_events | IMM chain-of-custody |

## logistics-coldchain (LC)
| table | notes |
|---|---|
| shipments / shipment_legs | leg route PostGIS `geog GEOGRAPHY(LineString,4326)`; acceptance_hold flag (ADR-002) |
| routes | PostGIS |
| temperature_readings | append-only, device ref |
| temperature_excursion_events | IMM — severity resolved via handling_profiles version in force at occurred_at (ADR-002) |
| shipment_exceptions | HOLD / PENDING_REVIEW gates buyer acceptance + supplier settlement |
| handling_profiles | VE — severity thresholds, versioned effective-dated policy (ADR-002) |

## payments-settlement (PS)
| table | notes |
|---|---|
| invoices / payments | amounts minor; provider refs |
| payouts | state machine incl. `SUBMITTED_IRREVERSIBLE`; freeze flag on bank change (ADR-004) |
| settlements | IMM (ADR-003) |
| financial_adjustments / recoveries | post-settlement claim money movement, generic mechanism (ADR-003) |
| webhook_events | UNIQUE(provider, provider_event_id) — dedupe independent of client key (ADR-005) |
| payment_provider_refs | provider unselected (open decision) |

## claims-support (CX)
| table | notes |
|---|---|
| claims | post-settlement capable (links settlement_id) |
| claim_evidences | media refs |
| claim_decisions | IMM |
| support_tickets / ticket_messages | — |

## notifications (NT)
| table | notes |
|---|---|
| notification_templates | VE |
| notifications / notification_deliveries | channel enum WEB_PUSH now; FCM/APNS reserved (ADR-006) |
| push_subscriptions / device_tokens | web push now, native later via same gateway |

## analytics-controltower (AN)
| table | notes |
|---|---|
| kpi_definitions | VE |
| analytics_snapshots | append-only |
| control_tower_alerts / dashboard_configs | org-scoped |

## cross-cutting (XC, schema `core`)
| table | notes |
|---|---|
| outbox_events | id, aggregate, type, payload JSONB, occurred_at, published_at NULL |
| idempotency_keys | UNIQUE(org_id, endpoint, key); request_hash, response_status/body, locked_until, expires_at |
| audit_events | IMM — actor, action, object_type/id, before/after JSONB, trace_id |
| security_audit_events | IMM — failed signatures, authz denials, privileged actions (ADR-005) |
| feature_flags | VE — key, enabled, valid_from/to |
| config_entries | VE — effective-dated config masters |
| media_objects | bucket/key, content_type, byte_size; access via signed URLs only |
| reference_counters | (entity, year) → next value; generates `LOT-2026-000123`-style refs |
