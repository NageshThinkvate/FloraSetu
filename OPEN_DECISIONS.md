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

None of these block Build 0 acceptance. All must be decided before their feature phase.
