# Screen Inventory — FloraSetu (as of Build 2)

Mobile-first PWA. All screens verified at 360/390/412 px (no horizontal overflow, 44px touch targets, selects in viewport, status never by colour alone — DEMO/VALIDATED shown as text chips).

| Route | Screen | Access | data-testid anchors |
|---|---|---|---|
| / | Build shell — 12 context tiles + API health | public | app-shell, module-tile-* |
| /login | Sign in (+ MFA code step) | public | login-form, login-mfa |
| /register | Account creation | public | register-form |
| /onboarding | Create organization (gated categories disabled) | authed | onboarding-form, onboarding-category |
| /account | Profile, MFA setup, org switcher, members+invites, KYB submit, bank/payout profile (supplier-side) | authed | account-page, members-panel, bank-panel |
| /admin | Platform admin: masked org table, KYB review, suspend/lift, bank change approvals | platform roles | admin-orgs-table, admin-org-detail |
| /catalog | B2B catalog: FTS search (products/commercial names/aliases), canonical product detail (varieties, grade/pack/conversion/handling versions, DEMO badges) | catalog.read | catalog-search-form, catalog-product-*, catalog-detail |
| /catalog/admin | Catalog master-data admin: categories, products, aliases, units, attributes, defects, conversions, grade/handling versions, launch flags, version history | catalog.write | catalog-admin-page, *-form, versions-list |
| /catalog/capabilities | Supplier "products we handle" (own org only) | catalog.capability.write | capabilities-list, capability-form |

Explicitly absent by spec (Build 2): cart, checkout, pricing, gifting, bouquet builder, retail catalogue, order placement.
