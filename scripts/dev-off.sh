#!/usr/bin/env bash
# Restore the in-cluster bt-web pod and stop the host dev server.
set -euo pipefail
cd "$(dirname "$0")/.."

# Stop the host dev server + port-forward
pkill -f "next dev -p 3001"               2>/dev/null || true
pkill -f "kubectl -n bt port-forward svc/bt-ai 8001" 2>/dev/null || true
pkill -f "kubectl -n bt port-forward svc/bt-gateway 8090:80" 2>/dev/null || true

# Restore the production Service (selector → bt-web pods)
kubectl delete -f k8s/60-web-dev-bridge.yaml --ignore-not-found
kubectl apply  -f k8s/30-web.yaml
kubectl -n bt scale deploy/bt-web --replicas=1 >/dev/null
kubectl -n bt rollout status deploy/bt-web --timeout=120s | tail -2

echo
echo "✓ DEV MODE OFF — production pod is serving https://2.24.200.155/"
