#!/usr/bin/env bash
# Switch the live site at https://2.24.200.155/ to use the host's Next.js
# dev server (with hot reload) instead of the in-cluster pod.
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. Port-forward the AI service so Next.js's /api/chat can reach it
if ! pgrep -f "kubectl -n bt port-forward svc/bt-ai 8001" >/dev/null; then
  nohup kubectl -n bt port-forward svc/bt-ai 8001:8001 --address 127.0.0.1 \
    > /tmp/pf-ai.log 2>&1 &
  echo "started bt-ai port-forward → 127.0.0.1:8001"
fi

# 2. Port-forward the gateway service so the dev server can reach it
if ! pgrep -f "kubectl -n bt port-forward svc/bt-gateway 8090:80" >/dev/null 2>&1; then
  nohup kubectl -n bt port-forward svc/bt-gateway 8090:80 --address 127.0.0.1 \
    > /tmp/pf-gateway.log 2>&1 &
  echo "started bt-gateway port-forward → 127.0.0.1:8090"
fi

# 3. Start the dev server if not already running
if ! pgrep -f "next dev -p 3001" >/dev/null; then
  ( cd web && nohup npx next dev -p 3001 -H 0.0.0.0 > /tmp/dev-web.log 2>&1 & )
  echo "started Next.js dev server → 0.0.0.0:3001"
  # Wait for it to be ready
  until curl -sSf -o /dev/null http://127.0.0.1:3001/ 2>/dev/null; do sleep 1; done
fi

# 3. Scale the in-cluster pod down and route the Service to the host
kubectl -n bt scale deploy/bt-web --replicas=0 >/dev/null
kubectl -n bt delete service bt-web --ignore-not-found >/dev/null
kubectl apply -f k8s/60-web-dev-bridge.yaml

echo
echo "✓ DEV MODE ON — edit files in web/src and refresh https://2.24.200.155/"
echo "  Dev log: tail -f /tmp/dev-web.log"
echo "  AI proxy log: tail -f /tmp/pf-ai.log"
echo "  Gateway proxy log: tail -f /tmp/pf-gateway.log"
