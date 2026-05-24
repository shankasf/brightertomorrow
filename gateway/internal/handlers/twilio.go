// Package handlers — Twilio Voice webhook + Media Streams proxy.
//
// Twilio call flow:
//
//  1. Caller dials our Twilio number.
//  2. Twilio POSTs application/x-www-form-urlencoded to /v1/twilio/voice.
//     We verify X-Twilio-Signature (HMAC-SHA1 of URL + sorted form params,
//     base64) and return a TwiML <Connect><Stream> that points Twilio at
//     wss://<host>/v1/twilio/media.
//  3. Twilio opens that WebSocket. We verify X-Twilio-Signature on the
//     upgrade request (URL only — no body), upgrade, and proxy verbatim
//     to bt-ai's internal /twilio/media WS.
//
// The auth token lives in env TWILIO_AUTH_TOKEN (matches Twilio Console).
// If the token is empty we refuse the request — never silently accept.
package handlers

import (
	"context"
	"crypto/hmac"
	"crypto/sha1" //nolint:gosec // Twilio mandates SHA1 for signature verification.
	"encoding/base64"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
)

// TwilioHandler serves the inbound voice webhook and the bidirectional Media
// Streams WebSocket proxy. Both halves require Twilio signature verification.
type TwilioHandler struct {
	// Pool — Postgres connection pool. Used to register a chat_sessions row
	// (non-PHI pointer) at the start of every call so the call shows up in
	// the admin /admin/chat dashboard alongside text + browser-voice chats.
	Pool *pgxpool.Pool
	// AuthToken — Twilio account auth token. Used to validate the
	// X-Twilio-Signature header. MUST NOT be empty in production; an empty
	// token disables verification and causes every request to be rejected.
	AuthToken string
	// PublicHost — the host Twilio reaches us on, e.g.
	// "brightertomorrowtherapy.cloud". Used both to build the wss:// stream
	// URL in the TwiML response and to reconstruct the canonical URL used
	// in Twilio's signature calculation when behind TLS-terminating proxies.
	PublicHost string
	// AIServiceURL — the in-cluster URL for bt-ai (http://bt-ai...:8001).
	AIServiceURL string
}

// HandleVoiceWebhook returns the TwiML that hands the call off to a Media Stream.
//
// Method: POST  Content-Type: application/x-www-form-urlencoded
// Response: 200 OK, application/xml
func (h *TwilioHandler) HandleVoiceWebhook(w http.ResponseWriter, r *http.Request) {
	if h.AuthToken == "" {
		slog.Error("twilio: AuthToken not configured — refusing webhook")
		httpx.WriteError(w, http.StatusServiceUnavailable, "twilio not configured")
		return
	}

	// Buffer the body so we can both verify the signature and parse the form.
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64*1024))
	if err != nil {
		slog.Warn("twilio: read body", "err", err)
		httpx.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}
	defer r.Body.Close()

	form, err := url.ParseQuery(string(body))
	if err != nil {
		slog.Warn("twilio: parse form", "err", err)
		httpx.WriteError(w, http.StatusBadRequest, "invalid form")
		return
	}

	canonicalURL := h.canonicalURL(r)
	sig := r.Header.Get("X-Twilio-Signature")
	if !verifySignature(h.AuthToken, sig, canonicalURL, form) {
		slog.Warn("twilio: signature mismatch",
			"url", canonicalURL,
			"request_id", chimw.GetReqID(r.Context()),
		)
		httpx.WriteError(w, http.StatusForbidden, "signature mismatch")
		return
	}

	callSid := form.Get("CallSid")
	from := form.Get("From")
	to := form.Get("To")

	// Mint a chat_sessions row up front so the call appears in the admin
	// /admin/chat dashboard with source='voice-phone'. The row is a non-PHI
	// pointer: the message bodies live in DynamoDB (KMS-encrypted, AWS BAA),
	// keyed by this same UUID.
	//
	// session_id is a fresh UUID (chat_sessions.id is typed UUID; CallSid is
	// not a UUID). external_ref preserves the CallSid so an admin can jump
	// from the dashboard back to Twilio Console for that call.
	sessionID := uuid.New().String()
	if h.Pool != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		// visitor_id stays NULL — there's no browser cookie on a PSTN call.
		// chat_sessions.visitor_id is nullable; queries that JOIN on it use
		// LEFT JOIN already.
		if _, err := h.Pool.Exec(ctx,
			`INSERT INTO bt.chat_sessions (id, visitor_id, source, external_ref)
			 VALUES ($1, NULL, 'voice-phone', $2)
			 ON CONFLICT (id) DO NOTHING`,
			sessionID, callSid,
		); err != nil {
			// Don't fail the webhook — Twilio retrying won't help us recover.
			// The DDB transcript still lands; admin just won't see the row
			// in the chat dashboard. Log loudly so we notice.
			slog.Error("twilio: insert chat_sessions",
				"err", err,
				"session_id", sessionID,
				"call_sid", callSid,
			)
		}
	} else {
		slog.Warn("twilio: Pool nil — skipping chat_sessions insert",
			"call_sid", callSid,
		)
	}

	slog.Info("twilio: voice webhook",
		"call_sid", callSid,
		"session_id", sessionID,
		"from", from,
		"to", to,
	)

	streamURL := fmt.Sprintf("wss://%s/v1/twilio/media", h.PublicHost)
	twiml := `<?xml version="1.0" encoding="UTF-8"?>` +
		`<Response>` +
		`<Connect>` +
		`<Stream url="` + xmlAttr(streamURL) + `">` +
		// session_id ties bt-ai's per-turn DDB persistence to chat_sessions.
		// call_sid is the Twilio identifier for audit.
		// caller_phone lets bt-ai's LangGraph use a stable thread_id keyed
		// on the E.164 number so a caller who hangs up and calls back
		// within the staleness cap resumes mid-flow.
		`<Parameter name="session_id" value="` + xmlAttr(sessionID) + `" />` +
		`<Parameter name="call_sid" value="` + xmlAttr(callSid) + `" />` +
		`<Parameter name="caller_phone" value="` + xmlAttr(from) + `" />` +
		`</Stream>` +
		`</Connect>` +
		`</Response>`
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(twiml))
}

