# Open Decisions — FloraSetu

## Resolved (Build 0 freeze)
| ID | Topic | Status |
|----|-------|--------|
| ADR-001 | Quantity / partial fill | **RESOLVED — OWNER APPROVED** |
| ADR-002 | Cold-chain excursion handling | **RESOLVED — OWNER APPROVED** |
| ADR-003 | Post-settlement claims | **RESOLVED — OWNER APPROVED** |
| ADR-004 | Payout / bank change safety | **RESOLVED — OWNER APPROVED** |
| ADR-005 | Duplicate webhook handling | **RESOLVED — OWNER APPROVED** |
| ADR-006 | Mobile convertibility | **RESOLVED — OWNER APPROVED** |

## Genuinely open (third-party providers — intentionally unselected in Build 0)
| ID | Topic | Options | Blocked work |
|----|-------|---------|--------------|
| OD-01 | Payment/settlement provider | TBD (Build 1+) | Live payments; recovery mechanism (ADR-003 mechanism deferred) |
| OD-02 | OIDC identity provider | TBD | Production auth; MFA enforcement (schema is MFA-ready) |
| OD-03 | S3-compatible object storage endpoint | TBD | Real media signing (Build 0: interface + stub signer) |
| OD-04 | Web push VAPID / FCM / APNs credentials | TBD | Live push delivery (gateway abstraction ready) |
| OD-05 | Webhook providers needing signature schemes | TBD | Concrete verifier configs (interface + HMAC verifier shipped) |
| OD-06 | e-NAM / government integrations | explicitly out of Build 0 | — |
| OD-07 | Buyer-side UoM default | **RESOLVED — OWNER APPROVED** (Pre-Build-3 gate): no hidden universal default; every commercial line persists explicit `uom_id`; `preferred_order_uom_id` is UI preselection only; supplier quotes preserve original qty/uom + conversion version; normalization only via active version-controlled conversion |
| OD-08 | DEMO→VALIDATED promotion | **RESOLVED — OWNER APPROVED** (Pre-Build-3 gate): `validation_status` lifecycle DEMO→PENDING_REVIEW→VALIDATED/REJECTED, separate from lifecycle `status`; requested/reviewed metadata + evidence; reviewer ≠ proposer on grade/handling/conversion masters; `catalog.validate` permission + CATALOG_VALIDATOR role; production use requires ACTIVE+VALIDATED unless env enables demo masters |

Ambiguities documented during Build 2 (did not block implementation):
- "Search" scope limited to canonical product + alias + variety name fields; faceted analytics search deferred to measured need (Postgres FTS chosen, no OpenSearch).
- Substitution attributes stored as `commodities.substitution_defaults` JSONB foundation; no substitution logic anywhere (per Master rule).

None of these block Build 0 acceptance. All must be decided before their feature phase.
