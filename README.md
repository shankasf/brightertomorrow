# Brighter Tomorrow Therapy

Full-stack rebuild of brightertomorrowtherapy.com — Las Vegas therapy practice.

## Services

| Service | Tech | Port |
| ------- | ---- | ---- |
| **web** | Next.js 15, React 19, Tailwind, Framer Motion | 3001 (dev) |
| **gateway** | Go 1.23, chi (HTTP router + middleware), pgx v5, goroutines — REST API + admin API | 8080 |
| **ai** | FastAPI, OpenAI Agents SDK 0.17 (`gpt-realtime-2`) — multi-agent text + voice triage graph | 8001 |
| **db** | PostgreSQL 17, schema `bt` | 5432 |

All traffic routes through Traefik: `/v1/*` and `/admin/*` → gateway, everything else → web.

### Go gateway internals

**chi** is the HTTP router — it matches URL patterns (`/admin/contacts/{id}`), chains middleware (auth, rate-limiting, logging), and extracts path params. It has nothing to do with concurrency; it is purely a routing library.

**Goroutines** are used for concurrency in two places:

1. `cmd/gateway/main.go` — the HTTP server runs in a goroutine so the main goroutine can block on OS signals (`SIGINT`/`SIGTERM`) and trigger a graceful shutdown:
   ```go
   go func() {
       srv.ListenAndServe()  // blocks in its own goroutine
   }()
   signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
   <-quit  // main goroutine waits here
   srv.Shutdown(ctx)
   ```

2. `internal/handlers/chat.go` — after the AI service responds, the assistant reply is persisted using a **background context** (detached from the request context) so a client disconnect after the AI call cannot leave the chat history in a torn state (user message recorded, assistant reply missing):
   ```go
   persistCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
   defer cancel()
   pool.Exec(persistCtx, "INSERT INTO bt.chat_messages ...", sessionID, reply)
   ```
   `net/http` itself also spawns one goroutine per incoming request automatically.

**chi and goroutines are not alternatives** — chi routes requests, goroutines provide concurrency. Both are in use.

### AI service internals

The AI service runs **two parallel agent graphs** sharing the same specialist agents and tools:

| Path | Entry | SDK primitive | Use |
| ---- | ----- | ------------- | --- |
| **Text** (`POST /chat`) | `bt_agents/triage_agent.py` | `Agent` + `handoff(...)` | Browser chat widget |
| **Voice** (`WS /ws/voice`) | `bt_agents/realtime/triage.py` | `RealtimeAgent` + `realtime_handoff(...)` | Mic-button voice mode |

Both flow Triage → one of `{Crisis Support, Info, Therapist Matching, Intake, Booking}`. Each specialist lives in its own file under `ai/app/bt_agents/` (text) and `ai/app/bt_agents/realtime/` (voice). The head Triage agent owns all handoffs; specialists never reach across to peers.

The voice path is driven entirely by `openai-agents` `RealtimeRunner` / `RealtimeSession` — the SDK manages the OpenAI WebSocket, hand-off lifecycle, and tool-calling. `voice.py` only translates browser ↔ session events (audio in/out, user/assistant transcripts, hallucination filtering) and persists transcripts to Postgres.

Realtime model is `gpt-realtime-2` with `gpt-4o-mini-transcribe` for input transcription, semantic-VAD turn detection, and PCM16 audio. Override via secret keys `REALTIME_MODEL`, `REALTIME_TRANSCRIPTION_MODEL`, `REALTIME_VOICE` in `bt-config`.

## Local dev

The cluster runs in k3d (`bt` cluster), and **Tilt is managed as a systemd user service** (`tilt-bt.service`) that hot-syncs source edits into the running pods. You should not need to run `tilt up` or `kubectl cp` manually.

```bash
# Service status / logs
systemctl --user status tilt-bt
journalctl --user -u tilt-bt -f

# Pause / resume the watcher (e.g. to run interactive `tilt up` for the UI on :10350)
systemctl --user stop tilt-bt
systemctl --user start tilt-bt
```

What edits go live where:

| Edit | What happens | Restart needed |
| ---- | ------------ | -------------- |
| `web/src/**` | Tilt syncs → Next.js HMR | No |
| `ai/app/**` | Tilt syncs → `uvicorn --reload` | No |
| `gateway/**` | Tilt rebuilds image + rolls pod | Automatic |
| `requirements.txt`, `package.json`, `go.mod` | Full image rebuild + roll | Automatic |
| `Tiltfile`, `k8s/*.yaml` | Tilt re-applies | Automatic |

