# 10 — Async / Outbox Design

## Transactional outbox (no Kafka)
- Table `core.outbox_events`: `id UUID, aggregate_type, aggregate_id, type, payload JSONB, trace_id, occurred_at, published_at NULL, attempts INT`.
- Services write domain state + outbox row in the **same DB transaction** via `OutboxWriter` (common/outbox). No dual-write.
- **Relay worker** (`src/workers/outbox-relay.ts`): polls `WHERE published_at IS NULL ORDER BY occurred_at LIMIT n FOR UPDATE SKIP LOCKED`, publishes to the internal queue (BullMQ on Redis in Build 0; `QueuePort` interface allows swap), marks `published_at` only after ack. At-least-once → consumers must be idempotent (event-id dedupe, see 07).
- **Queue worker** dispatches to consumer handlers registered per event type by consuming contexts (e.g. Analytics consumes `order.created`; Notifications consumes `coldchain.excursion.detected`).

## Event contract
- Event types are defined in the **publisher's** `contracts/events.ts`; payload versioned (`v` field); additive-only evolution.
- `trace_id` propagated from originating request → audit + downstream consumers.

## Real-time (interface only in Build 0)
`RealtimeGateway` interface (`common/realtime`): `emitToOrg(orgId, channel, payload)`, `emitToUser(...)`. WebSocket/SSE implementation is deferred; consumers code against the interface so auctions/notifications light up later without refactor.

## Scheduling / retries
- Worker retries with exponential backoff, max 8 attempts → dead-letter queue + `core.security_audit_events` entry + control-tower alert event.
- Idempotency-key sweeper and outbox-janitor are interval jobs inside the worker process (no cron infra in Build 0; platform cron is a deployment concern recorded in tech debt).

## Webhooks (inbound) vs outbox (outbound)
Inbound provider webhooks never publish directly; they persist dedupe + enqueue an event, ack fast (ADR-005). Heavy processing is async.

## Baseline tests
- Service write → outbox row exists in same transaction (rollback test: neither exists).
- Relay publishes once per event under concurrent relay instances (SKIP LOCKED).
- Consumer dedupe: same event id delivered twice → one effect.
