# 07 — Idempotency Design

## Goals
- Retried/duplicate client mutations are safe (client-supplied key).
- Duplicate provider webhooks are a no-op success ack (ADR-005).
- Async consumers are idempotent (event-id dedupe).

## Client-mutation idempotency (`common/idempotency`)
- Mutating endpoints accept header `Idempotency-Key` (required on POST/PUT of money/inventory-touching endpoints; optional elsewhere).
- Store: `core.idempotency_keys` — `UNIQUE(org_id, endpoint, key)`, `request_hash` (SHA-256 of canonical body), `response_status`, `response_body`, `state IN_PROGRESS|COMPLETED`, `locked_until`, `expires_at` (72h TTL, sweeper job).
- Flow (interceptor `IdempotencyInterceptor`):
  1. `INSERT … ON CONFLICT DO NOTHING` to claim the key (row lock via `locked_until`).
  2. If claim succeeds → run handler inside its transaction; persist response envelope in same transaction; return response.
  3. If key exists with same `request_hash` and `COMPLETED` → replay stored response byte-identically (`200` replay, header `Idempotency-Replayed: true`).
  4. Same key, **different** `request_hash` → `409 IDEMPOTENCY_KEY_REUSED` (standard error envelope).
  5. `IN_PROGRESS` and not expired → `409 IDEMPOTENCY_IN_PROGRESS`.
- Keys are scoped per org + endpoint: identical key on a different endpoint is independent.

## Webhook idempotency (ADR-005)
- Dedupe key: `UNIQUE(provider, provider_event_id)` in `payments-settlement.webhook_events` — **independent of any client key**.
- Signature verification happens **outside/before** the DB transaction; failed signatures → `core.security_audit_events` + `401`.
- Handler transaction: `INSERT webhook_events … ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`. No row returned ⇒ duplicate ⇒ `200 OK` success ack, **zero side effects**.

## Outbox consumer idempotency
- Every outbox event has `id UUID`; consumers record processed ids (`processed_events` per consumer or natural upsert on target entity) — `INSERT … ON CONFLICT DO NOTHING` before side effects.

## Optimistic concurrency vs idempotency
Idempotency protects replays; optimistic `version` protects interleaved writers. Both are mandatory on ordinary mutables. Inventory/allocation uses transactional row locks (`SELECT … FOR UPDATE`) instead — correctness over concurrency (ADR-001: never oversell).

## Baseline tests (acceptance gate)
- Same key + same body twice → one side effect, identical responses.
- Same key + different body → 409.
- Concurrent duplicate webhook deliveries → exactly one processed, both 200.
