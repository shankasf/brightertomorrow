# Brighter Tomorrow Therapy — Voice & Chat Agents

The AI assistant behind **brightertomorrowtherapy.cloud**. One LangGraph agent serves three surfaces (text chat, browser voice, Twilio phone) with HIPAA-safe persistence on AWS.

This README is for a new engineer who needs to be productive in a day. It covers what each service does, where the agent's "brain" lives, how a request flows end to end, and where the HIPAA boundary sits.

---

## 1. High-level architecture

Three services run in the `bt` namespace of a k3d cluster behind a single Traefik ingress:

| Service | Lang | Role |
|---|---|---|
| `bt-web` | Next.js (App Router) | Marketing site + admin dashboard + ChatWidget |
| `bt-gateway` | Go (chi) | Public ingress for `/v1/*`, Twilio webhook, internal `/internal/*` PHI API, admin endpoints |
| `bt-ai` | Python (FastAPI) | LangGraph agent runtime + voice pipelines + canned-reply cache |

PHI never lives on the Hostinger Postgres. Anything regulated (transcripts, intake details, eligibility responses, conversation checkpoints) is read from or written to AWS DynamoDB / Lambda via `bt-gateway` (SigV4-signed by `bt-ai` for direct PHI reads).

The brain is one compiled LangGraph `StateGraph`. Every turn — chat, browser voice, or phone — runs one cycle through that same graph. The three transports differ only in how they get audio/text in and out.

---

## 2. The agent runtime (LangGraph)

Everything in `ai/app/graph/`. The agent used to be the openai-agents SDK with parallel "text" and "realtime" agent trees — that's gone. There is one graph, one set of prompts, and one source of truth for state.

### Graph topology

One cycle per user turn:

1. `safety_screen` — deterministic crisis-keyword sweep. Writes `safety_signal`.
2. `extract` — single structured-output LLM call. Reads the last user turn, writes `intent`, `affirmation`, and field deltas merged into `insurance_fields` / `booking_fields` / `callback_fields`. This is the **only** natural-language boundary in the graph.
3. `planner` — a pure-Python conditional edge (not a real node). Reads state, returns the next node name. See `graph/nodes/planner.py` for the routing priority (crisis > low-confidence > pending-confirm yes/no > cancel > out-of-scope > info > callback > insurance/booking).
4. One action node, chosen by the planner:
   - `verify_insurance` — CLAIM.MD eligibility probe via signed call to API Gateway.
   - `propose_slots` — calls the gateway calendar to get 3 slots.
   - `book_appointment` — soft hold + confirm against Jane.
   - `cancel_appointment` — cancels an existing booking.
   - `submit_callback` — files an intake callback request.
   - `search_kb` — pgvector search over the FAQ / KB corpus.
   - `rollback` — clears a pending confirmation when the caller says "no".
   - (or skip directly to `respond` if no tool is needed)
5. `respond` — scene-based LLM reply. Writes the assistant message to `messages` and sets `last_reply_text` for the transport layer to send.

Every action node has an edge straight to `respond`. `respond` ends the turn; the checkpointer saves state; the next user message resumes from there.

### Where the agent's behavior is defined

- `graph/graph.py` — wires nodes and edges; `get_app()` returns the compiled, checkpointed runnable (module-level singleton).
- `graph/state.py` — the `State` TypedDict (one big dict, `total=False`) plus completeness helpers like `first_missing_booking`. Read this before adding state.
- `graph/nodes/` — the six node implementations: `safety_screen.py`, `extract.py`, `planner.py`, `actions.py` (all action nodes live here), `respond.py`, `rollback.py`.
- `graph/prompts/`:
  - `persona.py` composes the per-turn system prompt for the channel + scene.
  - `scenes.py` holds `SCENE_INSTRUCTIONS` (what `respond` should do for each scene) and `FIELD_PROMPTS` (what to ask for when collecting fields).
  - `extract.py` holds the extraction system prompt and the `TurnExtraction` Pydantic schema the LLM is bound to.
  - `_constants.py` holds the persona / scope / safety / voice-pacing constants reused across surfaces.
