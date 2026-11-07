#!/usr/bin/env bash
# Build the dashboard and serve API + UI on http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -r requirements.txt; }
[ -d frontend/node_modules ] || (cd frontend && npm install)
(cd frontend && npm run build)
exec .venv/bin/uvicorn backend.main:app --port 8000
