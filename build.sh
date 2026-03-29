#!/usr/bin/env bash
set -euo pipefail

# Install native libs required by WeasyPrint in slim runtime images.
if command -v apt-get >/dev/null 2>&1; then
	export DEBIAN_FRONTEND=noninteractive
	apt-get update
	apt-get install -y --no-install-recommends \
		libcairo2 \
		libpango-1.0-0 \
		libgdk-pixbuf-2.0-0 \
		libffi8 \
		shared-mime-info \
		fonts-dejavu-core
	rm -rf /var/lib/apt/lists/*
fi

PYTHON_BIN="python3"
if [[ -x "/app/.venv/bin/python" ]]; then
	PYTHON_BIN="/app/.venv/bin/python"
fi

"${PYTHON_BIN}" -m pip install --upgrade pip
"${PYTHON_BIN}" -m pip install -r backend/requirements.txt