- `graph/runtime/` — the three transport adapters (see next section).
- `graph/checkpointer.py` — `DynamoDBSaver` (table `bt-langgraph-checkpoints`, KMS-encrypted, TTL 24h) with a `MemorySaver` fallback if AWS creds are missing.
- `graph/tracing.py` — LangSmith project hookup. Configured at startup.
- `graph/config.py` — env-driven model selection (`OPENAI_MODEL`, `OPENAI_EXTRACT_MODEL`, `REALTIME_MODEL`, …) and checkpointer selection.
- `graph/evals/` — eval datasets and runners against LangSmith.

### Transport adapters

All three wrap the same compiled graph; they only translate audio/text and manage one WebSocket or SSE stream per session.

| Adapter | Surface | Audio format | Notes |
|---|---|---|---|
| `runtime/chat.py` | HTTP + SSE | n/a | Single `delta` chunk per turn (no token streaming yet — `respond` is one LLM call). |
| `runtime/voice_browser.py` | WebSocket | PCM16 16 kHz | Driven by `voice_pipeline.py` (Deepgram STT → LangGraph → Cartesia TTS). |
| `runtime/voice_twilio.py` | WebSocket | μ-law 8 kHz | Same pipeline, plus μ-law↔PCM16 conversion via `audioop`. Phone-keyed thread IDs (`twilio-<e164 digits>`) so a hangup-and-callback resumes mid-flow. |

`voice_pipeline.py` is shared between the two voice transports — it owns the LiveKit STT/TTS plugin instances and the LangGraph invocation. We use the LiveKit Agents *plugins* standalone; we do not join LiveKit Rooms.

### Models

| Knob | Default | Override env |
|---|---|---|
| Chat / extract / respond model | `gpt-4o-mini` (code default); prod pin `gpt-5.5-2026-04-23` | `OPENAI_MODEL` (and optional `OPENAI_EXTRACT_MODEL` / `OPENAI_RESPOND_MODEL`) |
| Realtime / voice model | `gpt-realtime-2` | `REALTIME_MODEL` |
| Realtime voice | `marin` | `REALTIME_VOICE` |
| Realtime base URL | `wss://us.api.openai.com/v1/realtime` (US-pinned) | `REALTIME_BASE_URL` |
| Checkpointer | DDB when `AWS_ACCESS_KEY_ID` is set, else memory | `BT_LANGGRAPH_CHECKPOINT=ddb|memory` |

Production values live in the `bt-config` Kubernetes secret (`k8s/10-secrets.yaml`, gitignored).

---

## 3. Directory map