First-time install of the dev loop on a fresh box:

```bash
# Install service unit
cp ops/systemd/tilt-bt.service ~/.config/systemd/user/   # or write the unit by hand
sudo loginctl enable-linger ubuntu                       # auto-start at boot
systemctl --user daemon-reload
systemctl --user enable --now tilt-bt
```

Run a service standalone (not via systemd) only if you have a specific reason:

```bash
cd web && npm install && npm run dev          # http://localhost:3001
cd gateway && go run ./cmd/gateway            # needs DATABASE_URL
cd ai && pip install -r requirements.txt && uvicorn app.main:app --port 8001
```

## Admin Dashboard

**URL:** `/admin/login`

A HIPAA-compliant admin dashboard for managing all site data and monitoring compliance.

### Features

| Section | What you can do |
| ------- | --------------- |
| **Dashboard** | Live stats — contacts, chat sessions, newsletter, content counts, purge queue alert |
| **Contacts** | Paginated list (no message body in list view); click row for full record |
| **Chat Sessions** | Browse all AI chat sessions; view full message transcripts |
| **Newsletter** | Manage subscribers; unsubscribe or flag for NRS 603A deletion |
| **PHI Audit Log** | Append-only log of every INSERT/UPDATE/DELETE on PHI tables |
| **Admin Access Log** | Every admin read of PHI is recorded here |
| **Purge Queue** | Records past their 10-year retention window; trigger anonymization |
| **Content** | Edit FAQs, blog posts, site settings, team, services, testimonials, locations, nav, stats |

### First-time setup

On first gateway startup, set these k8s secrets and the first superadmin is created automatically:

```bash
kubectl -n bt patch secret bt-config --type=json -p='[
  {"op":"add","path":"/data/ADMIN_INITIAL_EMAIL","value":"'$(echo -n admin@example.com | base64)'"},
  {"op":"add","path":"/data/ADMIN_INITIAL_PASSWORD","value":"'$(echo -n yourpassword | base64)'"}
]'
kubectl -n bt rollout restart deployment/bt-gateway
```

## HIPAA Compliance (45 CFR Part 164)

This codebase implements HIPAA Technical Safeguards for a therapy practice handling Protected Health Information (PHI). Nevada state law (NRS 629.051, NRS 603A) adds additional requirements.

### What counts as PHI here

- **`contact_submissions`** — name, email, phone, message (contains health context)
- **`chat_sessions` / `chat_messages`** — AI chatbot transcripts (potential health disclosure)
- **`newsletter_subscribers`** — email linked to therapy inquiry

### Safeguards implemented

#### §164.312(a)(1) — Access Control
- Every admin user has a unique account (`bt.admin_users`)
- Role-based access: `superadmin` (full access) and `auditor` (read-only on audit logs)
- Shared credentials are prohibited by design

#### §164.312(a)(2)(iii) — Automatic Logoff
- Admin sessions have a hard 8-hour TTL (`expires_at = created_at + 8h`)
- Sessions are revoked on explicit logout; expired sessions are rejected at every request

#### §164.312(b) — Audit Controls
Three append-only audit tables:
- **`bt.phi_audit_log`** — database-level trigger captures every INSERT/UPDATE/DELETE on PHI tables (content/message fields redacted)
- **`bt.admin_access_log`** — application-level log; every admin read of PHI (contact detail, chat transcript, audit log) is recorded with timestamp, admin email, IP address, and resource ID
- Both tables have `UPDATE`, `DELETE`, `TRUNCATE` revoked from all roles

#### §164.312(c) — Integrity
- Passwords: bcrypt, cost 12
- Session tokens: 32-byte `crypto/rand` → base64url; only the SHA-256 hash is stored in DB
- The raw token is never logged

#### §164.312(d) — Authentication
- Account lockout: 5 failed login attempts → 30-minute lock
- Login endpoint rate-limited to 5 requests/minute per IP
- Timing-safe comparison on unknown email (runs bcrypt regardless to prevent user enumeration)

#### §164.312(e) — Transmission Security
- All traffic HTTPS only (Traefik redirects HTTP → HTTPS)
- `HttpOnly`, `Secure`, `SameSite=Strict` on visitor tracking cookie

#### §164.502(b) — Minimum Necessary
- Contact list endpoint omits `message` body — only returned on the detail endpoint (which is PHI-logged)
- IP address and user-agent removed from `contact_submissions` (no documented clinical need)

