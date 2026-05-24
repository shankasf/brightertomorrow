#!/usr/bin/env bash
# Build + deploy only the services whose source has changed since the
# currently-deployed image tag. Saves the two-out-of-three rebuilds that
# happen when only one service has edits.
#
# How "changed" is decided per service (ai|gateway|web):
#   1. Read the SHA embedded in the deployed image tag from k8s/*.yaml
#      (format: <name>:prod-<git-short-sha>-<epoch>).
#   2. If there are uncommitted changes under <svc>/  -> build.
#   3. Else if `git diff <deployed-sha> -- <svc>/`     -> build.
#   4. Else                                            -> skip.
#
# Tag for new builds: prod-<git-short-sha>-<epoch>, matching ops/build-and-deploy.md.
#
# Usage:
#   ops/deploy-changed.sh           # auto-detect, build only changed
#   ops/deploy-changed.sh --all     # force-rebuild all three (escape hatch)
#   ops/deploy-changed.sh ai web    # explicit list, skip detection
#
# Exit codes: 0 = ok (incl. nothing to do); 1 = build/import/apply failure.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

NS="bt"
SERVICES_ALL=(ai gateway web)

# ----- arg parsing ----------------------------------------------------------

FORCE_ALL=0
EXPLICIT=()
for arg in "$@"; do
  case "$arg" in
    --all)   FORCE_ALL=1 ;;
    ai|gateway|web) EXPLICIT+=("$arg") ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *)
      echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# ----- helpers --------------------------------------------------------------

manifest_for() {
  case "$1" in
    ai)      echo "k8s/20-ai.yaml" ;;
    gateway) echo "k8s/25-gateway.yaml" ;;
    web)     echo "k8s/30-web.yaml" ;;
  esac
}

# Extract the git short SHA embedded in the currently-deployed image tag.
# Returns "" if the manifest doesn't have a parseable prod tag yet.
deployed_sha_for() {
  local svc="$1"
  local m; m=$(manifest_for "$svc")
  grep -oE "bt-${svc}:prod-[0-9a-f]+-[0-9]+" "$m" \
    | head -1 \
    | sed -E "s/bt-${svc}:prod-([0-9a-f]+)-[0-9]+/\1/"
}

# True if there's any change under <svc>/ since the deployed SHA, OR any
# uncommitted change touching <svc>/.
service_changed() {
  local svc="$1"
  if ! git diff --quiet -- "$svc/" 2>/dev/null; then return 0; fi
  if ! git diff --quiet --cached -- "$svc/" 2>/dev/null; then return 0; fi
  if git ls-files --others --exclude-standard -- "$svc/" | grep -q .; then return 0; fi
  local sha; sha=$(deployed_sha_for "$svc")
  if [ -z "$sha" ]; then return 0; fi  # no parseable tag -> assume changed
  if ! git diff --quiet "$sha" -- "$svc/" 2>/dev/null; then return 0; fi
  return 1
}

# bt-web needs Cognito values baked at build time (Next.js inlines
# NEXT_PUBLIC_* into the client bundle). Mirror of ops/build-and-deploy.md.
web_build_args() {
  local args=()
  for k in NEXT_PUBLIC_AWS_REGION NEXT_PUBLIC_COGNITO_USER_POOL_ID NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID; do
    local v
    v=$(kubectl -n "$NS" get secret bt-config -o "jsonpath={.data.${k}}" | base64 -d)
    args+=(--build-arg "${k}=${v}")
  done
  printf '%s\n' "${args[@]}"
}

build_one() {
  local svc="$1" tag="$2"
  local extra=()
  if [ "$svc" = "web" ]; then
    mapfile -t extra < <(web_build_args)
  fi
  echo ">>> building bt-${svc}:${tag}"
  docker build "${extra[@]}" \
    -t "bt-${svc}:${tag}" \
    -t "bt-${svc}:prod" \
    -f "./${svc}/Dockerfile" "./${svc}"
  echo ">>> importing bt-${svc}:${tag} into k3d"
  # Attempt direct stream import first. It can fail with a docker.sock
  # "use of closed network connection" error on some kernels/docker versions
  # after a prune. In that case fall back to a tar-file import, which goes
  # through a shared volume and avoids the socket streaming path entirely.
  if ! k3d image import --mode=direct "bt-${svc}:${tag}" -c bt 2>/tmp/k3d-import-err-${svc}.txt; then
    echo "!!! direct import failed ($(cat /tmp/k3d-import-err-${svc}.txt)); falling back to tarball import"
    local tar="/tmp/bt-${svc}-${tag}.tar"
    docker save "bt-${svc}:${tag}" -o "$tar"
    if ! k3d image import "$tar" -c bt; then
      rm -f "$tar" /tmp/k3d-import-err-${svc}.txt
      echo "!!! tarball import also failed for bt-${svc}:${tag}" >&2
      return 1
    fi
    rm -f "$tar" /tmp/k3d-import-err-${svc}.txt
  fi
}

# In-place update the manifest's image tag and apply. We keep the existing
# tag prefix (bt-<svc>:prod-...) and only swap the value, so the YAML stays
# diff-clean for any unrelated lines.
apply_one() {
  local svc="$1" tag="$2"
  local m; m=$(manifest_for "$svc")
  # Replace ONLY the bt-<svc>:prod-* image line for this service.
  sed -i -E "s|bt-${svc}:prod-[0-9a-f]+-[0-9]+|bt-${svc}:${tag}|g" "$m"
  echo ">>> kubectl apply $m"
  kubectl apply -f "$m"
}

# ----- decide which services to build ---------------------------------------

declare -a TARGETS=()
if [ "$FORCE_ALL" = "1" ]; then
  TARGETS=("${SERVICES_ALL[@]}")
  echo "==> --all: building all services"
elif [ ${#EXPLICIT[@]} -gt 0 ]; then
  TARGETS=("${EXPLICIT[@]}")
  echo "==> explicit list: ${TARGETS[*]}"
else
  for svc in "${SERVICES_ALL[@]}"; do
    if service_changed "$svc"; then
      TARGETS+=("$svc")
      echo "    [build] $svc (changed since deployed tag)"
    else
      echo "    [skip ] $svc (no changes)"
    fi
  done
fi

if [ ${#TARGETS[@]} -eq 0 ]; then
  echo "==> nothing to build. exiting."
  exit 0
fi

# ----- build + import + apply ----------------------------------------------

SHA=$(git rev-parse --short HEAD)
TAG="prod-${SHA}-$(date +%s)"
echo "==> tag: ${TAG}"

for svc in "${TARGETS[@]}"; do
  build_one "$svc" "$TAG"
done

for svc in "${TARGETS[@]}"; do
  apply_one "$svc" "$TAG"
done

# ----- wait for rollouts in parallel ---------------------------------------

echo "==> waiting for rollouts"
pids=()
for svc in "${TARGETS[@]}"; do
  kubectl -n "$NS" rollout status "deploy/bt-${svc}" --timeout=180s &
  pids+=($!)
done
fail=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then fail=1; fi
done

if [ "$fail" = "1" ]; then
  echo "!!! one or more rollouts failed" >&2
  exit 1
fi

echo "==> done: ${TARGETS[*]} @ ${TAG}"
