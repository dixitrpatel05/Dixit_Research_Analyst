#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8000}"

PYTHON_BIN="python3"
if [[ -x "/app/.venv/bin/python" ]]; then
	PYTHON_BIN="/app/.venv/bin/python"
elif [[ -x "./.venv/bin/python" ]]; then
	PYTHON_BIN="./.venv/bin/python"
fi

echo "[start.sh] Using Python: ${PYTHON_BIN}"
echo "[start.sh] Starting API on 0.0.0.0:${PORT}"

cd backend
exec "${PYTHON_BIN}" -m uvicorn main:app --host 0.0.0.0 --port "${PORT}"
