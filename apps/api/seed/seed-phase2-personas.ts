// Dev-only Phase 2 persona seed (UX-ADR-001 workspace routing validation).
// Gated hard on NODE_ENV=development — never production data.
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

if (process.env.NODE_ENV !== 'development') {
  console.error('seed-phase2-personas is dev-only (NODE_ENV=development required)');
  process.exit(1);
}

const PERSONAS: { ref: string; email: string; password: string; name: string }[] = [
  { ref: 'USR-2026-000101', email: 'demo.buyer@florasetu.dev', password: 'Demo-Buyer-2026', name: 'Demo Buyer' },
  { ref: 'USR-2026-000102', email: 'demo.supplier@florasetu.dev', password: 'Demo-Supplier-2026', name: 'Demo Supplier' },
  { ref: 'USR-2026-000103', email: 'demo.dual@florasetu.dev', password: 'Demo-Dual-2026', name: 'Demo Dual Trader' },
  { ref: 'USR-2026-000104', email: 'demo.qc@florasetu.dev', password: 'Demo-Qc-2026', name: 'Demo QC Partner' },
  { ref: 'USR-2026-000105', email: 'demo.procops@florasetu.dev', password: 'Demo-ProcOps-2026', name: 'Demo Procurement Ops' },
  { ref: 'USR-2026-000106', email: 'demo.finance@florasetu.dev', password: 'Demo-Finance-2026', name: 'Demo Finance Ops' },
  { ref: 'USR-2026-000107', email: 'demo.admin@florasetu.dev', password: 'Demo-Admin-2026', name: 'Demo Platform Admin' },
  { ref: 'USR-2026-000108', email: 'demo.opsadmin@florasetu.dev', password: 'Demo-OpsAdmin-2026', name: 'Demo Ops + Admin' },
  { ref: 'USR-2026-000109', email: 'demo.multi@florasetu.dev', password: 'Demo-Multi-2026', name: 'Demo Multi Org' },
  { ref: 'USR-2026-000110', email: 'demo.logistics@florasetu.dev', password: 'Demo-Logistics-2026', name: 'Demo Logistics Admin' },
  { ref: 'USR-2026-000111', email: 'demo.driver@florasetu.dev', password: 'Demo-Driver-2026', name: 'Demo Driver' },
  { ref: 'USR-2026-000112', email: 'demo.driver2@florasetu.dev', password: 'Demo-Driver2-2026', name: 'Demo Driver Two' }
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Demo organizations with EXPLICIT capabilities (never category-derived assumptions).
    await client.query(`
      INSERT INTO identity.organizations (ref, name, type, capabilities) VALUES
        ('ORG-2026-000101', 'Ooty Floral Trading', 'WHOLESALER', ARRAY['BUYER','SUPPLIER']),
        ('ORG-2026-000102', 'Hill Station QC Services', 'QC_PARTNER', ARRAY['PARTNER_QC']),
        ('ORG-2026-000103', 'Nilgiri Fresh Logistics', 'LOGISTICS_PROVIDER', ARRAY['PARTNER_LOGISTICS'])
      ON CONFLICT (ref) DO UPDATE SET capabilities = EXCLUDED.capabilities;

      UPDATE identity.organizations SET capabilities = ARRAY['BUYER'] WHERE ref = 'ORG-2026-000001';
      UPDATE identity.organizations SET capabilities = ARRAY['SUPPLIER'] WHERE ref = 'ORG-2026-000002';
    `);

    for (const p of PERSONAS) {
      const hash = await bcrypt.hash(p.password, 10);
      const u = await client.query<{ id: string }>(
        `INSERT INTO identity.users (ref, email, display_name) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
        [p.ref, p.email, p.name]
      );
      const userId = u.rows[0].id;
      await client.query(
        `INSERT INTO identity.user_credentials (user_id, password_hash) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, password_changed_at = now()`,
        [userId, hash]
      );
      await client.query(
        `INSERT INTO identity.auth_identities (user_id, provider, subject) VALUES ($1, 'password', $2)
         ON CONFLICT (provider, subject) DO NOTHING`,
        [userId, p.email]
      );
    }

    const member = async (userRef: string, orgRef: string): Promise<void> => {
      await client.query(
        `INSERT INTO identity.org_memberships (org_id, user_id, status)
         SELECT o.id, u.id, 'ACTIVE' FROM identity.organizations o, identity.users u
         WHERE o.ref = $1 AND u.ref = $2
         ON CONFLICT (org_id, user_id) DO NOTHING`,
        [orgRef, userRef]
      );
    };
    const role = async (userRef: string, orgRef: string, roleName: string): Promise<void> => {
      await client.query(
        `INSERT INTO identity.user_roles (user_id, role_id, org_id)
         SELECT u.id, r.id, o.id FROM identity.users u, identity.roles r, identity.organizations o
         WHERE u.ref = $1 AND r.name = $2 AND r.org_id IS NULL AND o.ref = $3
         ON CONFLICT (user_id, role_id, org_id) DO NOTHING`,
        [userRef, roleName, orgRef]
      );
    };

    // A. buyer-only / B. supplier-only / C. dual-capability / D. QC partner
    await member('USR-2026-000101', 'ORG-2026-000001');
    await role('USR-2026-000101', 'ORG-2026-000001', 'ORG_ADMIN');
    await member('USR-2026-000102', 'ORG-2026-000002');
    await role('USR-2026-000102', 'ORG-2026-000002', 'ORG_ADMIN');
    await member('USR-2026-000103', 'ORG-2026-000101');
    await role('USR-2026-000103', 'ORG-2026-000101', 'ORG_ADMIN');
    await member('USR-2026-000104', 'ORG-2026-000102');
    await role('USR-2026-000104', 'ORG-2026-000102', 'ORG_ADMIN');
    await role('USR-2026-000104', 'ORG-2026-000102', 'QC_AGENT');

    // J/K. logistics partner admin + driver (ADR-011 partner = logistics)
    // Phase 5 (ADR-012): second same-org driver member for assignment/reassignment demos.
    await member('USR-2026-000110', 'ORG-2026-000103');
    await role('USR-2026-000110', 'ORG-2026-000103', 'ORG_ADMIN');
    await member('USR-2026-000111', 'ORG-2026-000103');
    await role('USR-2026-000111', 'ORG-2026-000103', 'MEMBER');
    await member('USR-2026-000112', 'ORG-2026-000103');
    await role('USR-2026-000112', 'ORG-2026-000103', 'MEMBER');

    // E/F/G/H on the platform org
    await member('USR-2026-000105', 'ORG-2026-000000');
    await role('USR-2026-000105', 'ORG-2026-000000', 'PROCUREMENT_OPS');
    await member('USR-2026-000106', 'ORG-2026-000000');
    await role('USR-2026-000106', 'ORG-2026-000000', 'FINANCE_OPS');
    await member('USR-2026-000107', 'ORG-2026-000000');
    await role('USR-2026-000107', 'ORG-2026-000000', 'PLATFORM_ADMIN');
    await member('USR-2026-000108', 'ORG-2026-000000');
    await role('USR-2026-000108', 'ORG-2026-000000', 'PLATFORM_ADMIN');
    await role('USR-2026-000108', 'ORG-2026-000000', 'PROCUREMENT_OPS');

    // I. multi-org user: buyer org + supplier org + dual-capability org
    await member('USR-2026-000109', 'ORG-2026-000001');
    await role('USR-2026-000109', 'ORG-2026-000001', 'ORG_ADMIN');
    await member('USR-2026-000109', 'ORG-2026-000002');
    await role('USR-2026-000109', 'ORG-2026-000002', 'ORG_ADMIN');
    await member('USR-2026-000109', 'ORG-2026-000101');
    await role('USR-2026-000109', 'ORG-2026-000101', 'ORG_ADMIN');

    // Managed sourcing (QUICK auto-publish) matches suppliers via catalog capabilities —
    // grant the demo supplier orgs capability for every demo variety.
    await client.query(
      `INSERT INTO catalog.supplier_product_capabilities (org_id, variety_id, status, created_by)
       SELECT o.id, v.id, 'ACTIVE', u.id
       FROM identity.organizations o
       CROSS JOIN catalog.varieties v
       CROSS JOIN LATERAL (SELECT id FROM identity.users WHERE email = 'demo.supplier@florasetu.dev') u
       WHERE o.ref IN ('ORG-2026-000002', 'ORG-2026-000101')
       ON CONFLICT (org_id, variety_id) DO NOTHING`
    );

    await client.query(`
      INSERT INTO core.reference_counters (entity, year, next_value) VALUES
        ('USR', 2026, 113), ('ORG', 2026, 104)
      ON CONFLICT (entity, year) DO UPDATE
        SET next_value = GREATEST(core.reference_counters.next_value, EXCLUDED.next_value);
    `);

    await client.query('COMMIT');
    console.log('phase2 personas seeded');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
