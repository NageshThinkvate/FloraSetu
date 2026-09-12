# BUILD 4 — FINAL ACCEPTANCE REPORT (Pilot Fulfilment Core)

Date: 2026-09-12 · Baseline tag for Builds 0–3: `florasetu-build3-accepted` · Build 4 branch state: this commit.

## 1. Scope delivered (all Build 4 mandates)

- **Award → Order conversion** with immutable spec snapshots, one-order-per-award, idempotent replay (`POST /orders/convert-award`).
- **Supplier allocations**: confirm / shortfall; order lifecycle drives from confirmation through `SETTLED`/`CLOSED` with append-only status history.
- **Physical supply / inventory lots**: harvest + stock receipt intake, actual-lot media, DB-enforced balance invariant `reserved + allocated ≤ available` under row locks (ADR-001 — never oversell; proven by tests E2–E5, E7).
- **QC / inspection**: queue, conflict-of-interest control with ops override + recorded reason, pinned grade-profile versions, accepted/rejected/held math, HOLD resolution with exact split.
- **Packing / dispatch**: pack records bounded by allocated quantity, atomic dispatch (lot buckets + line states + custody + order transition in one transaction), manual transport records (bus/rail/air/road modes, refs, ETA).
- **Custody events**: append-only chain (DB rules + triggers), auto events at QC handoff / pack / carrier handoff / destination receipt.
- **Cold chain (ADR-002)**: manual temperature excursions; CRITICAL opens a blocking exception that holds buyer acceptance AND supplier settlement until ops resolves with a note.
- **Delivery / POD**: one POD per shipment, duplicate-safe, order moves DELIVERED → ACCEPTANCE_PENDING → buyer acceptance (dispute-aware).
- **Manual external payments** (§22): RECORDED external records only, explicit "no gateway / no escrow", recorder ≠ verifier (§29, 403 SELF_VERIFY).
- **Manual supplier settlements** (§23): record → verify → complete; net = gross − deductions − claim adjustments; supplier self-dealing blocked; ADR-004 payout freeze enforced; COMPLETED rows immutable — corrections only via adjustment rows (ADR-003), trigger-enforced with money-field freeze during lifecycle steps.
- **Claims (§20)**: DRAFT → … → CLOSED lifecycle, supplier counterparty response, media evidence, terminal decisions written once to an immutable ledger, order flagged CLAIM_OPEN.
- **Operations Pilot Control Tower (§24)**: 15 aggregated exception queues over public contracts (read-only) + the minimal ops actions to clear them.
- **Frontend (React PWA, Build 3 patterns)**: Orders list/detail (buyer+supplier slice), Supplier fulfilment, My lots + lot detail (media/custody), QC queue workbench, Control Tower, Finance desk, Claims list/detail — all permission-gated, idempotency-keyed, mobile-first, with data-testids throughout.

## 2. Verification evidence

- **Build 4 gate suite** `test/e2e/build4-pilot.e2e-spec.ts`: **74/74 passing** — covers the mandatory scenarios: order conversion (A1–A8), allocation confirmation (B1–B5), lot invariants (C1–C10), QC logic incl. rejection/hold math + conflict control (D1–D11), allocation engine (E1–E8), packing/dispatch/POD atomicity + idempotent recovery (F1–F8), excursion HOLD gating (G1–G4), payments/settlements incl. SELF_VERIFY/SELF_DEALING/ADR-003/ADR-004 (H1–H9), claims (I1–I6), custody + tower (J1–J4).
- **Mandatory End-to-End Pilot Simulation (K1)**: full chain accepted-offer → order → lot → QC → allocate → pack → dispatch → POD → acceptance → claim w/ financial adjustment → external payment record+verify → settlement record/verify/complete → order SETTLED — with final balance, custody, status-history and audit-trail assertions. **Passing.**
- **Full regression**: `npx jest test/e2e --runInBand` → **196/196 across 11 suites** (Builds 0–4), including the migration reversibility gate (`zz-migrations`, down-all → up-all on a populated DB).
- **Frontend E2E** (testing agent, iterations 9–11): 7/7 final retest green — full pilot chain via UI (dispatch→POD→accept→claim), QC hold→resolve, temperature-exception hold→resolve, supplier-slice isolation, finance recording + SELF_VERIFY behavior, mobile 390px, Build 0–3 regression spot-checks.

