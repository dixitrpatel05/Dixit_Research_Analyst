#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8000}"

PYTHON_BIN="python3"
if [[ -x "/app/.venv/bin/python" ]]; then
	PYTHON_BIN="/app/.venv/bin/python"
elif [[ -x "${ROOT_DIR}/.venv/bin/python" ]]; then
	PYTHON_BIN="${ROOT_DIR}/.venv/bin/python"
fi

echo "[start.sh] Using Python: ${PYTHON_BIN}"
echo "[start.sh] Starting API on 0.0.0.0:${PORT}"

cd "${ROOT_DIR}/backend"
exec "${PYTHON_BIN}" -m uvicorn main:app --host 0.0.0.0 --port "${PORT}"