// HandleMediaWS validates the Twilio signature on the WebSocket upgrade,
// upgrades the caller connection, dials bt-ai's /twilio/media WS, and
// proxies messages verbatim in both directions.
//
// Twilio's upgrade carries Sec-WebSocket-Protocol: audio.twilio.com, so we
// echo that subprotocol back when accepting the upgrade.
func (h *TwilioHandler) HandleMediaWS(w http.ResponseWriter, r *http.Request) {
	if h.AuthToken == "" {
		slog.Error("twilio: AuthToken not configured — refusing media stream")
		httpx.WriteError(w, http.StatusServiceUnavailable, "twilio not configured")
		return
	}

	canonicalHTTPS := h.canonicalURL(r)
	// Twilio's docs flip-flop on whether it signs the wss:// or https:// form
	// of the URL on a WebSocket upgrade. Accept either match.
	canonicalWSS := strings.Replace(canonicalHTTPS, "https://", "wss://", 1)
	sig := r.Header.Get("X-Twilio-Signature")
	okHTTPS := verifySignature(h.AuthToken, sig, canonicalHTTPS, url.Values{})
	okWSS := verifySignature(h.AuthToken, sig, canonicalWSS, url.Values{})
	if !okHTTPS && !okWSS {
		slog.Warn("twilio: media ws signature mismatch",
			"https_url", canonicalHTTPS,
			"wss_url", canonicalWSS,
			"request_id", chimw.GetReqID(r.Context()),
		)
		httpx.WriteError(w, http.StatusForbidden, "signature mismatch")
		return
	}

	upgrader := websocket.Upgrader{
		CheckOrigin: func(_ *http.Request) bool { return true },
		Subprotocols: []string{"audio.twilio.com"},
		ReadBufferSize:  8192,
		WriteBufferSize: 8192,
	}
	clientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Warn("twilio: upgrade", "err", err)
		return
	}
	defer clientConn.Close()

	aiURL, err := aiTwilioWSURL(h.AIServiceURL)
	if err != nil {
		slog.Error("twilio: build ai ws url", "err", err)
		_ = clientConn.WriteMessage(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "internal error"),
		)
		return
	}

	// Forward Twilio's chosen subprotocol so bt-ai's accept() matches.
	hdr := http.Header{}
	hdr.Set("Sec-WebSocket-Protocol", "audio.twilio.com")

	aiConn, _, err := websocket.DefaultDialer.DialContext(r.Context(), aiURL, hdr)
	if err != nil {
		slog.Warn("twilio: dial bt-ai", "url", aiURL, "err", err)
		_ = clientConn.WriteMessage(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "ai unavailable"),
		)
		return
	}
	defer aiConn.Close()

	reqID := chimw.GetReqID(r.Context())
	slog.Info("twilio: media bridge open", "request_id", reqID)

	start := time.Now()
	var c2a, a2c proxyStats // twilio→ai (caller audio), ai→twilio (agent audio)
	errCh := make(chan error, 2)
	go func() { errCh <- proxyMessages(clientConn, aiConn, &c2a) }()
	go func() { errCh <- proxyMessages(aiConn, clientConn, &a2c) }()

	proxyErr := <-errCh
	// Always log the bridge close: duration + per-direction frame/byte counts
	// make it obvious whether the caller's audio reached bt-ai (twilio2ai) and
	// whether the agent's reply audio flowed back (ai2twilio) — pinpoints
	// gateway-proxy vs pipeline faults without guessing.
	slog.Info("twilio: media bridge closed",
		"request_id", reqID,
		"duration_s", time.Since(start).Seconds(),
		"twilio2ai_frames", c2a.frames.Load(), "twilio2ai_bytes", c2a.bytes.Load(),
		"ai2twilio_frames", a2c.frames.Load(), "ai2twilio_bytes", a2c.bytes.Load(),
		"err", fmt.Sprintf("%v", proxyErr),
	)
	if proxyErr != nil && !isExpectedCloseError(proxyErr) {
		slog.Warn("twilio: media proxy error", "err", proxyErr)
	}

	_ = clientConn.WriteMessage(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
	)
	_ = aiConn.WriteMessage(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
	)

	// Mark every voice-phone session ended whose stream WS just closed. The
	// session_id arrives on the Twilio start frame, not the upgrade — we
	// don't see it here, so the AI side performs the actual write via the
	// existing /internal/chat/turn path. As a safety net, the 20-minute
	// idle sweeper still catches anything we miss.
}

