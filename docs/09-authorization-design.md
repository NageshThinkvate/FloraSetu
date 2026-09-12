# 09 — Authorization Design

## Model: org isolation + RBAC + ABAC/object-level checks

### 1. Authentication (ADR-006 compliant)
Bearer-token/OIDC only — **no cookie-only sessions** (tokens must work in native webviews later). `IP.auth_identities` maps `(provider, subject)` → user. Build 0 ships a dev JWT provider behind the same `AuthTokenVerifier` interface; production OIDC provider remains an open decision.

### 2. Org isolation (tenant boundary)
- Every request resolves an `OrgContext` = `{ orgId, userId, roles, permissions }` from token + membership; stored in AsyncLocalStorage.
- Every tenant-owned table has `org_id`; repositories receive orgId from context and inject `WHERE org_id = $n` — there is no API path to bypass it.
- Cross-org access (admin/control tower) requires the explicit `org.impersonate` permission and is security-audited.

### 3. RBAC
`permissions (code) ← role_permissions ← roles ← user_roles`. System roles: `ORG_ADMIN, BUYER, SUPPLIER, QC_AGENT, LOGISTICS_OPS, FINANCE_OPS, SUPPORT_AGENT, READONLY`. Guards: `@RequirePermission('supply.lot.write')`.

### 4. ABAC / object-level authz
Attribute checks beyond role: ownership (supplier can act only on own lots), counterparty visibility (buyer sees only RFQs they're invited to / orders they own), state guards (payout actions only in allowed states). Implemented as policy functions next to each context's service (`internal/policies.ts`), evaluated after RBAC passes; denials → `core.security_audit_events`.

### 5. Privileged actions
- MFA-ready: privileged roles (`ORG_ADMIN`, `FINANCE_OPS`) may be flagged `mfa_required`; enrollment table exists, enforcement flag off until OIDC provider chosen (recorded in OPEN_DECISIONS).
- Dual approval: bank change verification requires two distinct approvers (DB CHECK `approver_1_id <> approver_2_id`) — ADR-004.
- Every privileged action writes to both audit streams.

### 6. API surface controls
Rate limiting (Redis token bucket per org+user+IP at gateway middleware), standard error envelope (`403 FORBIDDEN` / `404 NOT_FOUND` — existence of cross-org objects is never revealed; cross-org reads return 404), CORS allowlist per env, signed media URLs (short-lived, per-object authz check before signing).

### 7. Webhook ingress
Separate channel: signature verification pre-transaction (ADR-005), no session context; the handler establishes a system actor for audit.
