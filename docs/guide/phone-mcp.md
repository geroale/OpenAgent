# Phone & SMS (Messaging MCP)

The messaging MCP can also place outbound phone calls and send SMS / MMS via Twilio. Phone calls are AI-driven — you give the agent a free-text **mission** (e.g. *"call this restaurant and book a table for 4 at 7pm"*), the tool places the call, an embedded conversational AI handles the live audio end-to-end, and the tool returns transcript + notes + outcome when the call ends.

Tools registered (only when Twilio creds are configured):

| Tool | What it does |
|---|---|
| `sms_send` | Send a plain-text SMS |
| `sms_send_file` | Send MMS (file via SMS, public URL only — Twilio constraint) |
| `phone_call_place` | Place an AI-driven outbound call. Returns `call_id`. |
| `phone_call_status` | Get current state / partial transcript / final result. With `wait=true`, long-polls for the next state change. |
| `phone_call_hangup` | Force-end an in-flight call. |

The `status` tool always reports the phone block's `enabled / how_to_enable` flag, even without creds.

---

## Setup

### 1. Twilio account

You need:

- A Twilio account (free trial gives you a sandbox number that can call/SMS your own verified phone)
- A Twilio phone number with **Voice + SMS** capabilities (US/CA/UK numbers commonly have both; Italian numbers are SMS-only — check the capability matrix when buying)
- Your **Account SID** and **Auth Token** from the Twilio Console

### 2. OpenAI API key

The live-call AI brain runs on the **OpenAI Realtime API** (`gpt-realtime` model). Audio uses g711 mu-law end-to-end so there's no codec conversion. Latency is ~300–500 ms response start, which is what makes the call feel live rather than robotic.

You need an `OPENAI_API_KEY` with access to the Realtime API. A 5-minute call costs roughly $0.50–1.50 in OpenAI charges plus Twilio's per-minute rate.

### 3. Public webhook URL

Twilio's Media Streams need to reach a public WebSocket endpoint to send audio frames. The MCP runs an internal HTTP+WS server on a random localhost port; you need to tunnel it. For development:

```bash
ngrok http 0  # ngrok will follow the random port via the http traffic; set OPENAGENT_PHONE_PUBLIC_URL once it stabilises
```

In practice it's easier to pick a fixed port and pin it via reverse-tunnel — set up `cloudflared tunnel run <name> --url http://127.0.0.1:<port>` with a stable hostname, then set `OPENAGENT_PHONE_PUBLIC_URL` to that hostname.

> **SMS does not need a tunnel.** If you only want SMS, leave `OPENAGENT_PHONE_PUBLIC_URL` unset; `sms_send` works without it. Voice calls fail loudly with a clear error until the tunnel is configured.

### 4. Wire it up in `openagent.yaml`

```yaml
mcp:
  - builtin: messaging
    env:
      # Existing channels still work alongside Twilio
      TELEGRAM_BOT_TOKEN: "${TELEGRAM_BOT_TOKEN}"
      # Twilio voice + SMS
      TWILIO_ACCOUNT_SID: "${TWILIO_ACCOUNT_SID}"
      TWILIO_AUTH_TOKEN:  "${TWILIO_AUTH_TOKEN}"
      TWILIO_FROM_NUMBER: "+15551234567"
      OPENAI_API_KEY:     "${OPENAI_API_KEY}"
      OPENAGENT_PHONE_PUBLIC_URL: "https://<your-tunnel>.ngrok.app"
      # Safety knobs (see below)
      OPENAGENT_PHONE_ALLOW_PREFIXES: "+39,+1212"
      OPENAGENT_PHONE_MAX_DURATION_SECONDS: "600"
      OPENAGENT_PHONE_MAX_DAILY_SECONDS: "3600"
      OPENAGENT_PHONE_VOICE: "alloy"
```

Restart the agent. Confirm registration by asking the agent to call `messaging.status` — the `phone` block should show `enabled: true` with the five tool names.

---

## Safety knobs

These are **on by default** for good reason. Read this section before enabling the phone MCP on any account that can dial out.

### Destination allowlist (default = deny all)

`OPENAGENT_PHONE_ALLOW_PREFIXES` is a comma-separated list of E.164 prefixes the agent is permitted to dial. **Empty list = deny all destinations.** This is the deny-by-default safety stance: if the agent is jailbroken or misuses the tool, the worst it can do is fail an allowlist check.

Set the list to the country / area codes you actually call:

```yaml
OPENAGENT_PHONE_ALLOW_PREFIXES: "+39,+1212"   # Italy + NYC
```

### Per-call max duration

`OPENAGENT_PHONE_MAX_DURATION_SECONDS` (default `600`, i.e. 10 minutes). The bridge force-hangs-up calls that exceed this. The agent can pass a `max_duration_seconds` arg on `phone_call_place` but it is **clamped down only** — you cannot raise it above the server cap from the model's tool call.

### Per-day total cap

