#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8000}"

has_uvicorn() {
	local pybin="$1"
	"${pybin}" -c "import uvicorn" >/dev/null 2>&1
}

pick_python() {
	local candidates=(
		"/app/.venv/bin/python"
		"/opt/venv/bin/python"
		"${ROOT_DIR}/.venv/bin/python"
		"$(command -v python3 || true)"
	)

	for py in "${candidates[@]}"; do
		if [[ -n "${py}" && -x "${py}" ]] && has_uvicorn "${py}"; then
			echo "${py}"
			return 0
		fi
	done

	# If no interpreter has uvicorn yet, fall back to first available python.
	for py in "${candidates[@]}"; do
		if [[ -n "${py}" && -x "${py}" ]]; then
			echo "${py}"
			return 0
		fi
	done

	echo "python3"
}

PYTHON_BIN="$(pick_python)"

if ! has_uvicorn "${PYTHON_BIN}"; then
	echo "[start.sh] uvicorn missing for ${PYTHON_BIN}; installing backend requirements..."
	"${PYTHON_BIN}" -m pip install --no-cache-dir -r "${ROOT_DIR}/backend/requirements.txt"
fi

echo "[start.sh] Using Python: ${PYTHON_BIN}"
echo "[start.sh] Starting API on 0.0.0.0:${PORT}"

cd "${ROOT_DIR}/backend"
exec "${PYTHON_BIN}" -m uvicorn main:app --host 0.0.0.0 --port "${PORT}"
