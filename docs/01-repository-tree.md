# 01 — Repository Tree (Build 0, LOCKED)

Monorepo. Two deployables + shared contracts. No native code (ADR-006).

```
/app
├── apps/
│   ├── api/                          # NestJS modular monolith (Node.js + TypeScript)
│   │   ├── src/
│   │   │   ├── main.ts               # bootstrap: trace-ID middleware → pipes → filters → listen :8001
│   │   │   ├── app.module.ts         # root module; imports infra + 12 bounded contexts
│   │   │   ├── config/               # env-validated configuration (joi), per-env loaders
│   │   │   ├── common/               # cross-cutting infra (framework-level, domain-free)
│   │   │   │   ├── errors/           # standard error envelope + exception filter
│   │   │   │   ├── tracing/          # correlation/trace-ID middleware (AsyncLocalStorage)
│   │   │   │   ├── idempotency/      # idempotency framework (key store + interceptor)
│   │   │   │   ├── audit/            # immutable audit event writer + security audit stream
│   │   │   │   ├── outbox/           # transactional outbox writer + relay
│   │   │   │   ├── flags/            # feature flags (effective-dated)
│   │   │   │   ├── authz/            # RBAC + ABAC/object-level guards, org isolation
│   │   │   │   ├── concurrency/      # optimistic concurrency + row-lock helpers
│   │   │   │   ├── media/            # signed-URL media access abstraction (S3-compatible)
│   │   │   │   ├── realtime/         # WebSocket/SSE abstraction (interface only, Build 0)
│   │   │   │   ├── device/           # device capability abstraction (camera/push) — interface only
│   │   │   │   └── pagination/       # cursor pagination, reference-ID codec
│   │   │   ├── modules/              # 12 STRICT BOUNDED CONTEXTS (see 03-module-boundaries.md)
│   │   │   │   ├── identity-party/
│   │   │   │   ├── catalog-standards/
│   │   │   │   ├── supply-inventory/
│   │   │   │   ├── demand-rfq/
│   │   │   │   ├── auction-market/
│   │   │   │   ├── order-allocation/
│   │   │   │   ├── quality-traceability/
│   │   │   │   ├── logistics-coldchain/
│   │   │   │   ├── payments-settlement/
│   │   │   │   ├── claims-support/
│   │   │   │   ├── notifications/
│   │   │   │   └── analytics-controltower/
│   │   │   │       # each context: contracts/ (public API), internal/ (impl), *.module.ts
│   │   │   └── workers/              # outbox relay, queue worker (async)
│   │   ├── migrations/               # node-pg-migrate SQL migrations (up/down)
│   │   ├── seed/                     # dev-only seed (gated by NODE_ENV=development)
│   │   ├── test/                     # unit, architecture (anti-coupling), baseline e2e
│   │   ├── .env.development / .env.test / .env.staging / .env.production
│   │   └── package.json / tsconfig.json / nest-cli.json / .eslintrc.js
│   └── web/                          # React + TypeScript, mobile-first PWA shell (Vite)
│       ├── src/
│       │   ├── main.tsx / App.tsx
│       │   ├── shell/                # PWA shell: layout, module navigator (scaffold only)
│       │   ├── lib/api/              # typed API client, bearer-token auth (OIDC-ready, no cookie-only)
│       │   └── lib/platform/         # device abstraction mirrors (camera/push) — interface only
│       ├── public/manifest.webmanifest / icons
│       ├── vite.config.ts / tsconfig.json / package.json / .eslintrc.cjs
│       └── .env.development / .env.test / .env.staging / .env.production
├── docs/                             # Build 0 docs-first deliverables 01–11
├── ARCHITECTURE_DECISIONS.md         # ADR-001…006 (RESOLVED — OWNER APPROVED)
├── OPEN_DECISIONS.md                 # 5 RESOLVED + genuinely open items
├── DOMAIN_MODEL.md                   # Master domain ERD narrative + invariants
├── REQUIREMENTS_TRACEABILITY_MATRIX.md
├── IMPLEMENTATION_STATUS.md
├── TEST_TRACEABILITY.md
└── .github/workflows/ci.yml          # CI baseline (build/typecheck/lint/test/migrations)
```

## Rules
- `apps/api/src/modules/*` may never import from another context's `internal/` — only `contracts/`. Enforced by architecture tests (`apps/api/test/architecture/`).
- `common/` contains zero domain concepts; contexts never import each other's tables.
- Legacy `/app/frontend` + `/app/backend` (env template) are left untouched; supervisor is repointed to `apps/api` (:8001) and `apps/web` (:3000).
