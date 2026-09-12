// GATE REQ-DB-01: migrations fully reversible — down then up on the test DB.
// Named zz-* so it runs last under --runInBand.
import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env.test') });

describe('GATE: migrations up/down', () => {
  const cwd = path.resolve(__dirname, '..', '..');
  const env = { ...process.env, NODE_ENV: 'test' };

  it('down (all) then up (all) succeeds and restores the schema', async () => {
    execSync('node scripts/migrate.js down', { cwd, env, stdio: 'pipe' });
    execSync('node scripts/migrate.js up', { cwd, env, stdio: 'pipe' });

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const tables = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.tables
         WHERE table_schema IN ('core','identity','catalog','supply','demand','auction','ordering',
                                'quality','logistics','payments','claims','notifications','analytics')`
      );
      expect(Number(tables.rows[0].n)).toBeGreaterThanOrEqual(60);
      const migrations = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM public.schema_migrations');
      expect(Number(migrations.rows[0].n)).toBe(6);
    } finally {
      await pool.end();
    }
  });
});
