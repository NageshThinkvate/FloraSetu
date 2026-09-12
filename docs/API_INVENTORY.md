# API Inventory — FloraSetu (as of Build 2)

All endpoints under `/api`. Bearer auth; org-scoped routes also require `X-Org-Id`. Standard error envelope `{error:{code,message,trace_id,details?}}`. Trace via `x-trace-id`.

## Health / baseline (Build 0; baseline dev+test only)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | /health | — | liveness + db |
| POST | /_baseline/dev-token | dev/test only | mints dev token |
| POST | /_baseline/entries | config.write | idempotency harness |
| GET | /_baseline/entries[/:id] | config.read | tenant-isolation harness |

## Auth (Build 1)
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /auth/register | — | email/password (bcrypt) → tokens |
| POST | /auth/login | — | 429 after 5 failures/15min; MFA_REQUIRED when enrolled |
| POST | /auth/refresh | — | rotating refresh tokens |
| POST | /auth/logout | — | revoke refresh |
| GET | /auth/me | user | profile + memberships + mfaActive |
| POST | /auth/mfa/enroll | user | TOTP secret (PENDING) |
| POST | /auth/mfa/verify | user | activates MFA |

## Identity & Party (Build 1)
| Method | Path | Permission |
|---|---|---|
| POST | /orgs | user (category-gated: platform cats need org.create.platform; EXPORTER/GOVERNMENT feature-gated) |
| GET | /orgs/mine | user |
| GET/PATCH | /orgs/:id | org.read / org.write (member only; 404 cross-org) |
| POST | /orgs/:id/branches | branch.write |
| POST | /orgs/:id/contacts | contact.write |
| GET/POST | /orgs/:id/members | member.read / member.invite |
| POST | /orgs/:id/members/accept/:membershipId | invited user |
| POST/DELETE | /orgs/:id/members/:userId/roles[...] | role.manage (ORG_ADMIN/MEMBER only — no platform roles) |
| POST | /orgs/:id/kyb/submit · GET /orgs/:id/kyb/history | kyb.submit / org.read |
| POST | /orgs/:id/bank/accounts | bank.write + supplier-side org (PENDING_REVERIFICATION + freeze) |
| GET | /orgs/:id/bank/accounts · /bank/change-requests | bank.read (masked; member or platform privileged) |
| POST | /orgs/:id/bank/change-requests/:rid/approve | bank.approve (dual, distinct approvers) |

## Platform admin (Build 1)
| Method | Path | Permission |
|---|---|---|
| GET | /admin/orgs | admin.org.read (masked fields only) |
| GET | /admin/orgs/:id | PLATFORM_ADMIN or SUPPORT_AGENT w/ active grant (audited) |
| POST | /admin/orgs/:id/restrict · /lift | restriction.manage (security-audited) |
| POST | /admin/support-sessions | support.access (immutable 30-min grant) |
| GET | /admin/audit[?orgId=] | audit.read |
| POST | /admin/kyb/:orgId/review | kyb.review |

## Catalog & Standards (Build 2) — DTO-validated (class-validator, whitelist)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | /catalog/search?q= | catalog.read | FTS + aliases → canonical products only |
| GET | /catalog/categories · /products[?category=] | catalog.read | |
| GET | /catalog/products/:id | catalog.read | aliases, varieties, grade/pack/conversion/handling versions, media refs |
| GET | /catalog/varieties/:id | catalog.read | resolves INACTIVE historical records too |
| GET/POST/DELETE | /catalog/capabilities | catalog.read / catalog.capability.write | supplier-side orgs, own-org only |
| GET | /catalog/admin/masters | catalog.write | units, attributes, defects, colours |
| POST | /catalog/admin/categories · products · aliases · colours · varieties · units | catalog.write | alias conflicts 409 (case-insensitive) |
| POST | /catalog/admin/conversions | catalog.write | factor>0, from≠to, no unknown/inactive UoM, no circular chains, no ACTIVE overlap |
| POST | /catalog/admin/packs · grade-profiles · handling-profiles | catalog.write | auto version_no; overlap 409; grade rules validated against attribute dictionary |
| POST | /catalog/admin/quality-attributes · defect-types | catalog.write | |
| POST | /catalog/admin/transport-rules | catalog.write | compatibility metadata only (no shipment blocking) |
| PATCH | /catalog/admin/products/:id/launch-flags | catalog.write | launch_enabled + launch_cities |
| PATCH | /catalog/admin/:entity/:id/status | catalog.write | entities: commodities, varieties, grade_profiles, pack_definitions, unit_conversions, handling_profiles |
| GET | /catalog/admin/versions/:entity | catalog.write | version history for the 4 versioned entities |

All catalog writes are audited (core.audit_events, trace_id) and publish `catalog.standard.published`/`catalog.product.created` outbox events.

## Demand / RFQ (Build 3) — DTO-validated, idempotent writes (Idempotency-Key header)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | /catalog/units | authenticated | ACTIVE UoM list for pickers |
| POST/GET | /demand/events | event.write / event.read | |
| GET/PATCH | /demand/events/:id | event.read / event.write | cross-org 404 |
| POST | /demand/events/:id/ceremonies · /bom-lines | event.write | BOM validates commodity + ceremony scope |
| POST/GET | /demand/requirements | demand.write / demand.read | lines carry master_snapshot; 400 UOM_REQUIRED / MASTER_NOT_COMMERCIAL |
| GET | /demand/requirements/:id | demand.read | lines, versions, awardedByLine |
| POST | /demand/requirements/:id/submit | demand.submit | idempotent; QUICK auto-publishes managed RFQ |
| POST | /demand/requirements/:id/revise | demand.write | invalidates open quotes; ops override → consent_required |
| POST | /demand/requirements/:id/evaluate | quote.evaluate | QUOTING/CLARIFICATION → EVALUATION |
| POST | /demand/requirements/:id/consent · /cancel | demand.write | cancel cascades RFQ/quotes/awards |
| POST | /demand/requirements/:id/publish-rfq | rfq.publish | idempotent; one open RFQ per requirement (409) |
| GET | /demand/rfqs · /demand/rfqs/inbox | rfq.read | buyer list / supplier invitations |
| GET | /demand/rfqs/:id | rfq.read | supplier view excludes competitor data |
| POST | /demand/rfqs/:id/viewed · /intend · /decline · /cancel | rfq.read / quote.submit / rfq.read / rfq.publish | decline requires reason |
| POST/GET | /demand/rfqs/:id/clarifications | rfq.read | visibility BUYER_PRIVATE/PUBLIC |
| POST | /demand/clarifications/:id/respond | rfq.read | buyer/ops only; single answer (409) |
| POST | /demand/rfqs/:id/quotes | quote.submit | idempotent; deadline + invitation + stale-version guards; 23505 race → 409 |
| GET | /demand/quotes · /demand/quotes/:id | quote.read | owner/buyer/ops only |
| POST | /demand/quotes/:id/revise | quote.submit | supersedes current version; originals immutable |
| GET | /demand/rfqs/:id/comparison | quote.evaluate | originals + normalization metadata; landed-cost INDICATIVE |
| POST/GET | /demand/rfqs/:id/awards | award.create / award.read | idempotent; Σ ≤ requirement qty; deviation consent; supplier sees own lines |
| POST | /demand/awards/:id/prepare-order | award.read | inert CreateOrderFromAward (PENDING_BUILD_5) |
| GET | /demand/ops/desk | procurement.manage | cross-tenant queues + deadline risk |
| POST/GET | /demand/ops/requirements/:id/sourcing-notes | procurement.manage | audited |
