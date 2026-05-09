# Tiltfile — hot-reload dev loop for bt-web, bt-ai, bt-gateway in the k3d `bt` cluster.
# Run from the repo root:  tilt up
# Stop everything:          tilt down
#
# Prereqs:
#   - k3d cluster `bt` already up (Traefik, postgres, bt-config secret applied)
#   - `tilt` and `k3d` installed
#   - context set to k3d-bt:  kubectl config use-context k3d-bt
#
# What this gives you:
#   web      — edits under web/src/** sync into the pod; next dev HMR picks them up
#   ai       — edits under ai/app/** sync into the pod; uvicorn --reload restarts the process
#   gateway  — edits under gateway/** sync + in-container `go build` + restart
#
# Dep changes (package.json, requirements.txt, go.mod) trigger a full image rebuild.
#
# k3d has no external registry, so we use `custom_build` to build with docker and
# import with `k3d image import`. This is the canonical pattern for registry-less
# local clusters.

allow_k8s_contexts('k3d-bt')

K3D_CLUSTER = 'bt'


def k3d_build(ref, context_dir, dockerfile, live_update=None, deps=None):
    """docker build + k3d image import, paired with live_update for fast inner loops."""
    # --mode=direct bypasses the shared k3d-tools node, which otherwise races
    # when parallel imports tear it down mid-flight (silent partial failures).
    cmd = (
        'docker build -t $EXPECTED_REF -f ' + dockerfile + ' ' + context_dir +
        ' && k3d image import --mode=direct $EXPECTED_REF -c ' + K3D_CLUSTER
    )
    custom_build(
        ref,
        command=cmd,
        deps=deps or [context_dir],
        live_update=live_update or [],
        disable_push=True,
        # True = our command is responsible for making the image available
        # to the cluster; Tilt should not inspect local docker or re-tag.
        skips_local_docker=True,
    )


# ---------- bt-web (Next.js dev server) ----------
k3d_build(
    'bt-web',
    context_dir='./web',
    dockerfile='./web/Dockerfile.dev',
    deps=[
        './web/src', './web/public',
        './web/package.json', './web/package-lock.json',
        './web/next.config.mjs', './web/tailwind.config.ts',
        './web/postcss.config.mjs', './web/tsconfig.json',
        './web/Dockerfile.dev',
    ],
    live_update=[
        sync('./web/src', '/app/src'),
        sync('./web/public', '/app/public'),
        sync('./web/next.config.mjs', '/app/next.config.mjs'),
        sync('./web/tailwind.config.ts', '/app/tailwind.config.ts'),
        sync('./web/postcss.config.mjs', '/app/postcss.config.mjs'),
        sync('./web/tsconfig.json', '/app/tsconfig.json'),
        run('cd /app && npm ci --no-audit --no-fund',
            trigger=['./web/package.json', './web/package-lock.json']),
    ],
)

# ---------- bt-ai (FastAPI / uvicorn --reload) ----------
k3d_build(
    'bt-ai',
    context_dir='./ai',
    dockerfile='./ai/Dockerfile.dev',
    deps=['./ai/app', './ai/requirements.txt', './ai/Dockerfile.dev'],
    live_update=[
        sync('./ai/app', '/app/app'),
        run('pip install --no-cache-dir -r /app/requirements.txt',
            trigger=['./ai/requirements.txt']),
    ],
)

# ---------- bt-gateway (Go) ----------
load('ext://restart_process', 'docker_build_with_restart')

# restart_process extension only ships a docker_build wrapper, so for custom_build
# we do the same thing manually: sync + build + touch a restart file the entrypoint
# watches. Simpler here: let Tilt recreate the pod on source changes by falling
# through to a full image rebuild. Fast enough for Go in alpine.
k3d_build(
    'bt-gateway',
    context_dir='./gateway',
    dockerfile='./gateway/Dockerfile.dev',
    deps=[
        './gateway/cmd', './gateway/internal',
        './gateway/go.mod', './gateway/go.sum',
        './gateway/Dockerfile.dev',
    ],
)


# ---------- apply the existing production manifests ----------
# Tilt substitutes matching images with dev builds above.
# Secrets (bt-config) are assumed already applied out-of-band — we don't own them.
k8s_yaml([
    'k8s/20-ai.yaml',
    'k8s/25-gateway.yaml',
    'k8s/30-web.yaml',
])

# ---------- local port-forwards ----------
k8s_resource('bt-web',     port_forwards=['3000:3000'], labels=['web'])
k8s_resource('bt-ai',      port_forwards=['8001:8001'], labels=['ai'])
k8s_resource('bt-gateway', port_forwards=['8090:8080'], labels=['gateway'])
