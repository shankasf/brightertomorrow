# Brighter Tomorrow Therapy — Voice & Chat Agents

How the AI assistant for **brightertomorrowtherapy.cloud** actually works, end to end.

There is **one agent graph**, with **two surfaces**:

| Surface | Transport | Audio? | Where the prompt lives |
|---|---|---|---|
| **Text chat** (widget) | `POST /v1/chat/stream` (SSE) | no | `ai/app/bt_agents/*.py` |
| **Browser voice** (mic in widget) | `WS /v1/voice` (PCM16, 24 kHz) | yes | `ai/app/bt_agents/realtime/*.py` |
| **Twilio phone** (PSTN) | `WS /v1/twilio/media` (μ-law, 8 kHz) | yes | `ai/app/bt_agents/realtime/*.py` |

Both surfaces share the same **tools** (`ai/app/tools.py`), the same **roster** (`ai/app/bt_agents/roster.py`), and the same **payer list** (`ai/app/data/payers.py`). They **diverge** only in: (1) prompts (text vs. voice persona), (2) audio formats, (3) the `end_call` tool that the voice agents have but the chat agent doesn't.

---

## 1. The agent graph (identical shape on text + voice)

```mermaid
flowchart TD
    Start([Visitor / Caller]) --> Triage{Triage}

    Triage -- safety signal --> Crisis[CrisisSupport<br/>988 / 911]
    Triage -- &quot;do you take Aetna?&quot; --> InsuranceCheck[InsuranceCheck<br/>verify_coverage]
    Triage -- &quot;book me&quot; --> BookingAgent[BookingAgent<br/>verify + collect + book]
    Triage -- &quot;who specializes in X?&quot; --> Matching[TherapistMatching<br/>list_team_members]
    Triage -- &quot;call me back&quot; --> Intake[IntakeAgent<br/>request_intake_callback]
    Triage -- hours / services / FAQ --> Info[InfoAgent<br/>kb_search + structured]

    InsuranceCheck -. &quot;yes book me&quot; .-> BookingAgent
    Matching -. caller picked therapist .-> BookingAgent
    Matching -. excluded therapist .-> Intake

    BookingAgent --> Done([book_appointment])
    Intake --> Done2([request_intake_callback])
    InsuranceCheck --> EndIns([result + offer to book])
```

- **Triage owns no tools.** Its only job is to route via exactly one handoff. It never collects info and never replies in its own voice (except to disambiguate a bare "hi"). See `ai/app/bt_agents/triage_agent.py:33` and `ai/app/bt_agents/realtime/triage.py:22`.
- **BookingAgent and InsuranceCheck are independent.** BookingAgent runs `verify_coverage` itself if Triage routed straight to it; InsuranceCheck runs `verify_coverage` and offers to hand off to BookingAgent. Whoever runs the verification, the result lives in conversation memory and the other agent reads it from there. (`ai/app/bt_agents/booking_agent.py:48-75`, `ai/app/bt_agents/insurance_agent.py:110-150`.)
- **Crisis routing is a guardrail + a route.** A keyword guardrail (`bt_agents/guardrails.py`) flags safety language for telemetry but does **not** trip the wire — Triage routes naturally so the caller gets a warm reply, not a 500.

---

## 1b. LangGraph topology (`ai/app/graph/`)

The control-flow underneath the agents is a compiled LangGraph `StateGraph`. One cycle per user turn: safety screen → extract → planner (conditional edge) → one action node → respond → END. Checkpointer saves state; the next turn resumes from END.

