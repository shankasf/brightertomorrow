# Brighter Tomorrow Therapy

Full-stack rebuild of brightertomorrowtherapy.com — Las Vegas therapy practice.

## Services

| Service | Tech | Port |
| ------- | ---- | ---- |
| **web** | Next.js 15, React 19, Tailwind, Framer Motion | 3001 (dev) |
| **gateway** | Go 1.24, chi (HTTP router + middleware), pgx v5, AWS SDK v2 (DynamoDB) — REST API + admin API | 8080 |
| **ai** | FastAPI, OpenAI Agents SDK 0.17 (`gpt-realtime-2`) — multi-agent text + voice triage graph | 8001 |
| **db** | PostgreSQL 17, schema `bt` — non-PHI metadata, FAQ embeddings, admin sessions | 5432 |
| **PHI store** | DynamoDB `bt-main` (us-east-1), CMK `alias/bt-phi`, PITR enabled | AWS |

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

### Chatbot data — plain-English end-to-end

What happens to a single message the moment a visitor types it into the chat widget, in language anyone can read.

```mermaid
flowchart TD
    A([Visitor types a message<br/>in the chat widget]) --> B[Locked in transit<br/>HTTPS / TLS 1.3<br/>nobody on the network can read it]
    B --> C[Arrives at our website<br/>brightertomorrowtherapy.cloud]
    C --> D[Routed inside our private cluster<br/>to the AI service<br/>never exposed to the public internet]
    D --> E[Sent to OpenAI<br/>HIPAA BAA signed · Zero Data Retention<br/>OpenAI does not keep the message]
    E --> F[AI reply returned to the visitor]
    F --> G[Transcript saved to the PHI vault<br/>AWS DynamoDB · CMK-encrypted<br/>alias/bt-phi · 1-year key rotation]
    G --> H[Local database stores ONLY a pointer<br/>no name, no message, no health info<br/>safe even if the server is stolen]

    H --> I{Does an admin<br/>need to read it?}
    I -- No --> J[Sits encrypted in the vault<br/>nobody can see it]
    I -- Yes --> K[Admin signs in<br/>email + password + phone code TOTP MFA<br/>auto sign-out after 8 hours]
    K --> L[Every single PHI read is written<br/>to a tamper-proof audit log<br/>who · what · when · IP]
    L --> M[Admin sees the transcript]

    J --> N{Has 10 years passed?<br/>Nevada NRS 629.051}
    M --> N
    N -- No --> O[Stays encrypted · audited · retained]
    N -- Yes --> P[Automatically anonymized<br/>name / message / contact info wiped<br/>audit trail kept forever]

    Q[[Visitor requests deletion<br/>NRS 603A right to erasure]] -.-> P

    classDef visitor fill:#e8f4ff,stroke:#06c,color:#003
    classDef transit fill:#fff4d6,stroke:#c80,color:#330
    classDef phi fill:#ffe5e5,stroke:#c00,color:#300
    classDef audit fill:#e8ffe8,stroke:#080,color:#030
    classDef purge fill:#f0e5ff,stroke:#60c,color:#202

    class A,F visitor
    class B,C,D,E transit
    class G,H,J,M phi
    class K,L audit
    class O,P,Q purge
```

**One-line summary of each safeguard layer:**

| Step | The plain-English promise | The HIPAA control |
|---|---|---|
| In transit | "Nobody between the visitor and us can read it." | §164.312(e) Transmission Security — TLS 1.3, HSTS, cert-manager |
| Inside our cluster | "Internal services can't be reached from the internet." | Traefik ingress never exposes `/internal/*` |
| At OpenAI | "OpenAI is a HIPAA business associate and throws the message away." | BAA + Zero Data Retention on the OpenAI account |
| At rest | "Encrypted with a key only we control." | §164.312(a)(2)(iv) — AWS KMS customer-managed key |
| Local DB | "The server in our datacenter never sees the PHI." | Minimum Necessary (§164.502(b)) — pointer-only schema |
| Admin login | "Password alone isn't enough — phone code required." | §164.312(d) — TOTP MFA via Cognito |
| Admin reads | "Every peek is recorded and can't be erased." | §164.312(b) — append-only `admin_access_log` |
| Retention | "Erased automatically once we no longer need it." | Nevada NRS 629.051 — 10-year auto-purge |
| Erasure request | "Visitors can ask us to delete their record." | Nevada NRS 603A — anonymisation procedures |



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

## Intake PHI Storage — DynamoDB-backed (HIPAA)

