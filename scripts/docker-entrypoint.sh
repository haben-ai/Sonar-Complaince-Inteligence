#!/usr/bin/env bash
# Fetch the regulatory corpus (and the demo drawing) into the data volume on first start, then serve.
set -uo pipefail
cd /app
if [ ! -d data/regulatory/raw ] || [ -z "$(ls -A data/regulatory/raw 2>/dev/null)" ]; then
  python scripts/fetch_regulations.py || echo "regulatory fetch failed; continuing without corpus"
fi
if [ "${FETCH_DEMO_PDF:-true}" = "true" ] && [ ! -f data/input/dana_general_arrangement.pdf ]; then
  scripts/fetch_dana_v.sh || echo "demo PDF fetch failed; continuing"
fi
# One worker only: designs are held in process memory.
exec uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 1