```mermaid
flowchart TD
    START([START]) --> safety_screen[safety_screen<br/>crisis keyword check]
    safety_screen --> extract[extract<br/>LLM structured parse]
    extract -->|planner: conditional edge| verify_insurance[verify_insurance]
    extract -->|planner| propose_slots[propose_slots]
    extract -->|planner| book_appointment[book_appointment]
    extract -->|planner| cancel_appointment[cancel_appointment]
    extract -->|planner| submit_callback[submit_callback]
    extract -->|planner| search_kb[search_kb]
    extract -->|planner| rollback[rollback]
    extract -->|planner| respond[respond<br/>scene-based reply]

    verify_insurance --> respond
    propose_slots --> respond
    book_appointment --> respond
    cancel_appointment --> respond
    submit_callback --> respond
    search_kb --> respond
    rollback --> respond

    respond --> ENDN([END])
```

**Nodes** (`ai/app/graph/nodes/`):

| Node | Role | Writes |
|---|---|---|
| `safety_screen` | deterministic crisis keyword sweep | `safety_signal` |
| `extract` | LLM structured-output parse of the last user turn | `intent`, `affirmation`, `field_deltas` into `insurance_fields` / `booking_fields` / `callback_fields` |
| `planner` | pure router (conditional edge, not a real node) — see `planner.py` | nothing |
| `verify_insurance` / `propose_slots` / `book_appointment` / `cancel_appointment` / `submit_callback` / `search_kb` | action nodes — call one tool from `ai/app/tools.py` | their tool result + `last_action` |
| `rollback` | undo a pending confirmation when caller says "no" | clears the pending state |
| `respond` | LLM scene-based patient reply | appends to `messages`, sets `last_reply_text` |

**State** (`ai/app/graph/state.py:State` — one TypedDict, total=False):

- **Identity:** `channel`, `session_id`, `caller_phone`, `agent_source`
- **Per-turn ephemeral** (overwritten by `extract`): `affirmation`, `safety_signal`, `last_user_text`
- **Sticky:** `intent`, `payment_path`, `booking_status`, `callback_status`
- **Collected fields:** `insurance_fields` (5), `booking_fields` (5), `callback_fields` (4), `staff_id`, `staff_name`
- **Tool results:** `verify_result`, `proposed_slots`, `selected_slot`, `appointment_id`, `callback_id`, `kb_snippets`
- **Plumbing:** `messages` (with `add_messages` reducer), `last_action`, `pending_question`, `last_reply_text`, `soft_safety_asked`

**Edges** (`ai/app/graph/graph.py`):

- `START → safety_screen → extract`
- `extract --conditional(planner)--> {respond, verify_insurance, propose_slots, book_appointment, cancel_appointment, submit_callback, search_kb, rollback}`
- every action node `→ respond`
- `respond → END`

Planner priority is documented inline in `ai/app/graph/nodes/planner.py:1` — crisis > low-confidence > pending-confirm yes/no > cancel > out-of-scope > info > callback > insurance/booking.

---

## 2. Tool surface (one source: `ai/app/tools.py`)

```mermaid
flowchart LR
    subgraph Tools[ai/app/tools.py - @function_tool]
        kb_search
        list_services
        get_service
        list_specialties
        list_locations
        list_team_members
        get_business_hours_and_contact
        search_faqs
        list_payers
        verify_coverage
        propose_slots
        get_free_slots
        book_appointment
        request_intake_callback
        end_call
    end

    subgraph Agents
        InfoAgent --> INFO[INFO_TOOLS:<br/>kb_search, list_*, get_*, search_faqs]
        TherapistMatching --> MATCH[MATCHING_TOOLS:<br/>list_team_members, list_specialties, list_services]
        InsuranceCheck --> INS[verify_coverage, list_payers]
        BookingAgent --> BOOK[BOOKING_TOOLS:<br/>verify_coverage, propose_slots,<br/>get_free_slots, book_appointment, list_payers]
        IntakeAgent --> INT[INTAKE_TOOLS:<br/>request_intake_callback]
        CrisisSupport --> NONE[no tools]
    end

    INFO --> kb_search
    INS --> verify_coverage
    BOOK --> verify_coverage
    BOOK --> propose_slots
    BOOK --> book_appointment
    INT --> request_intake_callback

    BookingAgent -. voice only .-> end_call
    InsuranceCheck -. voice only .-> end_call
    IntakeAgent -. voice only .-> end_call
    Matching -. voice only .-> end_call
    InfoAgent -. voice only .-> end_call
```