## 3. Defects found and fixed during Build 4 hardening

1. **Tenant isolation (HIGH)**: `isOps` treated org-scoped `order.manage` as platform-ops → suppliers received the full buyer order slice. Now `procurement.manage` only (orders, shipments, packing, custody, inspections, lots reads).
2. **Custody listing had no authorization** — now lot owner or platform-ops only.
3. **Media contract**: `media_objects.id` ≠ `object_key` made signed raw URLs 404 — unified (`id == object_key`).
4. **QC complete replay**: state guard ran before the idempotency claim, so retries 409'd — claim now wins (replay-safe).
5. **Claims decision ledger**: every transition inserted a terminal decision row (CHECK/UNIQUE violations) — only APPROVED/REJECTED write it.
6. **Frozen Build-0 schema alignment** (migration 012 + live DBs, kept reversible): settlements blanket no-update trigger replaced by lifecycle-aware immutability (legacy/NULL-status and COMPLETED rows immutable; only RECORDED→VERIFIED→COMPLETED with money fields frozen); excursion severity CHECK gained `WARNING`; `duration_seconds ≥ 0` (unknown duration); `supply_lots.variety_id` nullable (commodity-level lots); 012 down() cleans pilot children in FK order behind trigger drop/recreate pairs.
7. **RBAC suspension gap**: Build 4 write permissions were missing from `TRANSACTIONAL_PERMISSIONS` — suspended orgs now lose Build 4 writes too.
8. **PROCUREMENT_OPS granted `claim.create`** so ops can actually read the claims the tower surfaces (transition permission `claim.manage` alone couldn't read).

Documented pilot simplifications: single-dispatch lot model; order rests at `ACCEPTANCE_PENDING` after POD awaiting explicit buyer acceptance; buyer-side payment recording requires finance/ops roles by design.

## 4. Out of scope — honored

No automated payment gateways, no escrow, no auto-success, no automated payouts, no AI, no reverse auctions. All money movement is a manual external record with dual-control verification.

## 5. ⛔ PILOT PRODUCTION BLOCKERS (open decisions)

- **OD-02 — Production authentication.** Build 4 shipped on the dev HMAC token stub (`/_baseline/dev-token`, `JWT_DEV_SECRET`). **Before any external-party pilot:** production IdP/session issuance and TOTP MFA for privileged roles must be wired, and the dev-token endpoint must be disabled outside dev/test.
- **OD-03 — Durable media storage.** Lot/QC/POD/claim evidence is stored on local disk (`/app/media`, MEDIA_LOCAL_DIR) with 5-min HMAC-signed URLs. **Before the production pilot:** move to durable object storage (S3/GCS-class) so evidence survives pod restarts and is durably auditable. The signed-URL contract is stable; only the storage backend changes.

## 6. Exit criteria status

| Criterion | Status |
|---|---|
| Pilot chain executable end-to-end via API + UI | ✅ (K1 + frontend iteration_11) |
| Lot/line/order/finance invariants test-enforced | ✅ 74-test gate |
| Builds 0–3 regression intact | ✅ 196/196 |
| Migrations reversible with pilot data present | ✅ zz-migrations |
| Ops control tower over all pilot exceptions | ✅ 15 queues |
| OD-02 / OD-03 explicitly flagged as production blockers | ✅ §5 |

**Build 4 is ACCEPTED for the internal/dev pilot. External production pilot remains blocked on OD-02 and OD-03 only.**
