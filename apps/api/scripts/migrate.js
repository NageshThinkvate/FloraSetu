// Migration runner (up/down) over core.schema_migrations. No external dependency.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const envFile = process.env.MIGRATE_ENV_FILE || `.env.${process.env.NODE_ENV || 'development'}`;
require('dotenv').config({ path: path.resolve(__dirname, '..', envFile) });

const direction = process.argv[2];
if (!['up', 'down'].includes(direction)) {
  console.error('usage: node scripts/migrate.js up|down');
  process.exit(1);
}

const migrationsDir = path.resolve(__dirname, '..', 'migrations');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);

    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.js')).sort();
    const applied = await client.query('SELECT name FROM public.schema_migrations');
    const appliedSet = new Set(applied.rows.map((r) => r.name));

    if (direction === 'up') {
      for (const file of files) {
        if (appliedSet.has(file)) continue;
        const migration = require(path.join(migrationsDir, file));
        console.log(`up: ${file}`);
        await client.query('BEGIN');
        try {
          await migration.up(client);
          await client.query('INSERT INTO public.schema_migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    } else {
      const toRevert = files.filter((f) => appliedSet.has(f)).reverse();
      const steps = process.argv[3] ? Number(process.argv[3]) : toRevert.length;
      for (const file of toRevert.slice(0, steps)) {
        const migration = require(path.join(migrationsDir, file));
        console.log(`down: ${file}`);
        await client.query('BEGIN');
        try {
          await migration.down(client);
          await client.query('DELETE FROM public.schema_migrations WHERE name = $1', [file]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      }
    }
    console.log('done');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