`VOICE_TOOLS = [end_call]` is appended to every realtime agent's tool list (`ai/app/tools.py:398`). Text agents do not get `end_call` — it would be meaningless over SSE.

---

## 3. Text chat — request lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant W as ChatWidget.tsx
    participant G as bt-gateway (Go)
    participant DDB as DynamoDB (PHI)
    participant PG as Postgres (counters)
    participant AI as bt-ai (FastAPI)
    participant LLM as OpenAI Responses API

    W->>G: POST /v1/chat/stream {session_id?, message}
    G->>G: visitor cookie + session IDOR check
    G->>DDB: PutChatTurn(role=user, content)
    G->>PG: bump message_count, last_message_at
    G->>AI: POST /chat/stream (detached upstream ctx)
    AI->>AI: detect_intent(msg) - canned info?

    alt cache hit (hours / locations)
        AI-->>G: SSE: session, delta(reply), done(cached=true)
    else LLM path
        AI->>AI: load history from /internal/chat/history (last 20 turns)
        AI->>LLM: Runner.run_streamed(triage_agent, history)
        loop while streaming
            LLM-->>AI: ResponseTextDeltaEvent
            AI-->>G: SSE: delta(text)
            G-->>W: forward SSE block
        end
        AI-->>G: SSE: done(usage, cache_hit_pct, agent, tools)
    end

    G->>DDB: PutChatTurn(role=assistant, accumulated reply)
    G->>PG: bump counters
```

**Key files / line refs**

- Widget streams via `fetch("/v1/chat/stream")` and parses SSE manually — `web/src/components/ChatWidget.tsx:159-256`.
- Gateway forwards SSE with a **detached** `context.WithTimeout(5min)` so a tab-close doesn't cancel the upstream and lose the assistant turn — `gateway/internal/handlers/chat_stream.go:130`.
- AI service builds the agent, hits the canned-reply cache first, then calls `Runner.run_streamed` — `ai/app/main.py:248-402`.
- Conversation history lives in **DynamoDB**, *not* Postgres, because Hostinger is not HIPAA. The AI loads it via `GET /internal/chat/history` — `ai/app/main.py:113-137`, `gateway/internal/handlers/chat_internal.go:85-117`.
- Prompt-cache key `bt-chat-v1` pins the OpenAI cache prefix across requests — `ai/app/main.py:64`.

---

## 4. Canned-reply fast path (info_cache)

```mermaid
flowchart TD
    msg[User message] --> rx{regex match<br/>hours / locations?}
    rx -- no --> LLM[Runner.run_streamed]
    rx -- yes --> ver[fetch site_settings.updated_at +<br/>md5 of locations rows]
    ver --> cmp{version key<br/>matches cache?}
    cmp -- yes --> hit[cache hit - serve in ~5ms]
    cmp -- no/cold --> render[render markdown from PG]
    render --> store[store in process-local cache]
    store --> serve[serve, log miss reason]
    hit --> sse[SSE: delta + done cached=true]
    serve --> sse
