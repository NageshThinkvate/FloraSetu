# Master Spec Reference — FloraSetu

**Single source of truth: FloraSetu Master Specification v2.0** (owner-held document).

This repository implements Master v2.0 incrementally via locked builds:

| Build | Scope | Status |
|-------|-------|--------|
| Build 0 | Architecture freeze (12 bounded contexts, infra, gates) | PASS (2026-06) |
| Build 1 | Identity, Party, Organizations & RBAC | PASS (2026-06) |
| Build 2 | Catalog & Standards (canonical product/quality/packaging/UoM/handling master data) | PASS (2026-06) |

Administrative metadata:
- Master Spec v2.0 text is not duplicated here; deviations require explicit owner approval and are logged in ARCHITECTURE_DECISIONS.md.
- Approved deviation log: backend tooling NestJS+PostgreSQL+Redis (vs env default FastAPI+MongoDB) — owner-approved in Build 0.
- Build authorization is granted per-build by owner instruction.