### Nevada state law

#### NRS 629.051 — 10-year medical records retention
- `retain_until` column set automatically on INSERT to `created_at + 10 years`
- `bt.phi_due_for_purge` view surfaces records past their retention date
- Admin purge queue page lists these records; anonymization is one click (logged)

#### NRS 603A — Security of Personal Information / Right to Erasure
- `bt.anonymise_contact(id)` — redacts name, email, phone, message; sets `purged_at`
- `bt.anonymise_chat_session(uuid)` — redacts all message content; nulls `visitor_id`
- Newsletter: `deletion_requested_at` flag for erasure workflow

### Database roles

| Role | Can do |
| ---- | ------ |
| `app` | All DML on content + PHI tables; INSERT on audit logs; SELECT on `phi_audit_log` (admin dashboard) |
| `bt_readonly` | SELECT on all tables in `bt` schema |
| `bt_auditor` | SELECT on `phi_audit_log`, `admin_access_log`, `admin_users`, `admin_sessions` |

### Migrations

| File | Purpose |
| ---- | ------- |
| `db/schema.sql` | Base schema — all content and PHI tables |
| `db/migrations/001_perf_indexes.sql` | Query performance indexes |
| `db/migrations/002_hipaa_compliance.sql` | Audit triggers, retention columns, anonymization procedures, DB roles |
| `db/migrations/003_admin.sql` | Admin users, sessions, access log tables |

## Architecture Diagrams

### High Level Design (HLD)

```mermaid
graph TB
    subgraph Client["Client Layer"]
        B[Browser / Mobile]
    end

    subgraph Ingress["Ingress — Traefik"]
        T[Traefik Reverse Proxy<br/>HTTP → HTTPS redirect<br/>TLS termination]
    end

    subgraph Services["Application Services"]
        W[web<br/>Next.js 15 / React 19<br/>:3001<br/>Pages + Admin UI]
        G[gateway<br/>Go 1.23 / chi<br/>:8080<br/>REST API + Admin API]
        AI[ai<br/>FastAPI / Python<br/>:8001<br/>Chatbot + Voice]
    end

    subgraph Data["Data Layer"]
        DB[(PostgreSQL 17<br/>schema: bt<br/>:5432)]
    end

    subgraph External["External Services"]
        OAI[OpenAI API<br/>GPT-4o / Realtime]
    end

    B -->|HTTPS| T
    T -->|/v1/* /admin/*| G
    T -->|everything else| W
    W -->|server-side fetch| G
    G -->|pgx v5| DB
    G -->|/v1/chat /v1/voice| AI
    AI -->|OpenAI SDK| OAI
    AI -->|pgx| DB
```

### Low Level Design (LLD)

#### Go Gateway — Middleware Stack & Request Lifecycle

```mermaid
flowchart TD
    R[Incoming Request] --> CORS[CORS Middleware]
    CORS --> LOG[Structured Logger]
    LOG --> REC[Panic Recoverer]
    REC --> RT{Route Match}

    RT -->|POST /admin/auth/login| RL[Rate Limit<br/>5 req/min per IP]
    RL --> LH[Login Handler<br/>bcrypt verify<br/>lockout check<br/>32-byte token → SHA-256 stored]

    RT -->|/admin/* protected| AA[RequireAdmin<br/>Extract Bearer<br/>SHA-256 hash<br/>ValidateToken DB lookup<br/>expiry + revoke check]
    AA -->|401| ERR[Error Response]
    AA -->|OK| SA{Superadmin<br/>required?}
    SA -->|yes| SG[RequireSuperadmin<br/>role check]
    SG -->|403| ERR
    SG -->|OK| AH[Admin Handler]
    SA -->|no| AH

    RT -->|/v1/* public| PH[Public Handler<br/>contact / chat / newsletter]

    AH -->|PHI read| PAL[Log to admin_access_log<br/>admin_email · action<br/>resource_id · ip · ua]
    PAL --> DB[(PostgreSQL bt schema)]
    AH --> DB
    PH --> DB
```

#### Admin Auth Sequence