```

`ai/app/info_cache.py` — process-local, version-keyed against the source rows, so admin edits invalidate automatically. Misses pay one render cost; no LLM is called.

---

## 5. Browser voice (mic in widget) — WebRTC-style streaming over WebSocket

```mermaid
sequenceDiagram
    autonumber
    participant W as ChatWidget.tsx
    participant G as bt-gateway
    participant PG as Postgres
    participant AI as bt-ai (voice.py)
    participant RT as OpenAI Realtime API<br/>wss://us.api.openai.com

    W->>W: getUserMedia 24kHz mono
    W->>G: WS /v1/voice?session_id=<uuid>
    G->>G: visitor cookie + IDOR
    G->>PG: INSERT chat_sessions if new (source='voice-agent')
    G->>AI: WS dial /ws/voice?session_id=...
    AI->>RT: RealtimeRunner.run() with realtime_triage agent
    RT-->>AI: session ready
    AI->>RT: response.create (greeting instructions)
    RT-->>AI: RealtimeAudio (PCM16 24kHz)
    AI-->>G: response.audio.delta (b64 PCM16)
    G-->>W: forward
    W->>W: decode PCM16, queue, play

    loop user speaks
        W->>G: input_audio_buffer.append (b64 PCM16)
        G->>AI: forward
        AI->>RT: send_audio
        RT->>RT: semantic VAD detects turn end
        RT-->>AI: transcript + audio response
        AI->>AI: filter ASR hallucinations<br/>(www., subscribe, etc.)
        AI-->>W: response.audio.delta + transcript
        AI->>G: POST /internal/chat/turn (DDB)
    end

    Note over W,RT: barge-in: response.cancel - session.interrupt()<br/>tool calls: book_appointment etc.<br/>end_call - close ws after 2s grace
```

Files:
- Browser audio capture + WS protocol: `web/src/components/ChatWidget.tsx:283-444`.
- Gateway WS proxy (with session IDOR + chat-first→voice-agent source promotion): `gateway/internal/handlers/voice.go`.
- AI bridge (RealtimeRunner, hallucination filter, DDB persistence): `ai/app/voice.py:216-475`.
- Realtime config (PCM16, semantic VAD low eagerness, marin voice): `ai/app/bt_agents/realtime/config.py:48-69`.

---

## 6. Twilio phone — PSTN → realtime agent graph

```mermaid
sequenceDiagram
    autonumber
    participant T as Twilio (PSTN)
    participant G as bt-gateway
    participant PG as Postgres
    participant AI as bt-ai (twilio_voice.py)
    participant RT as OpenAI Realtime API

    T->>G: POST /v1/twilio/voice (form-encoded)
    G->>G: verify X-Twilio-Signature (HMAC-SHA1)
    G->>PG: INSERT chat_sessions (id=uuid, source='voice-phone',<br/>external_ref=CallSid)
    G-->>T: TwiML <Connect><Stream url="wss://.../v1/twilio/media"><br/>with <Parameter name="session_id" value="<uuid>">

    T->>G: WS upgrade /v1/twilio/media
    G->>G: verify signature on upgrade URL
    G->>AI: WS dial /twilio/media (subprotocol audio.twilio.com)

    T-->>AI: connected, then start (streamSid, callSid, customParams.session_id)
    AI->>RT: RealtimeRunner.run() with telephony config<br/>(g711_ulaw both ways, far-field denoiser, VAD eagerness=medium)
    AI->>RT: send_message(opening greeting prompt)
    RT-->>AI: RealtimeAudio (mulaw)
    AI-->>T: media event with mulaw payload (verbatim, no resample)

    loop call
        T-->>AI: media (mulaw 8kHz)
        AI->>RT: send_audio
        RT-->>AI: audio + transcripts + tool calls
        AI->>AI: drop ASR hallucinations
        AI->>G: POST /internal/chat/turn (DDB) per finalized turn
        AI-->>T: media frames
    end

    Note over AI,T: end_call tool → end_call_event.set()<br/>1.5s grace for goodbye<br/>WS close → Twilio hangs up
