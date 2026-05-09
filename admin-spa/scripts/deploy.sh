#!/usr/bin/env bash
# Thin wrapper. Canonical deploy is deploy.py (boto3, no aws CLI required).
exec python3 "$(dirname "$0")/deploy.py" "$@"