```
ai/                 Python FastAPI service (the agent)
  app/
    main.py            FastAPI entrypoint — endpoints below
    core/              cross-cutting infra
      db.py              Postgres pool (non-PHI reads: kb, faqs, services)
      logging_config.py  JSON log formatter + level
      log_stream.py      live log SSE broadcaster for /admin/logs
    integrations/      outbound clients
      aws_signer.py      SigV4 signed_post / signed_get → API Gateway
      tools.py           Plain helpers reused by action nodes
                         (_fetch_free_slots, _validate_dob, _format_slot_display,
                         agent_source ContextVar)
    ingestion/         one-shot data loads (run as k8s Jobs)
      ingest.py          KB ingest from BT.TXT into Postgres + pgvector
      ingest_team.py     Therapist roster ingest
      embed_faqs.py      Re-embed published FAQs
    caching/           process-local caches
      info_cache.py      Canned replies (hours / locations) keyed on row mtime
    data/              static reference data
      payers.py          Canonical payer list + resolve_payer_id
      roster.py          Bookable + callback-only therapists
    graph/             LangGraph runtime (see section 2)
      graph.py, state.py, checkpointer.py, tracing.py, config.py
      nodes/             safety_screen, extract, planner, actions, respond, rollback
      prompts/           persona, scenes, extract, _constants
      runtime/           chat, voice_browser, voice_twilio, voice_pipeline
      evals/             LangSmith datasets + runners
      tests/             pytest smoke + regression tests

gateway/            Go service (chi router)
  internal/handlers/
    chat.go, chat_stream.go, chat_end.go   public /v1/chat[/stream|/end]
    chat_internal.go                       /internal/chat/{turn,history,end} → DDB
    voice.go                               WS /v1/voice — IDOR + proxy to bt-ai
    twilio.go                              POST /v1/twilio/voice + WS /v1/twilio/media
    intake.go, intake_internal.go          intake submissions
    coverage.go, coverage_check.go         eligibility checks (SigV4 to AWS)
    internal_calendar.go                   Jane calendar bridge
    callback.go, contact.go, newsletter.go public form endpoints
    admin_*.go                             admin dashboard endpoints
    health.go, faqs.go, match.go

web/                Next.js (App Router)
  src/
    app/             routes: /, /about, /team, /services, /specialties,
                     /rates, /contact, /admin/*, /faqs, /blog, /our-approach, ...
    components/
      ChatWidget.tsx  SSE chat + WS voice + insurance dropdown + session persistence
      ...             Hero, Booking, CoverageModal, MatchModal, etc.
    lib/             Cognito client, fetch helpers
    middleware.ts    admin auth

db/                 Hostinger Postgres (non-PHI)
  schema.sql, 02_kb.sql, seed.sql
  migrations/        001..018 — additive migrations applied at deploy time

infra/              AWS CDK (TypeScript) — 7 stacks
  lib/               api-, auth-, data-, gateway-iam-, observability-,
                     secrets-, security- stacks, plus hostinger-dns CR
  lambdas/           verify_insurance, handle_chat, get_patient_data,
                     get_dashboard_metrics, list_chat_sessions,
                     jane_ical_sync, hostinger_dns_cr, common_layer

k8s/                Manifests for the kind/k3d cluster (namespace `bt`)
  00-namespace.yaml         bt namespace
  06-cert-manager-issuer.yaml  Let's Encrypt prod ClusterIssuer (bt-tls)
  10-secrets.yaml           bt-config (gitignored)
  20-ai.yaml, 25-gateway.yaml, 30-web.yaml   Deployments + Services
  40-ingress.yaml           Traefik ingress + middlewares
  50/51/52-*-ingest-job.yaml KB / team / FAQ ingest Jobs
  70-phi-cleanup-cronjob.yaml, 71-chat-idle-cronjob.yaml

ops/                build-and-deploy.md, runbooks, systemd units
scripts/            twilio_provision.sh + DDB migration scripts
```

---

## 4. Request flow

### Chat (text)

1. The widget calls `POST /v1/chat/stream` on the gateway with `{ session_id, message }`.
2. Gateway checks the visitor cookie + an IDOR guard (session belongs to this visitor), then forks two writes: a DDB `PutChatTurn` for the user message and a non-PHI counter bump in Postgres.
3. Gateway proxies the request to `bt-ai` (`POST /chat/stream`) with a **detached** context so a tab-close mid-stream does not cancel the upstream agent run — we still need the full reply for the DDB audit trail.
4. `bt-ai` first checks the canned-reply cache (`caching/info_cache.py`) for "what are your hours / locations" — sub-10ms response, no LLM.
5. On a miss, `bt-ai` runs one cycle of the LangGraph for the thread (`graph.aget_state` → resume or seed initial state) and emits the SSE wire format: `session` → one `delta` → `done`.
6. Gateway streams the SSE back to the widget and, on `done`, writes the assistant turn to DDB.

The chat wire format is intentionally simple. Token streaming is a follow-up: `respond` is one LLM call, so the whole reply arrives as one chunk.

### Browser voice

1. `getUserMedia` (24 kHz mono) in the widget → WebSocket to `GW /v1/voice?session_id=...`.
2. Gateway IDOR-checks, ensures a `chat_sessions` row exists with `source='voice-agent'`, and proxies the WS to `bt-ai /ws/voice`.
3. `bt-ai` accepts the WS, then delegates to `graph/runtime/voice_browser.py` (which owns the `VoicePipeline`).
4. The pipeline streams PCM16 frames into Deepgram STT. On each finalised user transcript it invokes the LangGraph; the resulting `last_reply_text` is streamed into Cartesia TTS and pushed back to the widget as base64 PCM16 deltas.
5. Tool calls (book, callback, verify) happen inside the LangGraph and persist as turns in DDB via the gateway.

