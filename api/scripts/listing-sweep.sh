#!/bin/sh
# Entrypoint for the daily listing-lifecycle sweep.
#
# Scheduled by .github/workflows/listing-sweep.yml. It previously ran as a
# Render cron job, which was the only non-free line on the Render account
# (Render has no free cron plan) — see the COST note in render.yaml.
#
# Kept as a script rather than inlined into the workflow for the same reason it
# was originally pulled out of render.yaml's dockerCommand: a curl invocation
# with nested quoting is fragile inside a YAML scalar, and this way the
# scheduler and a human debugging by hand run the exact same command.
#
# The retries are new with the move to GitHub Actions. The API is on Render's
# free plan and sleeps when idle, so the first request after a cold start can
# take ~35s or fail outright; from inside Render that mattered less. Retrying
# is safe because the sweep is idempotent — each notice is stamped send-once on
# the business, so a retried or overlapping run won't re-notify anyone.
set -eu

curl -fsS -X POST "${API_BASE_URL}/internal/listing-sweep" \
  -H "x-internal-key: ${INTERNAL_API_KEY}" \
  --connect-timeout 20 \
  --max-time 120 \
  --retry 4 \
  --retry-delay 15 \
  --retry-connrefused
