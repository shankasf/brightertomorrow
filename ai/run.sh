#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -U pip
pip install -q -r requirements.txt
[ -f .env ] || cp .env.example .env
exec python -m app.main