### Twilio phone

1. PSTN call hits Twilio → `POST /v1/twilio/voice` on the gateway.
2. Gateway verifies `X-Twilio-Signature` (HMAC-SHA1 of URL + sorted form params), mints a UUID session, inserts a non-PHI `chat_sessions` row with `source='voice-phone'` and `external_ref=CallSid`, then returns TwiML: `<Connect><Stream url="wss://.../v1/twilio/media"><Parameter session_id|call_sid|caller_phone />`.
3. Twilio opens the Media Stream WS. Gateway re-verifies the signature on the upgrade URL (Twilio is inconsistent about https vs wss — both are accepted), upgrades with `Sec-WebSocket-Protocol: audio.twilio.com`, and proxies bytes verbatim to `bt-ai`.
4. `bt-ai /twilio/media` is handled by `graph/runtime/voice_twilio.py`. μ-law 8 kHz frames are converted to PCM16 16 kHz, pushed through the same `VoicePipeline`, and the synthesised reply is converted back to μ-law for Twilio. Phone callers get a stable thread ID (`twilio-<e164 digits>`), so a hangup-and-callback within the checkpointer TTL resumes mid-conversation.

---

## 5. HIPAA boundary

Hostinger Postgres is **not** under a BAA. None of the 18 HIPAA identifiers may land there. Architecture is split accordingly:

**Hostinger Postgres (`schema bt`) — non-PHI only.**

- `chat_sessions`: `id` (uuid), `visitor_id` (cookie), `source`, `message_count`, `last_message_at`, `ended_at`, `external_ref` (e.g. CallSid). No bodies.
- `insurance_checks`: audit row per probe — payer, eligible, `email_hash`. No plaintext PHI.
- KB, FAQs, services, specialties, locations, team metadata.

**AWS (account 689517798275, region us-east-1) — HIPAA BAA.**

- DynamoDB: `chat_turns` (transcripts), `intake` (callback / intake details), `bt-langgraph-checkpoints` (graph state per thread, 24 h TTL).
- Lambda + API Gateway: eligibility (`/internal/insurance/verify` → CLAIM.MD), patient data lookup, dashboard metrics, Jane iCal sync.
- KMS CMK (alias `bt-phi`) encrypts every DDB table at rest.

**Auth + boundaries.**

- `bt-gateway` `/internal/*` namespace has **no public ingress rule** — cluster network isolation is the auth boundary. `bt-ai` calls it directly via the in-cluster service DNS.
- `bt-ai` → API Gateway is SigV4-signed with the pod's IAM credentials (`integrations/aws_signer.py`).
- `bt-gateway` and `bt-ai` both stamp every PHI write with an `agent_source` ContextVar (`chat-agent` / `voice-agent` / `voice-phone`) so admin reports can split by modality.
- The LangGraph checkpointer (`graph/checkpointer.py`) writes to DDB only, KMS-encrypted, with a TTL of 24 hours — minimum necessary.

---

## 6. Session persistence (web widget)

`web/src/components/ChatWidget.tsx` stores the session ID in `localStorage`:

- Chat: key `bt_chat_session`, max age 24 h.
- Voice: key `bt_voice_session`, max age 30 min (voice carries more PHI density per second).
- Past the cap, the saved ID is dropped and a fresh session is minted (defends against shared-device PHI leak).
- A visible "Start fresh" button lets the visitor clear the saved session on demand.
- Visitors see a brief HIPAA notice before they start chatting.

Because the session ID is the LangGraph `thread_id`, a refresh mid-booking resumes from the DDB checkpoint with all collected fields intact.

---

