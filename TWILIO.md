# Twilio Voice — phone access to the BT realtime agent

End-to-end picture:

```
  PSTN caller
      │  dial +1 (XXX) XXX-XXXX
      ▼
  Twilio number  ──webhook──►  POST https://brightertomorrowtherapy.cloud/v1/twilio/voice
                                  │
                                  ▼   (TwiML returned)
                               <Connect><Stream
                                   url="wss://brightertomorrowtherapy.cloud/v1/twilio/media"/>
                                  │
                                  ▼   (bidirectional mulaw 8 kHz frames)
  Twilio Media Stream  ◄──►  bt-gateway  ◄──ws──►  bt-ai
                                                     │
                                                     ▼
                                            OpenAI Realtime  (gpt-realtime-2)
                                            input_audio_format:  g711_ulaw
                                            output_audio_format: g711_ulaw
```

End-to-end audio stays as μ-law 8 kHz mono in both directions — no resampling on
our side, no CPU spent on PCM conversion. The same realtime triage / intake /
booking / insurance / crisis / matching agent graph used by the website voice
widget answers the call, and transcripts persist to the same DynamoDB PHI store.

---

## 1. HIPAA prerequisites (do this first)

1. **Sign Twilio's BAA**. Log in to console.twilio.com → Settings → Compliance →
   HIPAA → request the BAA. **Do not enable phone numbers for production calls
   until the BAA is countersigned.**
2. **Turn off recording on the calling number.** Twilio call recording is *not*
   covered the same way under the BAA, and we have no business need for raw
   audio recordings of patient PHI. In the number's Voice config, leave
   "Record" disabled.
3. **Disable Twilio Voice Intelligence / transcription services** on the
   number — transcripts already flow through OpenAI under their BAA and our
   own PHI store; doubling up creates extra PHI surface to manage.

## 2. Provision a Twilio number

1. Twilio Console → Phone Numbers → Manage → Buy a number → US, Voice
   capability.
2. After purchase, open the number's configuration page.
3. Under **Voice & Fax → "A CALL COMES IN"** set:
   - Type: **Webhook**
   - URL:  `https://brightertomorrowtherapy.cloud/v1/twilio/voice`
   - HTTP method: **HTTP POST**
4. Under **"PRIMARY HANDLER FAILS"** (optional) set the same URL — Twilio will
   replay the webhook if it gets a 5xx.
5. Save.

## 3. Drop the credentials into the cluster

Edit `k8s/10-secrets.yaml` (gitignored), add the four keys:

```yaml
stringData:
  # ... existing keys ...
  TWILIO_AUTH_TOKEN:    "<copy from Twilio Console → Account → API keys & tokens>"
  TWILIO_PUBLIC_HOST:   "brightertomorrowtherapy.cloud"
  BT_PUBLIC_WS_BASE:    "wss://brightertomorrowtherapy.cloud"
```

Apply:

```bash
kubectl apply -f k8s/10-secrets.yaml
kubectl -n bt rollout restart deploy/bt-gateway deploy/bt-ai
```

Verify the rollout:

```bash
kubectl -n bt logs deploy/bt-gateway | grep -i twilio
# Expect: "twilio voice enabled public_host=brightertomorrowtherapy.cloud"
```

If the log says `twilio voice disabled — TWILIO_AUTH_TOKEN not set`, the
secret didn't get picked up. Re-check the key name in `10-secrets.yaml`.

## 4. Smoke test

Call the Twilio number from any phone. Expected behavior:

- Within ~1 second the agent speaks the greeting:
  *"Hi, I'm the Brighter Tomorrow assistant. This conversation is
  HIPAA-compliant and your information is secure. I can help you book an
  appointment, check insurance coverage, find a therapist, or answer
  questions about the practice — which would you like?"*
- Speaking interrupts the agent mid-sentence (barge-in via the
  `RealtimeAudioInterrupted` → `clear` event path).
- Asking to book an appointment → agent runs the booking handoff exactly
  like on the website voice widget. The booking ends up in
  `/admin/appointments` tagged `source = voice-agent`.

Logs to watch while testing:

```bash
# Gateway side — TwiML response + signature verification.
kubectl -n bt logs -f deploy/bt-gateway | grep -E 'twilio: '

# AI side — full session lifecycle.
kubectl -n bt logs -f deploy/bt-ai | grep -E 'twilio_'
```

Useful log lines:

| Log message                         | Meaning                                            |
| ----------------------------------- | -------------------------------------------------- |
| `twilio: voice webhook ...`         | Inbound call routed through the gateway TwiML path |
| `twilio: media bridge open ...`     | WS upgrade succeeded; mulaw frames now flowing     |
| `twilio_session_start ...`          | Realtime session up; agent has greeted             |
| `twilio_handoff from=triage to=...` | Agent specialist handoff                           |
| `twilio_tool_start tool=...`        | Tool invocation (book / coverage / etc.)           |
| `twilio_session_end duration_s=...` | Call complete; transcript flushed to DynamoDB      |

## 5. Failure modes & responses

| Symptom                                | Cause                                                 | Fix                                                                |
| -------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| Twilio plays "an application error" | Webhook 5xx or signature mismatch                    | Check `kubectl logs deploy/bt-gateway` — usually `TWILIO_AUTH_TOKEN` wrong |
| Call connects but silence              | OpenAI Realtime WS dial failed                       | `kubectl logs deploy/bt-ai` — look for `twilio_runner_failed`     |
| Caller hears garbled robot voice       | Audio format mismatch (PCM16 leaked into the pipe)   | Confirm `build_telephony_run_config()` is the active config       |
| Caller's words ignored                 | VAD never fires (mulaw header bytes leaked into data) | Twilio sends raw mulaw; our handler base64-decodes — check logs   |
| Calls drop after 15 min                | `_MAX_CALL_SECONDS` cap                              | Bump `TWILIO_MAX_CALL_SECONDS` env on `bt-ai` if business-justified |
| 403 on every webhook                   | TwiML URL doesn't match what Twilio signed           | `TWILIO_PUBLIC_HOST` mismatch — must equal the Twilio webhook host |

## 6. Operational notes

- **Concurrent call ceiling.** Each call holds two WebSockets (Twilio↔gateway
  and gateway↔bt-ai) plus one to OpenAI Realtime. The gateway has no per-call
  CPU work — the mulaw bytes pass through as opaque WS frames. The realtime
  agent graph on `bt-ai` is the real ceiling; today the deployment runs
  `requests: cpu 50m / memory 128Mi` and `limits: cpu 500m / memory 512Mi`,
  which is enough for ~5–10 concurrent calls. Bump replicas or limits before
  promoting the number to a real marketing channel.
- **Rate limiting.** `httprate.LimitByIP(20, time.Minute)` is set on both
  Twilio endpoints. Twilio retries 5xx with backoff, so 429 is acceptable.
- **No PHI leaves the BAA scope.** Audio: Twilio (BAA) → OpenAI (BAA on the
  Anthropic-style enterprise tier you're already on). Transcripts:
  DynamoDB (KMS-encrypted, AWS BAA). Postgres on Hostinger never sees
  the voice message body — only the chat-session pointer row.
- **Disabling voice quickly.** Unset `TWILIO_AUTH_TOKEN` in
  `k8s/10-secrets.yaml` and restart the gateway; both endpoints return
  `503 twilio not configured`. (The phone number still rings but Twilio
  hears a 503 and plays its default error apology.)
