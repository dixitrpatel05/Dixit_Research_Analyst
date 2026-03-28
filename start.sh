#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8000}"
cd backend
exec uvicorn main:app --host 0.0.0.0 --port "${PORT}"