## 7. Endpoints (bt-ai)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/chat` | Single-shot LangGraph turn |
| POST | `/chat/stream` | SSE: `session` → one `delta` → `done` |
| WS | `/ws/voice` | Browser voice (PCM16 16 kHz) |
| POST | `/twilio/voice` | TwiML that opens the Media Stream |
| WS | `/twilio/media` | Twilio Media Stream (μ-law 8 kHz, subprotocol `audio.twilio.com`) |
| POST | `/internal/intake/check-coverage` | Direct eligibility check (admin) |
| POST | `/internal/embed-faqs` | Re-embed published FAQs (admin trigger) |
| GET | `/internal/cache/stats` | Canned-reply cache snapshot |
| GET | `/internal/logs/stream` | SSE feed of live log records (admin dashboard) |
| (router) | `/v2/chat`, `/v2/chat/stream`, `/v2/ws/voice`, `/v2/twilio/*` | Direct routes on the graph runtime — kept mounted for testing |

The gateway-side public surface (`/v1/*`) maps onto these. `/internal/*` on either service is **not** exposed through Traefik.

---

## 8. Running locally

Local dev is k3d-only — there is no `docker compose` / Tilt / `next dev` shortcut. Every code edit is built into an image and rolled out. The flow lives in `ops/build-and-deploy.md`; the short version:

```bash
# 1. Build images (web needs Cognito NEXT_PUBLIC_* build args)
SHA=$(git rev-parse --short HEAD)
TAG="prod-${SHA}-$(date +%s)"
for svc in web ai gateway; do
  docker build -t "bt-${svc}:${TAG}" -t "bt-${svc}:prod" \
    -f "./${svc}/Dockerfile" "./${svc}"
done

# 2. Import into k3d
for svc in web ai gateway; do
  k3d image import --mode=direct "bt-${svc}:${TAG}" -c bt
done

# 3. Apply manifests (bump image tags in k8s/{20,25,30}-*.yaml first)
kubectl apply -f k8s/20-ai.yaml -f k8s/25-gateway.yaml -f k8s/30-web.yaml
kubectl -n bt rollout status deploy/bt-ai
```

Iteration time is in the tens of seconds. The trade-off is that you can never accidentally ship dev-mode source maps or `next dev` to production.

**Smoke tests.** `ai/app/graph/tests/` has a `smoke.py` plus regression tests (`test_cancel_then_keep.py`). Run them against a built image with `pytest ai/app/graph/tests`.

**Logs.** `kubectl -n bt logs -f deploy/bt-ai` for the agent; the admin dashboard at `/admin/logs` streams the same JSON lines via the `/internal/logs/stream` SSE.

---

## 9. Deploy

Production is the same k3d cluster (`bt`) at `2.24.200.155`. TLS is cert-manager + Let's Encrypt prod (`bt-tls` secret). DNS lives at Hostinger and is managed via API (see `infra/lambdas/hostinger_dns_cr` for the custom resource).

Database migrations in `db/migrations/` are additive and applied via the bt-gateway init container at startup. KB / team / FAQ data loads run as one-shot Jobs (`k8s/50-*`, `51-*`, `52-*`).

The AWS HIPAA stack is deployed via CDK from `infra/`:

```bash
cd infra && npm install && npx cdk deploy --all
```

Account 689517798275, region us-east-1. See `infra/README.md` for stack-specific details.

---

## 10. Conventions worth knowing

- **`extract` is the only NL boundary.** Any new natural-language signal belongs as a field on `TurnExtraction` (in `graph/prompts/extract.py`), not as a regex sprinkled into a downstream node.
- **State is one big TypedDict.** Splitting it across smaller types adds plumbing without adding safety; the planner reads many fields at once.
- **`display_text` is composed server-side** for tool results that the LLM must read aloud verbatim (especially eligibility outcomes). This stops the model from skipping the "you're covered" message.
- **DOB is echoed once in plain English** (`"August 19, 1998, correct?"`) — never MM/DD vs DD/MM.
- **Silent handoffs.** The caller never hears "transferring you" or "let me hand you off". The handoff *is* the transfer.
- **Trust contact fields.** Booking and intake do not refuse a name, phone, email, or address on "explicit content" grounds — read it back and confirm.
- **HIPAA is the default.** Every endpoint, audit row, and log line is reviewed against the boundary in section 5 before merging. PHI never lands in Postgres or stdout.
