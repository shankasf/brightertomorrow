# Build & Deploy (production)

The site runs in the local **k3d cluster `bt`** (3 services + cron jobs, Traefik ingress, cert-manager TLS). Public URL: `https://brightertomorrowtherapy.cloud`.

> No Tilt, no dev image swap, no file sync. Edits land in production only when a new image is built and rolled out.

## Build all three images

```bash
SHA=$(git rev-parse --short HEAD)
TAG="prod-${SHA}-$(date +%s)"

# 1. Build prod Dockerfiles
for svc in web ai gateway; do
  docker build -t "bt-${svc}:${TAG}" -t "bt-${svc}:prod" \
    -f "./${svc}/Dockerfile" "./${svc}"
done

# 2. Import into k3d
for svc in web ai gateway; do
  k3d image import --mode=direct "bt-${svc}:${TAG}" -c bt
done

echo "Built tag: ${TAG}"
```

## Roll out

Update the image tag in `k8s/{20-ai,25-gateway,30-web}.yaml` (one line each: `image: bt-<svc>:<TAG>`), then:

```bash
kubectl apply -f k8s/20-ai.yaml
kubectl apply -f k8s/25-gateway.yaml
kubectl apply -f k8s/30-web.yaml

kubectl -n bt rollout status deploy/bt-ai --timeout=180s
kubectl -n bt rollout status deploy/bt-gateway --timeout=180s
kubectl -n bt rollout status deploy/bt-web --timeout=180s
```

## Build only one service

```bash
docker build -t bt-web:prod -f web/Dockerfile web/
k3d image import --mode=direct bt-web:prod -c bt
kubectl -n bt rollout restart deploy/bt-web
```

(`imagePullPolicy: IfNotPresent` + same tag → rollout restart picks up the new image because k3d's containerd resolves by digest.)

## Rollback

Every build is tagged `prod-<git-short-sha>-<epoch>`. Find the previous image in the deployment history:

```bash
kubectl -n bt rollout history deploy/bt-web
kubectl -n bt rollout undo deploy/bt-web
```

## Image sizes (after switching off Tilt's Dockerfile.dev)

| Service | Dev (Tilt) | Prod | Reduction |
|---|---|---|---|
| bt-gateway | ~812 MB | ~27 MB (distroless) | 97% |
| bt-web | ~1.2 GB | ~250 MB (Next standalone) | 80% |
| bt-ai | ~516 MB | ~517 MB | (no change — Python + libs dominate) |

## Why no Tilt

Tilt's `Dockerfile.dev` ran `next dev` / `uvicorn --reload` / in-container `go build` for live file sync. That was useful for local dev but inappropriate for production:

- Source maps and dev runtime exposed to the public
- 4 GB memory limit on bt-web (`next dev` is heavy)
- File watcher continuously rebuilding on every edit
- HIPAA posture: any local source edit reached the live site

Now: edits → commit → `docker build` → `kubectl apply`. Slower iteration, correct boundary.