```mermaid
sequenceDiagram
    participant C as Browser
    participant G as Go Gateway
    participant DB as PostgreSQL

    C->>G: POST /admin/auth/login {email, password}
    G->>DB: SELECT admin_users WHERE email=?
    DB-->>G: user row (hash, locked_until, failed_attempts)
    alt account locked
        G-->>C: 429 locked
    else
        G->>G: bcrypt.CompareHashAndPassword
        alt wrong password
            G->>DB: UPDATE failed_attempts++, maybe set locked_until
            G-->>C: 401 invalid credentials
        else correct
            G->>G: crypto/rand 32 bytes → base64url token<br/>SHA-256(token) → tokenHash
            G->>DB: INSERT admin_sessions (token_hash, expires_at=now+8h)
            G->>DB: UPDATE last_login_at, failed_attempts=0
            G-->>C: 200 {token, user} — raw token returned once, never stored server-side
        end
    end

    C->>G: GET /admin/... Authorization: Bearer <token>
    G->>G: SHA-256(token) → hash
    G->>DB: SELECT session WHERE token_hash=hash AND revoked_at IS NULL AND expires_at > now
    DB-->>G: session + admin_user row
    G->>G: inject User into request context
    G->>DB: INSERT admin_access_log (if PHI endpoint)
    G-->>C: 200 protected resource
```

#### PHI Audit Trail Flow

```mermaid
flowchart LR
    subgraph App["Application Layer"]
        H[Admin Handler<br/>view_contact / view_chat]
        AL[admin.LogPHIAccess]
    end

    subgraph DB["PostgreSQL — bt schema"]
        PHI[(contact_submissions<br/>chat_sessions<br/>chat_messages)]
        AAL[(admin_access_log<br/>append-only<br/>UPDATE/DELETE revoked)]
        PAL[(phi_audit_log<br/>append-only<br/>DB trigger)]
        TR[TRIGGER on INSERT/UPDATE/DELETE<br/>phi tables → phi_audit_log]
    end

    H -->|SELECT| PHI
    H --> AL
    AL -->|INSERT| AAL
    PHI -->|mutation| TR
    TR -->|INSERT| PAL
```

#### Database ER Diagram (key tables)

```mermaid
erDiagram
    admin_users {
        bigserial id PK
        text email
        text password_hash
        text role
        smallint failed_attempts
        timestamptz locked_until
    }
    admin_sessions {
        uuid id PK
        bigint admin_user_id FK
        text token_hash
        timestamptz expires_at
        timestamptz revoked_at
    }
    admin_access_log {
        bigserial id PK
        bigint admin_user_id FK
        text action
        text resource_type
        text resource_id
        inet ip_address
    }
    contact_submissions {
        bigserial id PK
        text name
        text email
        text phone
        text message
        timestamptz retain_until
        timestamptz purged_at
    }
    chat_sessions {
        uuid id PK
        text visitor_id
        timestamptz retain_until
        timestamptz purged_at
    }
    chat_messages {
        bigserial id PK
        uuid session_id FK
        text role
        text content
    }
    phi_audit_log {
        bigserial id PK
        text table_name
        text operation
        bigint record_id
        timestamptz event_time
    }

    admin_users ||--o{ admin_sessions : "has"
    admin_users ||--o{ admin_access_log : "generates"
    chat_sessions ||--o{ chat_messages : "contains"
```

To apply all migrations:

```bash
PGPASSWORD=<pass> psql -h localhost -U app -d app -f db/schema.sql
PGPASSWORD=<pass> psql -h localhost -U app -d app -f db/migrations/001_perf_indexes.sql
PGPASSWORD=<pass> psql -h localhost -U app -d app -f db/migrations/002_hipaa_compliance.sql
PGPASSWORD=<pass> psql -h localhost -U app -d app -f db/migrations/003_admin.sql
```

## DB schema

All tables in `bt` schema:

**Content**
- `site_settings` (singleton) — brand, colors, hours, social
- `nav_items` — header/footer navigation with parent_id for dropdowns
- `services`, `specialties` — therapy offerings
- `team_groups`, `team_members` — staff directory
- `testimonials`, `faqs`, `stats`, `blog_posts`
- `locations`, `press_mentions`, `podcast`, `free_resources`

**PHI**
- `contact_submissions` — contact form intake (retain_until, purged_at)
- `chat_sessions` / `chat_messages` — AI chatbot transcripts (retain_until, purged_at)
- `newsletter_subscribers` — email list (unsubscribed_at, deletion_requested_at)

**Compliance**
- `phi_audit_log` — database-level PHI mutation log (append-only)
- `admin_users` / `admin_sessions` — admin authentication
- `admin_access_log` — admin PHI read log (append-only)
- `phi_due_for_purge` — view: records past NRS 629.051 retention window
