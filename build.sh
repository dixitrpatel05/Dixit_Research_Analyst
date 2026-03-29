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

python3 -m pip install --upgrade pip
python3 -m pip install -r backend/requirements.txt
