#!/bin/bash
# Re-provisions Build 0 infra after a pod restart (apt packages and PG data live outside /app).
set -e
export DEBIAN_FRONTEND=noninteractive

if ! command -v psql >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq postgresql-15 postgresql-15-postgis-3 redis-server
fi

pg_ctlcluster 15 main start 2>/dev/null || true
redis-server --daemonize yes --port 6379 2>/dev/null || true

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='florasetu'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER florasetu WITH PASSWORD 'florasetu_dev';"
fi
for db in florasetu florasetu_test; do
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    sudo -u postgres createdb -O florasetu "$db"
  fi
  sudo -u postgres psql -d "$db" -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto;" >/dev/null
done

cd /app/apps/api && NODE_ENV=development node scripts/migrate.js up
echo "infra ready: postgresql+postgis, redis, migrations applied"
