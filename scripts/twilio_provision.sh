#!/usr/bin/env bash
# Twilio number provisioning — one-shot operator tool.
#
# Lists every phone number on the Twilio account, then sets the inbound voice
# webhook on the chosen number to:
#
#   https://<TWILIO_PUBLIC_HOST>/v1/twilio/voice  (HTTP POST)
#
# Reads credentials from env so nothing sensitive lives in this script:
#
#   TWILIO_ACCOUNT_SID     (required, "AC…")
#   TWILIO_API_KEY_SID     (required, "SK…")
#   TWILIO_API_KEY_SECRET  (required)
#   TWILIO_PUBLIC_HOST     (required, e.g. "brightertomorrowtherapy.cloud")
#
# Usage:
#
#   # 1. Export creds (or `source` your local .envrc — DO NOT paste inline).
#   export TWILIO_ACCOUNT_SID=AC…
#   export TWILIO_API_KEY_SID=SK…
#   export TWILIO_API_KEY_SECRET=…
#   export TWILIO_PUBLIC_HOST=brightertomorrowtherapy.cloud
#
#   # 2. List numbers (no changes).
#   ./scripts/twilio_provision.sh list
#
#   # 3. Set the voice webhook on a specific number (PN… SID from list).
#   ./scripts/twilio_provision.sh set PN1234567890abcdef1234567890abcdef
#
#   # 4. Verify (re-fetches the number and shows its voice URL).
#   ./scripts/twilio_provision.sh verify PN1234567890abcdef1234567890abcdef
#
# Twilio API auth: HTTP Basic with API Key SID as username and secret as
# password, scoped under the AccountSid in the URL path. Preferred over
# AccountSid+AuthToken because the API key can be rotated independently.
# Docs: https://www.twilio.com/docs/usage/api/keys

set -euo pipefail

# ---- Pretty output -------------------------------------------------------
red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
bold()   { printf "\033[1m%s\033[0m\n" "$*"; }

# ---- Required env --------------------------------------------------------
require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    red "Missing env: $name"
    red "See header of this script for the four required variables."
    exit 2
  fi
}
require_env TWILIO_ACCOUNT_SID
require_env TWILIO_API_KEY_SID
require_env TWILIO_API_KEY_SECRET
require_env TWILIO_PUBLIC_HOST

if ! command -v curl >/dev/null; then red "curl not installed"; exit 2; fi
if ! command -v jq   >/dev/null; then red "jq not installed";   exit 2; fi

API_BASE="https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}"
WEBHOOK_URL="https://${TWILIO_PUBLIC_HOST}/v1/twilio/voice"

twilio_get() {
  curl -fsS -u "${TWILIO_API_KEY_SID}:${TWILIO_API_KEY_SECRET}" "$@"
}

twilio_post() {
  curl -fsS -u "${TWILIO_API_KEY_SID}:${TWILIO_API_KEY_SECRET}" -X POST "$@"
}

# ---- Subcommands ---------------------------------------------------------

cmd_list() {
  bold "Phone numbers on account ${TWILIO_ACCOUNT_SID}:"
  echo
  twilio_get "${API_BASE}/IncomingPhoneNumbers.json?PageSize=100" \
    | jq -r '
        .incoming_phone_numbers[]
        | "  " + .sid + "  " + .phone_number + "  " + (.friendly_name // "—")
          + "\n      voice_url: " + (.voice_url // "(unset)")
          + "\n      voice_method: " + (.voice_method // "(unset)")
          + "\n"
      '
}

cmd_set() {
  local pn_sid="${1:-}"
  if [[ -z "$pn_sid" ]]; then red "usage: $0 set <PN_SID>"; exit 2; fi

  bold "Setting voice webhook on ${pn_sid}"
  echo "  URL:    ${WEBHOOK_URL}"
  echo "  Method: POST"
  echo

  twilio_post \
    --data-urlencode "VoiceUrl=${WEBHOOK_URL}" \
    --data-urlencode "VoiceMethod=POST" \
    --data-urlencode "VoiceFallbackUrl=${WEBHOOK_URL}" \
    --data-urlencode "VoiceFallbackMethod=POST" \
    "${API_BASE}/IncomingPhoneNumbers/${pn_sid}.json" \
    > /tmp/twilio_set.json

  green "OK — webhook updated. Verifying…"
  echo
  cmd_verify "$pn_sid"
}

cmd_verify() {
  local pn_sid="${1:-}"
  if [[ -z "$pn_sid" ]]; then red "usage: $0 verify <PN_SID>"; exit 2; fi

  local resp
  resp=$(twilio_get "${API_BASE}/IncomingPhoneNumbers/${pn_sid}.json")
  local current
  current=$(printf '%s' "$resp" | jq -r '.voice_url')

  bold "Current voice config on ${pn_sid}:"
  printf '%s' "$resp" | jq '{
    sid, phone_number, friendly_name,
    voice_url, voice_method,
    voice_fallback_url, voice_fallback_method,
    status_callback, status_callback_method
  }'
  echo

  if [[ "$current" == "$WEBHOOK_URL" ]]; then
    green "✓ voice_url matches ${WEBHOOK_URL}"
  else
    yellow "✗ voice_url is '${current}', expected '${WEBHOOK_URL}'"
    yellow "  Run: $0 set ${pn_sid}"
    exit 1
  fi
}

# ---- Entry ---------------------------------------------------------------

case "${1:-}" in
  list)   shift; cmd_list   "$@" ;;
  set)    shift; cmd_set    "$@" ;;
  verify) shift; cmd_verify "$@" ;;
  *)
    cat <<EOF
Twilio number provisioning.

Commands:
  $0 list                 # list every PN on the account + its voice config
  $0 set    <PN_SID>      # set voice webhook to https://${TWILIO_PUBLIC_HOST}/v1/twilio/voice
  $0 verify <PN_SID>      # confirm the voice webhook matches expected URL

Required env: TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_PUBLIC_HOST.
EOF
    exit 1
    ;;
esac
