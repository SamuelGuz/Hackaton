#!/bin/sh
set -e

case "$ROLE" in
  backend)
    exec uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-8000}"
    ;;
  frontend)
    cd /app/frontend
    exec npm run dev -- --host 0.0.0.0 --port "${FRONTEND_PORT:-5173}"
    ;;
  demosaas)
    cd /app/demosaas
    exec npm run dev -- --host 0.0.0.0 --port "${DEMOSAAS_PORT:-5174}"
    ;;
  *)
    echo "ERROR: ROLE must be set to 'backend', 'frontend', or 'demosaas'. Current value: '${ROLE:-unset}'" >&2
    exit 1
    ;;
esac