`OPENAGENT_PHONE_MAX_DAILY_SECONDS` (default `3600`, i.e. 1 hour). Sum of completed-call durations rolls over each UTC day. New calls are refused once the cap is reached. This counter resets at process restart in v1; Twilio's own account-level spend caps in the Twilio Console remain the durable backstop.

### Mandatory AI disclosure

The system prompt baked into every call **requires** the AI to disclose itself as an AI assistant on its first utterance ("Hi, I'm an AI assistant calling on behalf of {caller}…"). It also instructs the AI to answer truthfully if asked whether it is human / AI / a recording. This is non-negotiable in v1 and not exposed as a tunable.

### No call recording

Recording is intentionally **not** supported in v1. Two-party-consent jurisdictions (CA, IL, FL, MA, MD, MT, NV, NH, PA, WA, plus several more) require explicit consent to record. Building a one-knob "allow_recording" option is a footgun. v2 will revisit this with jurisdiction-aware consent gating.

### Twilio webhook signature verification

Both `POST /twiml/:id` and `POST /status/:id` validate `X-Twilio-Signature` against `TWILIO_AUTH_TOKEN` using the official Twilio SDK validator. Unsigned requests get `403`. The signature uses the public URL (`OPENAGENT_PHONE_PUBLIC_URL`) — make sure that variable matches the URL Twilio is actually hitting (no trailing slash, scheme included).

---

## Legal warnings — read before placing real calls

This is **not legal advice**. Talk to a lawyer before deploying this commercially.

- **TCPA (USA).** The FCC ruled in February 2024 that AI-generated voices count as "artificial or prerecorded voice" under TCPA §227(b)(1)(A). That makes most AI-driven outbound calls to US cell numbers without prior express written consent **illegal**, full stop. The disclosure preamble is necessary but not sufficient.
- **Two-party-consent recording laws.** Even though v1 doesn't record, some jurisdictions impose duties on AI-mediated calls (e.g. California's "AI bot" disclosure law). Disclose, log nothing sensitive, and ask a lawyer before going commercial.
- **Premium-rate / international fraud.** Premium-rate numbers (`+1900`, `+1976`, many `+44 70x`, etc.) charge the *caller* per minute. Use the allowlist.
- **Emergency services.** Never let an AI call `911` / `112` / `999`. Add explicit blocks if your allowlist is broad.

If your usage is **outbound calls to your own contacts on your own behalf** ("call my dentist for me") and you're calling from a number registered to you, you're in a much safer zone than if you're using this for marketing or research outreach. The framework lets you do both — only the first is OK out of the box.

---

## Example missions

Good mission prompts are **specific** and include the exit conditions:

> *"Call my dentist at +1-415-555-0142. Confirm or reschedule my appointment that's currently set for Friday afternoon. I'm flexible on time but prefer mornings. Identify yourself as an AI assistant calling on behalf of Alessandro Gerelli. End the call once you have a confirmed time or learn they're closed."*

> *"Call this restaurant and book a table for 4 at 7pm tomorrow under the name Alessandro. We have one vegetarian and one nut allergy. If 7pm is unavailable, take the closest slot between 6:30 and 8:00. Get the confirmation number."*

The agent's `success_criteria` arg lets the AI judge `outcome=success / partial / failure`. Use it to tighten the mission.

---

## Tool API summary

```jsonc
// Returns immediately
phone_call_place({
  to: "+393331234567",
  mission: "Book a table for 4 at 7pm under Alessandro.",
  caller_identity: "Alessandro Gerelli",        // optional
  language: "it-IT",                             // optional, default en-US
  success_criteria: "Confirmed reservation with name + time",  // optional
  max_duration_seconds: 300                      // optional, clamped to server cap
})
// → { call_id: "uuid", status: "initiated", twilio_sid: "CA…" }

// Long-poll for state changes
phone_call_status({ call_id: "uuid", wait: true })
// → { status: "in_progress" | "completed" | …,
//     transcript: [{t, role: "agent"|"caller"|"system", text}],
//     notes: ["...", "..."],
//     summary: "...", outcome: "success"|"partial"|"failure"|"no_answer"|"voicemail",
//     started_at, answered_at, ended_at, duration_s }

// Force end
phone_call_hangup({ call_id: "uuid" })
// → final session snapshot, status="hung_up_by_agent"
```

---

## v2 (deferred)

- Optional call recording with jurisdiction-aware consent gating.
- Persistence of transcripts to SQLite (currently in-memory; resets on process restart).
- Inbound calls (call-screening, voicemail-to-LLM, escalation to user via existing channels).
- Per-call cost tracking (Twilio + OpenAI) in `phone_call_status`.
- Outbound DTMF (currently inbound DTMF surfaces to the AI; outbound requires Twilio call interruption that ruins the live conversation, so it's deferred).
- Bundled cloudflared tunnel so you don't have to run ngrok manually.
- Split-stack engine (use OpenAgent's smart-routed `BaseModel` for the brain instead of OpenAI Realtime — requires a future gateway HTTP inference endpoint reachable from this Node MCP).
- `phone_buy_number()` provisioning tool.
