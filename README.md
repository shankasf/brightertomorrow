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
   recordTurn(persistCtx, h.Pool, h.PHI, sessionID, "assistant", reply)
   // → phi.Store.PutChatTurn writes to DynamoDB
   // → UPDATE bt.chat_sessions SET message_count=message_count+1, last_message_at=now()
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

The voice path is driven entirely by `openai-agents` `RealtimeRunner` / `RealtimeSession` — the SDK manages the OpenAI WebSocket, hand-off lifecycle, and tool-calling. `voice.py` only translates browser ↔ session events (audio in/out, user/assistant transcripts, hallucination filtering) and forwards each turn to `bt-gateway` `/internal/chat/turn`, which writes the body to DynamoDB. The AI pod itself never touches Postgres for chat content.

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
    A([Visitor types a message OR speaks<br/>chat widget · voice WebSocket]) --> B[Locked in transit<br/>HTTPS / TLS 1.3<br/>nobody on the network can read it]
    B --> C[Arrives at our website<br/>brightertomorrowtherapy.cloud]
    C --> D[Routed inside our private cluster<br/>to the AI service<br/>never exposed to the public internet]
    D --> E[Sent to OpenAI<br/>HIPAA BAA signed · Zero Data Retention<br/>OpenAI does not keep the message]
    E --> F[AI reply returned to the visitor]

    F --> G[Every turn — yours and the AI's — is written to<br/>the PHI vault on AWS DynamoDB<br/>CMK-encrypted with alias/bt-phi · 1-yr rotation<br/>PK=CHAT#sessionId · SK=TURN#timestamp]
    G --> H[Postgres on Hostinger holds ONLY non-PHI:<br/>session id · source chat or voice ·<br/>message_count · last_message_at<br/>NEVER the message body]

    H --> I{Does an admin<br/>need to read it?}
    I -- No --> J[Sits encrypted in the vault<br/>nobody can see it]
    I -- Yes --> K[Admin signs in<br/>email + password + phone code TOTP MFA<br/>auto sign-out after 8 hours]
    K --> L[Every PHI read writes one row to the<br/>tamper-proof admin_access_log<br/>who · what · when · IP]
    L --> M[Admin sees the transcript hydrated from DDB]

    J --> N{Has 10 years passed?<br/>Nevada NRS 629.051}
    M --> N
    N -- No --> O[Stays encrypted · audited · retained]
    N -- Yes --> P[Auto-purged<br/>BatchWriteItem deletes every TURN#<br/>chat_sessions row marked purged]

    Q[[Visitor requests deletion<br/>NRS 603A right to erasure]] -.-> P

    classDef visitor fill:#e8f4ff,stroke:#06c,color:#003
    classDef transit fill:#fff4d6,stroke:#c80,color:#330
    classDef phi fill:#ffe5e5,stroke:#c00,color:#300
    classDef pointer fill:#e5f5ff,stroke:#06c,color:#003
    classDef audit fill:#e8ffe8,stroke:#080,color:#030
    classDef purge fill:#f0e5ff,stroke:#60c,color:#202

    class A,F visitor
    class B,C,D,E transit
    class G,J,M phi
    class H pointer
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



### What counts as PHI here — and where it lives

| Data | Storage | Why |
|---|---|---|
| Intake records (name, DOB, phone, address, insurance ID) | **DynamoDB `bt-main`** (BAA, KMS) | Identifying — must never touch Hostinger Postgres |
| Chat / voice transcripts (every turn, plaintext body) | **DynamoDB `bt-main`** (BAA, KMS) | Patients can volunteer PHI mid-conversation |
| Insurance eligibility check details | **DynamoDB `bt-main`** via the linked intake record | Linked to a named patient via `submission_uuid` |
| Insurance check metadata (status, payer, source, hashed email) | Postgres `bt.insurance_checks` (non-PHI) | Audit-ready history without exposing identity |
| Chat session shell (id, source, started_at, message_count) | Postgres `bt.chat_sessions` (non-PHI counters) | Lets the dashboard work without PHI joins |
| Intake pointer (uuid, hashed email, status, source) | Postgres `bt.intake_pointers` (non-PHI) | Pointer to the DynamoDB record |
| Contact form submissions | Postgres `bt.contact_submissions` (PHI lite) | Legacy; under retention/anonymisation |
| Newsletter subscribers | Postgres `bt.newsletter_subscribers` | Email + therapy-inquiry link |

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
| `db/migrations/002a_hipaa_schema.sql` | Companion to 002 — re-applies in `bt` schema |
| `db/migrations/003_admin.sql` | Admin users, sessions, access log tables |
| `db/migrations/004_faq_embeddings.sql` | pgvector column on `faqs` for chatbot RAG |
| `db/migrations/005_intake_pointers.sql` | Pointer table — intake PHI moved to DynamoDB |
| `db/migrations/006_voice_source_and_insurance_checks.sql` | `chat_sessions.source` (chat/voice) + `bt.insurance_checks` history table |
| `db/migrations/007_chat_messages_to_ddb.sql` | Add `chat_sessions.message_count`, `last_message_at`; backfill from old table |
| `db/migrations/008_drop_chat_messages.sql` | **Drop `chat_messages`** — every turn now lives in DynamoDB |

## PHI Storage — DynamoDB-backed (HIPAA)

**As of 2026-05-13** every patient-identifying field — and every record that
is *linkable* to one (hashed identifiers + appointment dates + therapist IDs,
audit references to PHI submission UUIDs, etc.) — lives in AWS DynamoDB
`bt-main` (CMK-encrypted, BAA-covered) and **never** lands on the local
Postgres on the Hostinger VPS. Hostinger does not sign a BAA, so anything
HIPAA-relevant must transit and persist on AWS.

Now resident in DynamoDB:

1. **Intake records** (`PATIENT#<emailHash>` / `INTAKE#<submissionUUID>`) — every form field collected by website, chatbot, or voice agent. Now also carries `appointmentTime` + `therapistStaffId` for confirmed bookings (formerly on `bt.intake_pointers`).
2. **Chat / voice transcripts** (`CHAT#<sessionID>` / `TURN#…`) — every turn of every conversation, plaintext bodies.
3. **Insurance checks** (`PATIENT#<emailHash>` / `INSURANCE#<checkUUID>`, `GSI1PK=ENTITY#INSURANCE`) — payer + status + email_hash. Standalone checks created by the AI `verify_coverage` tool are linked to the booking submission via `LinkCheckToSubmission` so one eligibility decision = one DDB item.
4. **Callbacks** (`PATIENT#callback-<uuid>` / `CALLBACK#meta`, `GSI1PK=ENTITY#CALLBACK`) — `first_name`, `last_name`, `phone`, `reason` from any "please call me back" request.
5. **Audit log** (`AUDIT#ACCESS#<YYYY-MM-DD>` and `AUDIT#PHI#<YYYY-MM-DD>`, `GSI1PK=ENTITY#AUDIT_ACCESS|AUDIT_PHI`) — §164.312(b) admin-PHI-access events and trigger-generated change history. Day-partitioned to avoid hot keys; ListAccessAudit / ListPHIAudit are cursor-paginated.

Postgres holds only operational non-PHI: admin auth state (sessions, bcrypt hashes — Cognito covers prod), public site content (FAQs, team members, KB), and `bt.chat_sessions` row metadata (visitor cookie UUID + source + counts; transcripts in DDB).

See [project_hostinger_not_hipaa](https://github.com/) memory rule — every new write of patient data must target DDB.

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
        AI["bt-ai (FastAPI)<br/>tools.py: book_with_insurance<br/>main.py: /chat /chat/stream<br/>voice.py: /ws/voice<br/>(no DB writes — calls gateway)"]
        GW["bt-gateway (Go 1.24)<br/>handlers/intake.go<br/>handlers/chat.go · chat_stream.go<br/>handlers/chat_internal.go<br/>handlers/admin_appointments.go<br/>handlers/admin_insurance_checks.go<br/>internal/phi/store.go"]
        PG[("Postgres 17 · Docker on host<br/>bt.intake_pointers · bt.chat_sessions<br/>bt.insurance_checks<br/>NON-PHI ONLY:<br/>uuids · sha256(email) · counters · status")]
    end

    subgraph AWS["AWS · account 689517798275 · us-east-1"]
        IAM["IAM user bt-gateway-vm<br/>scoped to bt-main + GSI1<br/>+ kms:Decrypt via DDB only"]
        SM["Secrets Manager<br/>bt/gateway/aws-credentials<br/>CMK-encrypted"]
        CMK["KMS CMK<br/>alias/bt-phi<br/>1-yr rotation"]
        DDB[("DynamoDB bt-main · CMK<br/>PATIENT#<email_hash> / INTAKE#<uuid><br/>CHAT#<session_id> / TURN#<ts>#<role><br/>PITR · deletion protection · streams")]
        TRAIL[("CloudTrail<br/>S3 · object lock 365d<br/>encrypted with bt-phi CMK")]
    end

    VISITOR -- "HTTPS" --> INGRESS
    INGRESS -- "TLS in-cluster" --> WEB
    INGRESS -- "TLS in-cluster" --> GW
    INGRESS -. "/ws/voice WebSocket" .-> AI
    WEB -- "POST /v1/intake (form)<br/>POST /v1/chat /chat/stream" --> GW
    GW == "POST /chat (LLM call)" ==> AI
    AI == "POST /internal/chat/turn<br/>GET /internal/chat/history<br/>POST /internal/intake/submit<br/>(cluster-only — Traefik never exposes /internal/*)" ==> GW

    GW -. "load env at startup" .-> SM
    SM -. "rotate via CDK redeploy" .-> IAM
    GW == "TLS · SigV4 · KMS data key<br/>PutChatTurn · PutIntake · BatchWriteItem" ==> DDB
    DDB -- "encrypts/decrypts<br/>every item with" --> CMK
    DDB -- "every API call audited" --> TRAIL
    GW -- "non-PHI only:<br/>pointer · session counter · check status" --> PG

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
    participant AUD as bt.admin_access_log

    A->>GW: GET /admin/api/appointments?from=&to=&source=
    GW->>PG: SELECT pointer rows FROM bt.intake_pointers (filtered)
    PG-->>GW: rows (uuid, email_hash, status — NO PHI)
    loop for each pointer
        GW->>DDB: GetItem PK=PATIENT#<hash> SK=INTAKE#<uuid>
        DDB-->>GW: name, DOB, phone, address, member ID
        GW->>AUD: INSERT view_appointments_list, resource_id=<uuid>
    end
    GW-->>A: 200 hydrated list
    Note over GW,AUD: One audit row per PHI record returned.

    A->>GW: GET /admin/api/chat/sessions/<id>
    GW->>PG: SELECT chat_sessions WHERE id=?
    PG-->>GW: shell (id, source, started_at, message_count)
    GW->>DDB: Query PK=CHAT#<id> AND begins_with(SK,'TURN#')
    DDB-->>GW: every turn (oldest first)
    GW->>AUD: INSERT view_chat_session, resource_id=<id>
    GW-->>A: 200 transcript
    Note over GW,AUD: Postgres holds zero message bodies.

    A->>GW: GET /admin/api/insurance-checks.csv?from=&source=
    GW->>PG: SELECT insurance_checks (filtered)
    PG-->>GW: status + payer + email_hash + submission_uuid (NO PHI)
    loop for each check
        GW->>DDB: GetItem PK=PATIENT#<hash> SK=INTAKE#<uuid>
        DDB-->>GW: patient name + member ID
        GW->>AUD: INSERT export_insurance_checks_csv, resource_id=<check_uuid>
    end
    GW-->>A: text/csv attachment
    Note over GW,AUD: CSV downloads are audited row-by-row.
```

### Chat / voice transcript lifecycle (PHI in DDB)

Every turn — chatbot AND voice — is written straight to DynamoDB. Postgres maintains only non-PHI counters on `bt.chat_sessions` so the dashboard works without ever joining message bodies.

```mermaid
sequenceDiagram
    autonumber
    participant V as Visitor
    participant W as bt-web (chat widget) / WebSocket (voice)
    participant GW as bt-gateway
    participant AI as bt-ai
    participant PG as Postgres bt.chat_sessions
    participant DDB as DynamoDB bt-main

    V->>W: Types message OR speaks
    W->>GW: POST /v1/chat/stream  (or /v1/voice WS)
    GW->>GW: ensure visitor cookie + chat_sessions row<br/>(source = 'chat' or 'voice')
    GW->>DDB: PutItem PK=CHAT#<sid> SK=TURN#<ts>#u  role=user
    GW->>PG: UPDATE chat_sessions SET message_count++,<br/>last_message_at=now() WHERE id=<sid>
    GW->>AI: POST /chat/stream (forwards turn)
    AI->>GW: GET /internal/chat/history?session_id=<sid>
    GW->>DDB: Query PK=CHAT#<sid> ScanIndexForward=false LIMIT 20
    DDB-->>GW: recent turns
    GW-->>AI: history JSON
    AI-->>GW: SSE stream of assistant tokens
    GW-->>W: SSE proxied to client
    GW->>DDB: PutItem PK=CHAT#<sid> SK=TURN#<ts>#a  role=assistant
    GW->>PG: UPDATE chat_sessions counters again
    Note over PG,DDB: Postgres never sees content.<br/>DDB stores plaintext under CMK alias/bt-phi.
```

## Architecture Diagrams

### High Level Design (HLD)

```mermaid
graph TB
    subgraph Client["Client Layer"]
        B[Browser / Mobile]
    end

    subgraph Ingress["Ingress — Traefik"]
        T[Traefik Reverse Proxy<br/>HTTP → HTTPS redirect<br/>TLS termination<br/>NEVER routes /internal/*]
    end

    subgraph Services["Application Services"]
        W[bt-web<br/>Next.js 15 / React 19<br/>:3001<br/>Pages + Admin UI]
        G[bt-gateway<br/>Go 1.24 / chi<br/>:8080<br/>REST + Admin + /internal/*<br/>only path that talks to DDB]
        AI[bt-ai<br/>FastAPI / Python<br/>:8001<br/>Chat + Voice agents<br/>NO direct DB access]
    end

    subgraph Data["Data Layer"]
        DB[(PostgreSQL 17 · Hostinger<br/>NON-PHI ONLY<br/>pointers · counters · status)]
        DDB[(DynamoDB bt-main · AWS<br/>BAA · CMK alias/bt-phi<br/>intake records · chat turns)]
    end

    subgraph External["External Services"]
        OAI[OpenAI API<br/>HIPAA BAA · ZDR<br/>GPT-4o / Realtime]
        CLM[CLAIM.MD<br/>insurance eligibility]
        COG[AWS Cognito<br/>admin login + MFA]
    end

    B -->|HTTPS| T
    T -->|/v1/* /admin/api/*| G
    T -->|everything else /admin/* HTML| W
    W -->|server-side fetch| G
    G -->|pgx v5 · non-PHI only| DB
    G ==>|TLS · SigV4 · ALL PHI| DDB
    G -->|/chat /chat/stream| AI
    AI -->|/internal/chat/turn<br/>/internal/chat/history<br/>/internal/intake/submit| G
    AI -->|OpenAI SDK + Realtime| OAI
    G -->|/internal/intake/check-coverage| AI
    AI -->|via gateway proxy| CLM
    G -->|admin login token exchange| COG
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
    subgraph App["Application Layer (bt-gateway)"]
        H[Admin Handler<br/>appointments · insurance-checks ·<br/>chat session detail · contacts]
        AL[admin.LogPHIAccess<br/>called once per PHI row]
    end

    subgraph DB["PostgreSQL — bt schema (non-PHI)"]
        PTR[(intake_pointers<br/>chat_sessions<br/>insurance_checks<br/>contact_submissions)]
        AAL[(admin_access_log<br/>append-only<br/>UPDATE/DELETE revoked)]
        PAL[(phi_audit_log<br/>append-only<br/>DB trigger)]
        TR[TRIGGER on INSERT/UPDATE/DELETE<br/>pointer tables → phi_audit_log]
    end

    subgraph AWS["DynamoDB bt-main — actual PHI"]
        DDB[(INTAKE# items<br/>TURN# items<br/>CMK encrypted)]
        CT[(CloudTrail<br/>data events<br/>S3 object lock)]
    end

    H -->|SELECT pointer| PTR
    H -->|GetItem / Query<br/>per row hydrated| DDB
    H --> AL
    AL -->|one row per PHI access| AAL
    PTR -->|mutation| TR
    TR -->|INSERT| PAL
    DDB -->|every API call| CT
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
        text source "chat | voice"
        integer message_count "non-PHI counter"
        timestamptz last_message_at
        timestamptz retain_until
        timestamptz purged_at
    }
    intake_pointers {
        bigserial id PK
        uuid submission_uuid
        char64 email_hash
        text source "chat-agent | voice-agent | website-*"
        text status
        text ddb_pk
        text ddb_sk
        timestamptz retain_until
    }
    insurance_checks {
        bigserial id PK
        uuid check_uuid
        uuid submission_uuid FK
        text source
        text payer_name
        text coverage_status
        boolean eligible
        char64 email_hash
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
    intake_pointers ||--o{ insurance_checks : "linked via submission_uuid"
```

> **NB:** `chat_messages` was dropped in migration 008 — every turn now lives in DynamoDB under `PK=CHAT#<session_id>`, `SK=TURN#<rfc3339nano>#<role>`. `chat_sessions.message_count` and `last_message_at` are non-PHI counters maintained by the gateway on every `PutChatTurn`.

To apply all migrations in order:

```bash
for f in db/schema.sql db/migrations/*.sql; do
  PGPASSWORD=<pass> psql -h localhost -U app -d app -f "$f"
done
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

**Pointers / non-PHI metadata (Postgres)**
- `intake_pointers` — uuid, sha256(email), source, status (PHI lives in DDB)
- `chat_sessions` — id, source (`chat`/`voice`), `message_count`, `last_message_at` (turns live in DDB)
- `insurance_checks` — eligibility-check history (status, payer, source, sha256(email))
- `contact_submissions` — legacy contact-form data (retain_until, purged_at)
- `newsletter_subscribers` — email list (unsubscribed_at, deletion_requested_at)

**PHI (DynamoDB `bt-main`, CMK alias/bt-phi)**
- `PATIENT#<email_hash>` / `INTAKE#<submission_uuid>` — full intake record
- `CHAT#<session_id>` / `TURN#<rfc3339nano>#<role>` — every chat / voice turn

**Compliance (Postgres)**
- `phi_audit_log` — database-level PHI mutation log (append-only)
- `admin_users` / `admin_sessions` — admin authentication
- `admin_access_log` — admin PHI read log (append-only)
- `phi_due_for_purge` — view: rows past NRS 629.051 retention window
