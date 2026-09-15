#!/usr/bin/env bash
#
# Copy the development database from one Postgres server to another — used to
# move off a machine-local Homebrew Postgres and onto the container from
# docker-compose.yml, or onto a hosted instance (Neon, Supabase, Render).
#
#   ./scripts/move-dev-db.sh <SOURCE_URL> <TARGET_URL>
#
# e.g. onto the compose container:
#   ./scripts/move-dev-db.sh \
#     "postgresql://$(whoami)@localhost:5432/renovate_connect" \
#     "postgresql://renovate:renovate@localhost:5433/renovate_connect"
#
# Copies schema and data. Ownership and grants are dropped (--no-owner
# --no-privileges) because the roles on the source server won't exist on the
# target — that mismatch is the usual reason a restore fails.
#
# This only reads from SOURCE. Nothing is dropped there; when you're satisfied
# with the target, point DATABASE_URL at it in api/.env and the old database
# just sits unused until you remove it yourself.

set -euo pipefail

SOURCE="${1:-}"
TARGET="${2:-}"

if [[ -z "$SOURCE" || -z "$TARGET" ]]; then
  echo "usage: $0 <SOURCE_DATABASE_URL> <TARGET_DATABASE_URL>" >&2
  exit 64
fi

redact() { sed -E 's#(//[^:/@]+):[^@]*@#\1:***@#' <<<"$1"; }

echo "source: $(redact "$SOURCE")"
echo "target: $(redact "$TARGET")"

if ! psql "$TARGET" -c 'SELECT 1' >/dev/null 2>&1; then
  echo "error: cannot connect to the target. Is it up, and does the database exist?" >&2
  exit 1
fi

# Refuse to write into a target that already has tables — a second run would
# otherwise layer a partial restore on top of real data.
EXISTING=$(psql "$TARGET" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
if [[ "$EXISTING" != "0" ]]; then
  echo "error: target already has $EXISTING table(s) in schema public." >&2
  echo "       Drop and recreate it first if you meant to overwrite." >&2
  exit 1
fi

# ON_ERROR_STOP: without it psql reports success after a restore that
# errored halfway, leaving a half-copied database that looks fine.
pg_dump --no-owner --no-privileges --format=plain "$SOURCE" \
  | psql --quiet -v ON_ERROR_STOP=1 -o /dev/null "$TARGET"

echo
echo "Copied. Row counts on the target:"
psql "$TARGET" -c "
  SELECT relname AS table, n_live_tup AS rows
  FROM pg_stat_user_tables WHERE n_live_tup > 0 ORDER BY n_live_tup DESC LIMIT 15"

echo "Next: set DATABASE_URL in api/.env to the target URL."
