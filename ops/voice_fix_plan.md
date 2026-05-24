# Voice pipeline — fix plan (from 2026-05-23 call log, stream MZ3eb5f2…)

Source: `logs.txt` — a 6-min call (turns 4–23) that never completed insurance
verification. Streaming + no-doubling are **confirmed working**; the failures
below are what's left.

Severity: **P0** = call can't complete its job / actively broken. **P1** = major UX.

---

## P0-1 — Echo gate is eating the caller (58% of audio dropped, zero barge-in)

**Evidence:** `twilio_reader_end … frames_seen=19068 echo_gated=11116` → **58%**
of inbound frames dropped. **No `twilio_bargein` event in the entire call** despite
an audibly frustrated caller talking over long agent replies.

**Root cause:** the gate (`voice_twilio.py`, `_ECHO_GATE_RMS=1700`) drops *every*
inbound frame below 1700 RMS while `agent_speaking`. It's a blunt single-threshold
gate with no cooldown and no calibration — it suppresses real caller speech, so
barge-in can never fire and the caller's words during agent speech are lost.

**Market standard** ([Deepgram AEC](https://developers.deepgram.com/docs/voice-agent-echo-cancellation),
[dev.to AEC writeup](https://dev.to/remi_etien/i-built-a-voice-ai-with-sub-500ms-latency-heres-the-echo-cancellation-problem-nobody-talks-about-14la)):
true AEC subtracts the agent's *known output* from the input. The lightweight
substitute is a **two-tier gate with a short cooldown** (gate only while actively
emitting + ~1.5 s after), not a blanket drop. Twilio PSTN also already does its own
echo cancellation.

**Fix (staged):**
1. **Immediate:** set `TWILIO_ECHO_GATE_RMS=0` (disable) — rely on Twilio's PSTN
   AEC. Re-test: confirm barge-in fires and the agent does **not** transcribe
   itself. (One-line env change in `k8s/20-ai.yaml`.)
2. **If self-interruption appears:** re-enable as a *cooldown* gate — only gate for
   the first ~300 ms of each `_send_audio` chunk burst, not the whole turn; and
   calibrate the threshold from the first 1 s of the call's noise floor instead of
   a hardcoded 1700.
3. **Best (later):** real AEC — keep a ring buffer of recently-sent mulaw and
   suppress inbound frames that correlate with it.

**Files:** `k8s/20-ai.yaml` (env), `ai/app/graph/runtime/voice_twilio.py` (gate logic).
**Risk:** low. **Validation:** `echo_gated` drops to <10%; `twilio_bargein` fires when you talk over the agent.

---

## P0-2 — Insurance intake loops in `info_answer`, never reaches `verify_insurance`

**Evidence:** turns 18–23 — caller says "check my insurance / check my coverage /
Anthem" repeatedly; planner routes `reason=ask_insurance_field` but `respond`
renders `scene=info_answer` (the in-network carrier list) **three+ times** and
re-asks "what insurance do you have?" The call ends (`twilio_stop`) still in
collection — `verify=False` the whole time.

**Root cause:** `respond._pick_scene` (`ai/app/graph/nodes/respond.py`) overrides the
planner's `ask_insurance_field` with `info_answer` whenever the caller's turn looks
like a question. During an *active intake*, meta-questions should get a one-line ack
then return to the next missing field — not restart the info spiel.

**Market standard:** task-oriented voice agents stay in the active task; brief aside
→ answer in ≤1 sentence → immediately re-prompt the pending field. Never re-deliver
the same info block twice.

**Fix:**
1. In `_pick_scene`, when `intent=insurance_check` AND insurance fields are partially
   collected (`first_missing_insurance` is not None), **prefer `ask_insurance_field`**
   over `info_answer` unless the caller explicitly changed intent.
2. De-dupe: if the last assistant turn already delivered the in-network list, don't
   repeat it — just ask the next field.
3. Verify the planner advances to `verify_insurance` once all 5 fields are set
   (it did in earlier clean calls, so the gate is the scene-selection, not the planner).

**Files:** `ai/app/graph/nodes/respond.py` (`_pick_scene`), possibly
`ai/app/graph/nodes/planner.py`. **Risk:** medium (scene logic is shared). **Validation:** caller saying "check coverage" + payer advances to DOB/member-ID, then `verify_insurance` fires.

---

## P1-1 — Latency: ~5–6 s per turn is the `extract` LLM (gpt-5.5)

**Evidence:** `final transcript → extract log` ≈ 5–6 s every turn (19:58:02→08,
19:58:37→42, 20:01:29→34), then +2–3 s for respond's first token. First audio ~8–10 s.

**Root cause:** `extract` runs **gpt-5.5** (flagship) for what is structured
intent/field classification, *before* respond can start. Two sequential flagship
calls per turn.

**Market standard** ([LiveKit](https://livekit.com/blog/understand-and-improve-agent-latency),
[Smallest.ai latency budget](https://smallest.ai/blog/designing-voice-assistants-stt-llm-tts-tools-and-latency-budget)):
use a **small/fast model for the routing/extraction stage**; reserve the flagship
for the patient-facing reply. Target <800 ms LLM TTFT.

**Fix (pick one; recommend a+b):**
- **(a)** Set `OPENAI_EXTRACT_MODEL=gpt-5-mini` (or `gpt-4.1-mini`) — extract only;
  respond stays gpt-5.5. ~4 s/turn saved. *(Tradeoff you flagged: you wanted gpt-5.5
  everywhere. This is the single biggest latency lever and the industry norm — extract
  is classification, not prose. Recommend revisiting.)*
- **(b)** Expand the deterministic fast-path (`extract.py:_try_deterministic_fast_path`)
  to skip the LLM entirely for trivial turns — bare "yes"/"no", a recognized payer
  name, a DOB-shaped string. Many turns in this log ("yes", "Anthem") qualify. No
  model change; keeps gpt-5.5 for substantive turns.
- **(c)** Streaming already shipped — keep it (it's saving the respond half).

**Files:** `k8s/20-ai.yaml` (a), `ai/app/graph/nodes/extract.py` (b).
**Risk:** (a) low, (b) medium. **Validation:** `transcript→extract` <1.5 s on trivial turns.

---

## P1-2 — Name/spelling capture death-spiral on 8 kHz

**Evidence:** "Sagar Shankaran" became "Soccer", "Sankran", "Shenkeran", "daughter";
agent accepted implausible words as names and looped spelling corrections (turns 4–16,
~3 min wasted).

**Root cause:** (1) Deepgram on 8 kHz mulaw mishears arbitrary names; (2) the agent
accepts dictionary words ("daughter", "soccer") as names without challenge; (3) the
correction flow has no attempt cap — it loops indefinitely.

**Market standard** ([Deepgram keyterm](https://developers.deepgram.com/docs/keyterm)):
keyterm-prompt known vocab (payer names, practice terms) for up to 90% better recall;
for arbitrary names, collect NATO letter-by-letter, don't auto-format, and **cap retries**.

**Fix:**
1. Add `keyterms=[…]` to `deepgram.STT(...)` (`voice_pipeline.py:_build_plugins`) for
   the known payer names (Anthem, Cigna, Aetna, UnitedHealthcare, …) and key practice
   terms so "Anthem"/"the school with Anthem" resolve correctly.
2. After **2** failed name-spelling confirmations, stop looping: accept the best-effort
   spelling + flag for admin review, OR offer a callback. (Scene/prompt change.)
3. Reject obviously-implausible single-word names (dictionary words) — re-ask with
   "could you spell that letter by letter?" instead of confirming "daughter".

**Files:** `ai/app/graph/runtime/voice_pipeline.py` (keyterms),
`ai/app/graph/prompts/_constants.py` + scenes (retry cap, implausible-name guard).
**Risk:** low–medium. **Validation:** payer names transcribe cleanly; name collection caps at 2 retries.

---

## Suggested order of work
1. **P0-1 echo gate** — 1-line env disable, immediate barge-in recovery, lowest risk.
2. **P0-2 insurance loop** — unblocks the core task (verification).
3. **P1-1 latency** — decision needed: fast extract model (a) vs fast-path (b).
4. **P1-2 name capture** — keyterms first (cheap win), then retry cap.

Each step: deploy via `ops/deploy-changed.sh` (tarball fallback now automatic),
then re-run a test call and confirm against the validation line above using the
two-layer logging (`bt-ai` + `bt-gateway`).
