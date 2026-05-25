#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MIGRATIONS_DIR="${ROOT_DIR}/migrations"

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

for migration in "${MIGRATIONS_DIR}"/*.sql; do
  echo "Applying ${migration##*/}"
  psql \
    --host "${PGHOST}" \
    --port "${PGPORT}" \
    --dbname "${PGDATABASE}" \
    --username "${PGUSER}" \
    --file "${migration}"
done
