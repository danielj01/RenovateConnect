#!/bin/sh
# Cron entrypoint for the daily listing-lifecycle sweep (render.yaml).
#
# Previously this curl call was inlined directly into render.yaml's
# dockerCommand as `sh -c '...'` with nested double quotes for the env-var
# interpolation. That string didn't survive Render's parsing of the YAML
# field — the cron failed with the entire curl invocation collapsed into one
# unresolved token ("sh: 1: curl -fsS ... : not found"), which is what nested
# shell quoting embedded in a YAML scalar is prone to. Moving it into an
# actual script file sidesteps that: dockerCommand is now just a bare path
# with nothing for a parser to mis-split.
set -eu

curl -fsS -X POST "${API_BASE_URL}/internal/listing-sweep" \
  -H "x-internal-key: ${INTERNAL_API_KEY}"