// canonicalURL reconstructs the absolute URL Twilio used when signing the
// request. We are behind Traefik with TLS termination, so scheme/host come
// from configuration + standard proxy headers, not r.URL.
func (h *TwilioHandler) canonicalURL(r *http.Request) string {
	host := h.PublicHost
	if host == "" {
		host = r.Host
	}
	scheme := "https"
	// Some Twilio integrations sign with the wss URL on the upgrade. Both
	// branches yield the same wire form for an HTTP-style request URI,
	// because Twilio normalizes wss→https for signature purposes.
	path := r.URL.RequestURI()
	return scheme + "://" + host + path
}

// verifySignature performs the Twilio HMAC-SHA1 signature check:
//
//	signature = base64(HMAC_SHA1(authToken, url + concat(sorted(k+v) for k,v in form)))
//
// For GET / WebSocket upgrade requests, form is empty.
func verifySignature(authToken, sigHeader, fullURL string, form url.Values) bool {
	if authToken == "" || sigHeader == "" {
		return false
	}

	// Sort form keys, concatenate "key" + "value" with no separator.
	keys := make([]string, 0, len(form))
	for k := range form {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString(fullURL)
	for _, k := range keys {
		// Twilio's algorithm: append each value individually if a key has
		// multiple values. In practice form values are single-valued.
		for _, v := range form[k] {
			b.WriteString(k)
			b.WriteString(v)
		}
	}

	mac := hmac.New(sha1.New, []byte(authToken))
	mac.Write([]byte(b.String()))
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	// Constant-time comparison.
	return hmac.Equal([]byte(expected), []byte(sigHeader))
}

// aiTwilioWSURL converts the in-cluster bt-ai HTTP URL into a ws:// URL
// pointing at the AI service's Twilio media endpoint.
func aiTwilioWSURL(httpURL string) (string, error) {
	u, err := url.Parse(httpURL)
	if err != nil {
		return "", err
	}
	switch strings.ToLower(u.Scheme) {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	}
	u.Path = "/twilio/media"
	u.RawQuery = ""
	return u.String(), nil
}

// xmlAttr escapes characters that would break a quoted XML attribute value.
// We control the inputs (callSid, our own host) so this is defense-in-depth.
func xmlAttr(s string) string {
	r := strings.NewReplacer(
		`&`, "&amp;",
		`<`, "&lt;",
		`>`, "&gt;",
		`"`, "&quot;",
		`'`, "&apos;",
	)
	return r.Replace(s)
}
