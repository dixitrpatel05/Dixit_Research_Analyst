#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8000}"
cd backend
exec python3 -m uvicorn main:app --host 0.0.0.0 --port "${PORT}"
