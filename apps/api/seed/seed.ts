// Dev-only seed. Gated hard on NODE_ENV=development — never runs in test/staging/prod.
import { Pool } from 'pg';

if (process.env.NODE_ENV !== 'development') {
  console.error('seed is dev-only (NODE_ENV=development required)');
  process.exit(1);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO identity.organizations (ref, name, type) VALUES
        ('ORG-2026-000001', 'Dev Buyer Co', 'BUYER'),
        ('ORG-2026-000002', 'Dev Supplier Co', 'SUPPLIER')
      ON CONFLICT (ref) DO NOTHING;

      INSERT INTO identity.users (ref, email, display_name) VALUES
        ('USR-2026-000001', 'buyer@dev.florasetu.local', 'Dev Buyer'),
        ('USR-2026-000002', 'supplier@dev.florasetu.local', 'Dev Supplier')
      ON CONFLICT (email) DO NOTHING;

      INSERT INTO identity.permissions (code, description) VALUES
        ('config.read', 'Read config entries'),
        ('config.write', 'Write config entries'),
        ('audit.read', 'Read audit events')
      ON CONFLICT (code) DO NOTHING;

      INSERT INTO catalog.units_of_measure (code, name) VALUES
        ('STEM', 'Stem'), ('KG', 'Kilogram'), ('BOX', 'Box')
      ON CONFLICT (code) DO NOTHING;

      INSERT INTO core.feature_flags (key, enabled, valid_from) VALUES
        ('build0.baseline', true, now())
      ON CONFLICT DO NOTHING;
    `);
    await client.query(`
      INSERT INTO identity.org_memberships (org_id, user_id, status)
      SELECT o.id, u.id, 'ACTIVE'
      FROM identity.organizations o, identity.users u
      WHERE (o.ref = 'ORG-2026-000001' AND u.email = 'buyer@dev.florasetu.local')
         OR (o.ref = 'ORG-2026-000002' AND u.email = 'supplier@dev.florasetu.local')
      ON CONFLICT (org_id, user_id) DO NOTHING;
    `);
    await client.query('COMMIT');
    console.log('seed complete');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
