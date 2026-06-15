#!/usr/bin/env bash
# twilio-configure-messaging-service.sh
# ---------------------------------------------------------------------------
# Helps configure the Brighter Tomorrow A2P Messaging Service AFTER the A2P
# campaign has been created (the campaign auto-creates the Messaging Service).
#
# What this script CAN do (Twilio REST API supports it):
#   • list   — find the Messaging Service SID created by the campaign
#   • show   — print a service's senders + inbound webhook config
#   • attach — add the 10DLC phone number to the Messaging Service
#   • set-webhook — point inbound SMS at the gateway (optional, for STOP/HELP
#                   handling beyond Twilio defaults / future 2-way replies)
#
# What this script CANNOT do (NO Twilio API exists for it — Console only):
#   • Custom Advanced Opt-Out STOP/HELP/opt-in keywords + branded replies.
#     Twilio's DEFAULT STOP/HELP handling is already carrier-compliant; the
#     branded replies below are optional polish set in the Console. The exact
#     wording is printed by `instructions` and lives in
#     twilio-a2p-campaign-BT.txt.
#
# Credentials: uses Twilio API Key auth (preferred). Reads from env, or pulls
# from the k8s bt-config secret with --from-k8s.
#
# Usage:
#   export TWILIO_ACCOUNT_SID=AC... TWILIO_API_KEY_SID=SK... TWILIO_API_KEY_SECRET=...
#   ops/twilio-configure-messaging-service.sh list
#   ops/twilio-configure-messaging-service.sh show   MGxxxxxxxx
#   ops/twilio-configure-messaging-service.sh attach MGxxxxxxxx PNxxxxxxxx
#   ops/twilio-configure-messaging-service.sh set-webhook MGxxxxxxxx https://brightertomorrowtherapy.com/twilio/sms
#   ops/twilio-configure-messaging-service.sh instructions
#   # add --from-k8s to any command to read creds from the bt-config secret
# ---------------------------------------------------------------------------
set -euo pipefail

API="https://messaging.twilio.com/v1"
CMD="${1:-help}"; shift || true

# ----- credentials ----------------------------------------------------------
if [[ "${*:-}" == *"--from-k8s"* ]] || [[ "${FROM_K8S:-}" == "1" ]]; then
  echo ">>> reading Twilio creds from k8s secret bt-config (namespace bt)" >&2
  TWILIO_ACCOUNT_SID=$(kubectl get secret bt-config -n bt -o jsonpath='{.data.TWILIO_ACCOUNT_SID}' | base64 -d)
  TWILIO_API_KEY_SID=$(kubectl get secret bt-config -n bt -o jsonpath='{.data.TWILIO_API_KEY_SID}' | base64 -d)
  TWILIO_API_KEY_SECRET=$(kubectl get secret bt-config -n bt -o jsonpath='{.data.TWILIO_API_KEY_SECRET}' | base64 -d)
fi

: "${TWILIO_ACCOUNT_SID:?set TWILIO_ACCOUNT_SID (or pass --from-k8s)}"
: "${TWILIO_API_KEY_SID:?set TWILIO_API_KEY_SID (or pass --from-k8s)}"
: "${TWILIO_API_KEY_SECRET:?set TWILIO_API_KEY_SECRET (or pass --from-k8s)}"

# Basic auth uses APIKeySid:APIKeySecret; the Account SID scopes the resources.
AUTH=(-u "${TWILIO_API_KEY_SID}:${TWILIO_API_KEY_SECRET}")

have_jq() { command -v jq >/dev/null 2>&1; }

case "$CMD" in
  list)
    echo ">>> Messaging Services on account ${TWILIO_ACCOUNT_SID}:"
    if have_jq; then
      curl -sf "${AUTH[@]}" "${API}/Services?PageSize=50" \
        | jq -r '.services[] | "\(.sid)\t\(.friendly_name)\tinbound=\(.inbound_request_url // "-")"'
    else
      curl -sf "${AUTH[@]}" "${API}/Services?PageSize=50"
      echo; echo "(install jq for a cleaner table)"
    fi
    ;;

  show)
    SID="${1:?usage: show <MessagingServiceSid>}"
    echo ">>> Service ${SID}:"
    curl -sf "${AUTH[@]}" "${API}/Services/${SID}" | { have_jq && jq . || cat; }
    echo ">>> Senders (phone numbers) on ${SID}:"
    curl -sf "${AUTH[@]}" "${API}/Services/${SID}/PhoneNumbers?PageSize=50" \
      | { have_jq && jq -r '.phone_numbers[] | "\(.sid)\t\(.phone_number)"' || cat; }
    ;;

  attach)
    SID="${1:?usage: attach <MessagingServiceSid> <PhoneNumberSid>}"
    PN="${2:?usage: attach <MessagingServiceSid> <PhoneNumberSid>}"
    echo ">>> attaching ${PN} to ${SID} ..."
    curl -sf "${AUTH[@]}" -X POST "${API}/Services/${SID}/PhoneNumbers" \
      --data-urlencode "PhoneNumberSid=${PN}" | { have_jq && jq . || cat; }
    echo "done."
    ;;

  set-webhook)
    SID="${1:?usage: set-webhook <MessagingServiceSid> <InboundRequestUrl>}"
    URL="${2:?usage: set-webhook <MessagingServiceSid> <InboundRequestUrl>}"
    echo ">>> setting inbound webhook on ${SID} -> ${URL}"
    curl -sf "${AUTH[@]}" -X POST "${API}/Services/${SID}" \
      --data-urlencode "InboundRequestUrl=${URL}" \
      --data-urlencode "InboundMethod=POST" | { have_jq && jq . || cat; }
    echo "done."
    ;;

  instructions)
    cat <<'EOF'

================================================================================
ADVANCED OPT-OUT — Console-only (no Twilio API). Optional branded replies.
Twilio's DEFAULT STOP/HELP handling is already carrier-compliant; do this only
to brand the auto-replies.
Console: Messaging > Services > [BT service] > Opt-Out Management > Advanced Opt-Out
================================================================================

OPT-IN keywords:        START, JOIN, SUBSCRIBE, YES
OPT-IN (re-subscribe) message:
  Brighter Tomorrow Therapy: You're opted in to appointment & practice texts
  (up to ~2/month). Msg & data rates may apply. Reply HELP for help, STOP to
  opt out.

OPT-OUT keywords:       STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT  (defaults)
OPT-OUT (STOP) message:
  Brighter Tomorrow Therapy: You're unsubscribed and will receive no more
  texts. Reply START to rejoin. For help, call 725-238-6990.

HELP keywords:          HELP, INFO
HELP message:
  Brighter Tomorrow Therapy: For help, call 725-238-6990 or visit
  brightertomorrowtherapy.com. Msg & data rates may apply. Reply STOP to opt out.

(These mirror twilio-a2p-campaign-BT.txt. Keep the ~2/month frequency
 consistent with the campaign + website consent + privacy policy.)
================================================================================
EOF
    ;;

  *)
    sed -n '2,40p' "$0"
    ;;
esac