```

Files:
- Gateway TwiML + WS proxy with Twilio HMAC-SHA1 signature check: `gateway/internal/handlers/twilio.go:64-258`.
- AI Twilio bridge (mulaw passthrough, DTMF forwarding, end_call hangup event): `ai/app/twilio_voice.py:252-602`.
- Telephony realtime config (mulaw, far-field, VAD medium): `ai/app/bt_agents/realtime/config.py:77-102`.
- The `end_call` tool sets a `contextvars.ContextVar[asyncio.Event]` that the bridge waits on — `ai/app/tools.py:1107-1139` + `ai/app/twilio_voice.py:67-70,540-566`.

---

## 7. Booking flow inside the BookingAgent

```mermaid
flowchart TD
    Entry([BookingAgent activated]) --> Inspect[Step 0: inspect transcript]
    Inspect --> Case{verified?}
    Case -- A: prior verify_coverage ok --> S2
    Case -- B: caller said self-pay --> S2
    Case -- C: not yet verified --> S1[Step 1: ask 5 insurance fields]

    S1 --> Parse5[parse multi-field paste<br/>or one-at-a-time]
    Parse5 --> Verify[verify_coverage tool]
    Verify --> ClaimMD[CLAIM.MD via SigV4 → API Gateway]
    ClaimMD --> Display[emit display_text verbatim]
    Display --> S2

    S2[Step 2: collect 5 contact fields] --> Reason
    Reason[reason] --> Phone --> Email --> Address[home address<br/>US ZIP only] --> Sex
    Sex --> S3[Step 3: time preference]
    S3 --> Slots[propose_slots tool]
    Slots --> Read[read 3 slots aloud]
    Read --> Loop{caller picked?}
    Loop -- no - different times --> S3
    Loop -- yes --> S5[Step 5: recap 10 fields]
    S5 --> Confirm{caller says yes?}
    Confirm -- correction --> S5
    Confirm -- yes --> Book[book_appointment tool]
    Book --> Hold[/internal/calendar/book - soft hold/]
    Hold --> Confirmed[/internal/calendar/confirm/]
    Confirmed --> NextStep[speak next_step verbatim]
    NextStep --> EndCall{voice?}
    EndCall -- yes --> end_call
    EndCall -- no --> Done([done])

    Hold -- 409 slot_taken --> Alts[show alternatives]
    Alts --> Loop
```

The booking prompt (`ai/app/bt_agents/booking_agent.py:48-276`) is the longest and most rule-heavy in the system. The voice variant (`ai/app/bt_agents/realtime/booking.py`) has identical steps plus the `VOICE_CONFIRMATION_RULE` (digit-by-digit / letter-by-letter readback) from `prompts.py:84-120` to defend against ASR errors.

---

## 8. Insurance verification — `verify_coverage`

```mermaid
sequenceDiagram
    autonumber
    participant Agent as InsuranceCheck / BookingAgent
    participant Tool as verify_coverage (tools.py)
    participant GW as bt-gateway
    participant APIG as AWS API Gateway (us-east-1)
    participant Lambda as CLAIM.MD Lambda
    participant DDB

    Agent->>Tool: verify_coverage(name, dob, payer, member_id)
    Tool->>Tool: validate DOB YYYYMMDD<br/>resolve_payer_id(payer_name)

    alt payer = SELF
        Tool-->>Agent: ok, eligible=false, display_text="self-pay"
    else real payer
        Tool->>APIG: signed_post /internal/insurance/verify (SigV4)
        APIG->>Lambda: invoke
        Lambda-->>APIG: {status, copay, plan}
        APIG-->>Tool: response
        Tool->>Tool: _parse_claimmd_response<br/>(status in {active, approved, eligible, ...})
        Tool->>GW: gateway_post /internal/coverage/record<br/>(audit row to bt.insurance_checks)
        GW->>DDB: write audit fields (no PHI body)
        Tool-->>Agent: ok, eligible, payer, coverage,<br/>display_text="🎉 covered through Anthem..."
    end