Identifying patient information collected through the chat widget, voice agent, or website intake forms (`first_name`, `last_name`, `date_of_birth`, `phone`, `email`, `home_address`, `sex`, `insurance_name`, `insurance_member_id`) is **never persisted to local Postgres**. PHI lives in a CMK-encrypted DynamoDB table (`bt-main`) on AWS; Postgres holds only a non-PHI pointer row that admin lists query.

### Why this split

The Postgres instance runs in a Docker container on the application VM (Hostinger). That container is fine for non-PHI workflow data — admin sessions, FAQ vectors, contact-form metadata — but it is **not** a HIPAA-eligible PHI store: no AWS BAA, no customer-managed key, no PITR, no cross-AZ replication. The right place for PHI is AWS DynamoDB with the existing `alias/bt-phi` customer-managed key.

### Data flow with security boundaries

```mermaid
flowchart TB
    subgraph EXT["Untrusted Internet"]
        VISITOR["Website visitor<br/>(chat / voice / form)"]
    end

    subgraph TRAEFIK["Traefik Ingress · TLS"]
        INGRESS["TLS 1.3 termination<br/>cert-manager / LetsEncrypt prod<br/>routes /v1/*, /admin/* → gateway<br/>routes /chat, /ws/voice → ai<br/>NEVER routes /internal/*"]
    end

    subgraph BT["k3s 'bt' namespace · cluster-internal traffic"]
        WEB["bt-web<br/>Next.js"]
        AI["bt-ai (FastAPI)<br/>tools.py:<br/>book_with_insurance<br/>request_intake_callback"]
        GW["bt-gateway (Go 1.24)<br/>handlers/intake.go<br/>handlers/intake_internal.go<br/>internal/phi/store.go"]
        PG[("Postgres 17<br/>(Docker on host)<br/>bt.intake_pointers<br/>NO PHI columns")]
    end

    subgraph AWS["AWS · account 689517798275 · us-east-1"]
        IAM["IAM user<br/>bt-gateway-vm<br/>scoped to bt-main + GSI1<br/>+ kms:Decrypt via DDB only"]
        SM["Secrets Manager<br/>bt/gateway/aws-credentials<br/>CMK-encrypted"]
        CMK["KMS CMK<br/>alias/bt-phi<br/>1-yr rotation"]
        DDB[("DynamoDB bt-main<br/>encryption: CUSTOMER_MANAGED<br/>PITR enabled<br/>deletion protection on<br/>streams: NEW_AND_OLD_IMAGES")]
        TRAIL[("CloudTrail<br/>S3 · object lock 365d<br/>encrypted with bt-phi CMK")]
    end

    VISITOR -- "HTTPS" --> INGRESS
    INGRESS -- "TLS in-cluster" --> WEB
    INGRESS -- "TLS in-cluster" --> AI
    WEB -- "POST /v1/intake (form)" --> GW
    AI -- "POST /internal/intake/submit<br/>cluster-only HTTP, network-isolated" --> GW

    GW -. "load env at startup" .-> SM
    SM -. "rotate via CDK redeploy" .-> IAM
    GW == "TLS · SigV4 · KMS data key" ==> DDB
    DDB -- "encrypts/decrypts<br/>every item with" --> CMK
    DDB -- "every API call audited" --> TRAIL
    GW -- "INSERT pointer row<br/>(submission_uuid, email_hash, status)<br/>NO PHI" --> PG

    classDef phi fill:#ffe5e5,stroke:#c00
    classDef pointer fill:#e5f5ff,stroke:#06c
    classDef key fill:#fff4d6,stroke:#c80
    class DDB,SM phi
    class PG pointer
    class CMK,IAM key
```

### Security controls at every layer

