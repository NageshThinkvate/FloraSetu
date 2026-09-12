# Auth Testing Playbook — FloraSetu (NestJS + PostgreSQL + Redis)

Build 1 auth: email/password (bcrypt), HMAC bearer tokens (access 15min + refresh 7d, rotation), TOTP MFA for privileged users, Redis login lockout (5 failures → 15 min), org context via `X-Org-Id` header resolved from DB membership.

## Endpoints (all under /api)
- POST /auth/register `{email,password,displayName}` → `{userId, accessToken, refreshToken, expiresIn}`
- POST /auth/login `{email,password,mfaCode?}` → tokens; 401 INVALID_CREDENTIALS / MFA_REQUIRED; 429 RATE_LIMITED after 5 failures
- POST /auth/refresh `{refreshToken}` → rotated pair (old refresh is revoked)
- POST /auth/logout `{refreshToken}`
- GET /auth/me (Bearer)
- POST /auth/mfa/enroll (Bearer) → `{secret, otpauthUrl}`
- POST /auth/mfa/verify (Bearer) `{code}`
- Org routes need `X-Org-Id: <org uuid>` + Bearer; permissions resolved from membership roles in DB.

## Quick verification
```
BASE=https://a58e29e4-b933-42ad-bc57-a163f74143ee.preview.emergentagent.com
curl -X POST $BASE/api/auth/register -H 'content-type: application/json' -d '{"email":"t1@x.co","password":"Passw0rd1234","displayName":"T"}'
# → use accessToken as Bearer; create org: POST /api/orgs {name, category}
```

## DB verification
```
psql postgresql://florasetu:florasetu_dev@localhost:5432/florasetu
SELECT email, status FROM identity.users;
SELECT user_id, left(password_hash,4) FROM identity.user_credentials;  -- bcrypt $2b$
SELECT provider, subject FROM identity.auth_identities;
```

## Admin (platform owner)
Seeded in dev only via `yarn seed` (apps/api): see /app/memory/test_credentials.md.
PLATFORM_OPS org `FloraSetu Platform` (ref ORG-2026-000000) with PLATFORM_ADMIN role.
Send `X-Org-Id: <platform org id>` for admin endpoints.

## Suites
- `yarn test` in /app/apps/api — 17 suites incl. build1-identity.e2e-spec.ts (auth, MFA, rate-limit, tenancy, IDOR, privilege escalation, bank dual-approval, suspension, support access).