```

`display_text` is **composed server-side** so the LLM cannot accidentally skip telling the caller the result. The agent prompt makes this contract explicit ("emit `display_text` VERBATIM as your visible reply"). See `ai/app/tools.py:691-839` and `ai/app/bt_agents/insurance_agent.py:110-150`.

---

## 9. PHI / HIPAA boundary

Hostinger Postgres is **not** under a BAA. Every PHI byte flows through AWS DynamoDB instead.

```mermaid
flowchart LR
    subgraph Hostinger[Hostinger - NOT HIPAA]
        PG[(Postgres)]
        PG --- non[chat_sessions: id, visitor_id,<br/>source, message_count, last_message_at,<br/>ended_at, external_ref]
        PG --- ins[insurance_checks audit: payer, eligible,<br/>email_hash - no plaintext PHI]
    end

    subgraph AWS[AWS us-east-1 - HIPAA BAA]
        DDB[(DynamoDB:<br/>chat_turns, intake)]
        KMS[KMS CMK]
        APIGW[API Gateway + CLAIM.MD Lambda]
        DDB -.encrypted at rest.- KMS
    end

    Widget[ChatWidget / Voice] --> Gateway
    Gateway -- counters / pointers --> PG
    Gateway -- PutChatTurn / ListChatTurns --> DDB
    AI[bt-ai] -- /internal/chat/history --> Gateway
    AI -- signed_post SigV4 --> APIGW