| Layer | Control | Protects against |
|---|---|---|
| **Transit · visitor → ingress** | TLS 1.3, HSTS, LE-prod cert via cert-manager | Eavesdropping on the public internet |
| **Transit · gateway → DynamoDB** | TLS to `dynamodb.us-east-1.amazonaws.com`, SigV4 request signing | Man-in-the-middle, request tampering, replay |
| **Transit · ai → gateway** | Cluster-internal only; `/internal/*` is not in the Traefik ingress at all | External callers reaching internal endpoints |
| **AuthN · gateway → DynamoDB** | IAM user `bt-gateway-vm` with static access key (rotated via CDK redeploy) | Unauthorised AWS API access |
| **AuthZ · IAM policy scope** | Only `PutItem/GetItem/Query/UpdateItem/DescribeTable` on `bt-main` + GSI1; `kms:Decrypt` only `ViaService = dynamodb.*.amazonaws.com` | Lateral movement to other AWS resources if the key leaks |
| **At rest · DynamoDB** | `TableEncryption.CUSTOMER_MANAGED` with `alias/bt-phi` (KMS, 1-yr rotation) | AWS insider access, disk-image exfiltration |
| **At rest · Secrets Manager** | Same `alias/bt-phi` CMK encrypts the gateway access key secret | Secret leakage from CloudFormation history |
| **At rest · Postgres pointer table** | No PHI columns. Stores only `submission_uuid`, `sha256(email)`, `status`, `created_at`, `retain_until` | Nothing identifying to leak even if the VM is compromised |
| **Audit · DynamoDB** | CloudTrail (data events on bt-main → S3 with object lock 365 d) | Tampering with the audit trail |
| **Audit · Postgres** | `phi_audit_trigger` on `bt.intake_pointers` writes every INSERT/UPDATE/DELETE to `bt.phi_audit_log` (append-only) | Silent admin actions |
| **Audit · admin PHI access** | `GetIntakePointer` writes to `bt.phi_audit_log` with admin email + row id every time PHI is fetched from DynamoDB on detail view | §164.312(b) "audit controls" |
| **Retention** | 10-year `retain_until` set on insert (Nevada NRS 629.051); weekly CronJob purges expired rows from both stores | Over-retention liability |
| **Right to erasure** | `bt.mark_intake_pointer_purged(id)` + DynamoDB `DeleteItem` | NRS 603A erasure request |
| **Fail-closed** | `/v1/intake` returns 503 if DynamoDB write fails; pointer row is **never** written without DynamoDB success first | Silently downgrading PHI to local Postgres if AWS is unreachable |
| **Reachability** | `/readyz` pings `DescribeTable` on `bt-main`; pod is removed from k8s service rotation if AWS is unreachable | Sending traffic to a pod that can't store PHI |

### Intake submission lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant V as Visitor
    participant W as bt-web
    participant GW as bt-gateway
    participant DDB as DynamoDB bt-main
    participant PG as Postgres pointer table
    participant CL as CLAIM.MD eligibility

    V->>W: Fill intake form (9 fields)
    W->>GW: POST /v1/intake
    GW->>GW: Validate, normalise, generate submission_uuid (v4)
    opt payment_method = insurance
        GW->>CL: POST /internal/intake/check-coverage (via bt-ai)
        CL-->>GW: {status, plan, copay}
    end
    GW->>GW: Build phi.IntakeRecord (CreatedAt, RetainUntil = +10y)
    GW->>+DDB: PutItem PK=PATIENT#sha256(email) SK=INTAKE#uuid<br/>(condition: attribute_not_exists)
    Note over GW,DDB: TLS · SigV4 · CMK envelope encryption
    DDB-->>-GW: 200 OK
    alt DDB write failed
        GW-->>W: 503 phi_store_unavailable
        Note over GW: FAIL CLOSED — Postgres untouched.
    else DDB write OK
        GW->>PG: INSERT bt.intake_pointers<br/>(uuid, email_hash, status, ddb_pk, ddb_sk)
        PG-->>GW: id (BIGSERIAL)
        Note over PG: phi_audit_trigger writes append-only audit row.
        GW-->>W: 200 {submission_id, submission_uuid, eligible, next_step}
    end
    W-->>V: "We'll contact you within 1 business day."
```

### Admin PHI access lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant A as Admin (browser)
    participant GW as bt-gateway
    participant PG as Postgres
    participant DDB as DynamoDB
    participant AUD as bt.phi_audit_log

    A->>GW: GET /admin/api/intake-pointers (list)
    GW->>PG: SELECT non-PHI cols FROM bt.intake_pointers ORDER BY created_at DESC
    PG-->>GW: rows (status, flow, email_hash, created_at)
    GW-->>A: 200 — list view never carries PHI
    Note over A,GW: List view is pointer-only. No DynamoDB call.

    A->>GW: GET /admin/api/intake-pointers/{id}
    GW->>PG: SELECT pointer WHERE id=?
    PG-->>GW: pointer row (gives ddb_pk, ddb_sk)
    GW->>DDB: GetItem PK,SK
    DDB-->>GW: full PHI record
    GW->>AUD: INSERT (table='intake_pointers_phi_access', actor=admin_email, row_id=uuid)
    GW-->>A: 200 — pointer + PHI merged
    Note over GW,AUD: Every PHI fetch is logged before the response is returned.
```

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
