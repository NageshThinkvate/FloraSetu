// Ensures the test DB is migrated before any suite runs (idempotent).
import { execSync } from 'child_process';
import * as path from 'path';

export default function globalSetup(): void {
  if (process.env.SKIP_MIGRATE === '1') {
    return;
  }
  execSync('node scripts/migrate.js up', {
    cwd: path.resolve(__dirname, '..', '..'),
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'inherit'
  });
}