```

- Message bodies, transcripts, intake details: **DynamoDB only**.
- Postgres holds non-PHI pointers — counters, source label, ended_at flag, hashed email for joining.
- The gateway `/internal/*` namespace has **no public ingress route**; cluster network isolation IS the auth boundary (`gateway/internal/handlers/chat_internal.go:14-19`).

---

## 10. Models, voices, and where they're configured

| Knob | Default | Override env |
|---|---|---|
| Chat model | (SDK default Responses model) | `OPENAI_MODEL` |
| Embedding model | `text-embedding-3-small` | `OPENAI_EMBED_MODEL` |
| Realtime model | `gpt-realtime-2` | `REALTIME_MODEL` |
| Realtime transcription | `gpt-4o-mini-transcribe` | `REALTIME_TRANSCRIPTION_MODEL` |
| Realtime voice | `marin` | `REALTIME_VOICE` |
| Realtime base URL | `wss://us.api.openai.com/v1/realtime` (US-pinned) | `REALTIME_BASE_URL` |
| Prompt cache key | `bt-chat-v1` | `BT_PROMPT_CACHE_KEY` |
| Browser-voice max session | 600 s | hard-coded `_MAX_SESSION_SECONDS` |
| Twilio max call | 900 s | `TWILIO_MAX_CALL_SECONDS` |

Defined in `ai/app/main.py:64`, `ai/app/bt_agents/realtime/config.py:13-28`, `ai/app/voice.py:41`, `ai/app/twilio_voice.py:58`.

---

## 11. Source map

```
ai/app/
├── main.py                        FastAPI: /chat, /chat/stream (SSE), /ws/voice, /twilio/voice, /twilio/media
├── voice.py                       Browser-mic ↔ OpenAI Realtime bridge (PCM16)
├── twilio_voice.py                Twilio Media Streams ↔ OpenAI Realtime bridge (μ-law)
├── agent.py                       Returns build_triage_agent()
├── tools.py                       All @function_tools + INFO/MATCHING/INTAKE/BOOKING/VOICE groups
├── prompts.py                     Shared prompt constants: PRACTICE_CONTEXT, STYLE_TEXT, STYLE_VOICE,
│                                  CRISIS_RULE, ANTI_DEFLECTION_RULE, VOICE_CONFIRMATION_RULE
├── info_cache.py                  Canned-reply cache (hours / locations) — version-keyed
├── aws_signer.py                  SigV4 signed_post / signed_get → API Gateway; gateway_post → bt-gateway
├── db.py                          Postgres pool (read-only kb / faqs / services / specialties / locations)
├── embed_faqs.py                  /internal/embed-faqs — re-embed after admin FAQ edits
├── log_stream.py + logging_config Live log SSE for /admin/* dashboard
└── bt_agents/
    ├── triage_agent.py            Text Triage — handoff-only, no tools
    ├── booking_agent.py           Text booking — full flow + verify_coverage + propose_slots + book_appointment
    ├── insurance_agent.py         Text insurance check — verify_coverage + handoff to booking
    ├── intake_agent.py            Text callback — request_intake_callback only
    ├── matching_agent.py          Text therapist matching — list_team_members, hands off to booking/intake
    ├── info_agent.py              Text practice info — kb_search + structured tools
    ├── crisis_agent.py            Text crisis — no tools, 988/911
    ├── guardrails.py              Crisis-keyword input guardrail (telemetry only, never trips)
    ├── roster.py                  Single source of truth: 6 bookable + 4 callback-only therapists
    └── realtime/
        ├── __init__.py            Re-exports build_realtime_triage + run/model configs
        ├── config.py              gpt-realtime-2, marin voice, PCM16 vs g711_ulaw, semantic VAD, US-pinned URL
        ├── triage.py              Voice Triage — same routing rules, voice persona, handoffs
        ├── booking.py             Voice booking — same 7 steps + read-back/confirmation rule
        ├── insurance.py           Voice insurance check
        ├── intake.py              Voice callback
        ├── matching.py            Voice therapist matching
        ├── info.py                Voice practice info
        └── crisis.py              Voice crisis

web/src/components/
└── ChatWidget.tsx                 SSE chat client + WS voice client + insurance dropdown picker

gateway/internal/handlers/
├── chat.go                        POST /v1/chat (non-stream)
├── chat_stream.go                 POST /v1/chat/stream (SSE proxy with detached upstream ctx)
├── chat_end.go                    POST /v1/chat/end (sendBeacon on tab close)
├── chat_internal.go               /internal/chat/{turn,history,end} — bt-ai's PHI-safe DDB API
├── voice.go                       WS /v1/voice — visitor IDOR + WS proxy to bt-ai
└── twilio.go                      POST /v1/twilio/voice (TwiML) + WS /v1/twilio/media (HMAC-SHA1 + WS proxy)
```

---

## 12. Things that look weird but are intentional

- **Two parallel agent trees** (`bt_agents/` and `bt_agents/realtime/`). The OpenAI Agents SDK uses different base classes (`Agent` vs `RealtimeAgent`) and different handoff helpers (`handoff` vs `realtime_handoff`). The voice tree is not a thin wrapper — it has its own prompts (voice persona, read-back rule) and gets `end_call`. Memory `feedback_sync_all_agents`: any prompt or tool change must be applied to **both** trees.
- **`display_text` composed server-side** in `verify_coverage`. The model used to occasionally call `transfer_to_bookingagent` without first emitting the result, leaving the caller staring at silence. Pre-rendering the message and forcing the prompt to echo it verbatim fixed it. See `ai/app/tools.py:806-838`.
- **DOB is echoed once in plain English, never as MM/DD vs DD/MM**. Memory `feedback_dob_confirm`: prior phrasing confused callers. Now: "Got it — August 19, 1998, correct?" Period.
- **ASR hallucination filter**. Whisper / `gpt-4o-mini-transcribe` emit "subscribe to our channel", "thanks for watching" on silence/non-English audio. We drop those before they hit the agent and `session.interrupt()` any response they triggered — `voice.py:74-105`, `twilio_voice.py:102-133`.
- **Greeting via `response.create` raw event, not a fake user turn**. Earlier code injected a fake "user" message which polluted the transcript. Now the SDK history starts clean and the model's first assistant turn IS the greeting — `voice.py:295-309`.
- **Detached context when proxying SSE.** A tab-close mid-reply must not cancel the upstream OpenAI call — we still need the full assistant turn for the DDB audit trail (`chat_stream.go:130`).
- **`agent_source` ContextVar** stamps every intake/coverage submission with `chat-agent` / `voice-agent` / `voice-phone`, so admin reports can split modalities (`tools.py:25`).
