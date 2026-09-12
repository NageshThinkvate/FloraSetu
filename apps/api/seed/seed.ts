// Dev-only seed. Gated hard on NODE_ENV=development — never runs in test/staging/prod.
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';

if (process.env.NODE_ENV !== 'development') {
  console.error('seed is dev-only (NODE_ENV=development required)');
  process.exit(1);
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const adminEmail = (process.env.ADMIN_EMAIL ?? '').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? '';
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO identity.organizations (ref, name, type) VALUES
        ('ORG-2026-000001', 'Dev Buyer Co', 'BUYER'),
        ('ORG-2026-000002', 'Dev Supplier Co', 'GROWER'),
        ('ORG-2026-000000', 'FloraSetu Platform', 'PLATFORM_OPS')
      ON CONFLICT (ref) DO NOTHING;

      INSERT INTO identity.users (ref, email, display_name) VALUES
        ('USR-2026-000001', 'buyer@dev.florasetu.local', 'Dev Buyer'),
        ('USR-2026-000002', 'supplier@dev.florasetu.local', 'Dev Supplier')
      ON CONFLICT (email) DO NOTHING;

      INSERT INTO identity.permissions (code, description) VALUES
        ('config.read', 'Read config entries'),
        ('config.write', 'Write config entries')
      ON CONFLICT (code) DO NOTHING;

      INSERT INTO catalog.units_of_measure (code, name) VALUES
        ('STEM', 'Stem'), ('KG', 'Kilogram'), ('BOX', 'Box')
      ON CONFLICT (code) DO NOTHING;

      INSERT INTO core.feature_flags (key, enabled, valid_from) VALUES
        ('build0.baseline', true, now()),
        ('org.exporter_government', false, now())
      ON CONFLICT DO NOTHING;

      -- Align public-ref counters with seeded rows (prevents duplicate ref keys).
      INSERT INTO core.reference_counters (entity, year, next_value) VALUES
        ('USR', 2026, 3), ('ORG', 2026, 3)
      ON CONFLICT (entity, year) DO UPDATE
        SET next_value = GREATEST(core.reference_counters.next_value, EXCLUDED.next_value);
    `);
    await client.query(`
      INSERT INTO identity.org_memberships (org_id, user_id, status)
      SELECT o.id, u.id, 'ACTIVE'
      FROM identity.organizations o, identity.users u
      WHERE (o.ref = 'ORG-2026-000001' AND u.email = 'buyer@dev.florasetu.local')
         OR (o.ref = 'ORG-2026-000002' AND u.email = 'supplier@dev.florasetu.local')
      ON CONFLICT (org_id, user_id) DO NOTHING;
    `);
    // Platform owner account (env-provided credentials; no shared passwords).
    if (adminEmail && adminPassword) {
      const hash = await bcrypt.hash(adminPassword, 10);
      const upserted = await client.query<{ id: string }>(
        `INSERT INTO identity.users (ref, email, display_name)
         VALUES ('USR-2026-000000', $1, 'Platform Owner')
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [adminEmail]
      );
      const adminId = upserted.rows[0].id;
      await client.query(
        `INSERT INTO identity.user_credentials (user_id, password_hash) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, password_changed_at = now()`,
        [adminId, hash]
      );
      await client.query(
        `INSERT INTO identity.auth_identities (user_id, provider, subject) VALUES ($1, 'password', $2)
         ON CONFLICT (provider, subject) DO NOTHING`,
        [adminId, adminEmail]
      );
      await client.query(
        `INSERT INTO identity.org_memberships (org_id, user_id, status)
         SELECT o.id, $1, 'ACTIVE' FROM identity.organizations o WHERE o.ref = 'ORG-2026-000000'
         ON CONFLICT (org_id, user_id) DO NOTHING`,
        [adminId]
      );
      await client.query(
        `INSERT INTO identity.user_roles (user_id, role_id, org_id)
         SELECT $1, r.id, o.id FROM identity.roles r, identity.organizations o
         WHERE r.name = 'PLATFORM_ADMIN' AND r.org_id IS NULL AND o.ref = 'ORG-2026-000000'
         ON CONFLICT (user_id, role_id, org_id) DO NOTHING`,
        [adminId]
      );
    }
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
