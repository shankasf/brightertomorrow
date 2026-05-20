// admin_safety.go — POST /internal/admin/safety_queue
//
// Receives urgent safety notifications from 2 LangGraph nodes:
// handoff_mandatory_report (abuse/neglect, Nevada NRS 432B) and
// handoff_crisis (active crisis disclosure).
//
// Writes to bt-safety-queue (separate CMK-encrypted DDB table, PITR, TTL 90d).
// After a successful DDB write, publishes a NON-PHI summary to SNS bt-alerts
// so on-call staff are paged immediately — severity=urgent always.
//
// SNS payload: { "event": "safety_alert", "type": "...", "request_id": "...",
//               "reason": "...", "severity": "urgent" } — zero PHI.
// Returns 201 {"queued_id":"<uuid>"} on success; never 5xx (AI contract).
package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	awssns "github.com/aws/aws-sdk-go-v2/service/sns"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/google/uuid"
)

// snsPublisher is the subset of the SNS client we use; defined by this consumer
// so tests can inject a fake without pulling in the full SDK.
type snsPublisher interface {
	Publish(ctx context.Context, in *awssns.PublishInput, opts ...func(*awssns.Options)) (*awssns.PublishOutput, error)
}

// validSafetyTypes is the closed set for bt-safety-queue items.
var validSafetyTypes = map[string]struct{}{
	"mandatory_report": {},
	"crisis_handoff":   {},
}

// validSafetySignalKinds is the closed set for the safety_signal_kind field.
var validSafetySignalKinds = map[string]struct{}{
	"abuse":  {},
	"crisis": {},
	"other":  {},
}

// AdminSafetyHandler serves POST /internal/admin/safety_queue.
type AdminSafetyHandler struct {
	PHI         *phi.Store
	SafetyQueue *phi.AdminQueueStore
	SNS         snsPublisher
	SNSTopicARN string
}

type adminSafetyRequest struct {
	Type             string         `json:"type"`
	Reason           string         `json:"reason"`
	RequestID        string         `json:"request_id"`
	SessionID        string         `json:"session_id"`
	CallerPhone      string         `json:"caller_phone"`
	CallerEmail      string         `json:"caller_email"`
	Severity         string         `json:"severity"`
	SafetySignalKind string         `json:"safety_signal_kind"`
	NRSReportable    bool           `json:"nrs_reportable"`
	Extra            map[string]any `json:"extra"`
}

func (h *AdminSafetyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body adminSafetyRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		slog.Warn("admin_safety: bad json body", "err", err)
		httpx.WriteJSON(w, http.StatusCreated, map[string]string{"queued_id": uuid.NewString()})
		return
	}

	// Sanitise type and signal kind; fall back to safe defaults.
	safetyType := strings.TrimSpace(body.Type)
	if _, ok := validSafetyTypes[safetyType]; !ok {
		safetyType = "crisis_handoff"
	}
	signalKind := strings.TrimSpace(body.SafetySignalKind)
	if _, ok := validSafetySignalKinds[signalKind]; !ok {
		signalKind = "other"
	}
	requestID := strings.TrimSpace(body.RequestID)
	if requestID == "" {
		requestID = uuid.NewString()
	}

	queuedID := uuid.NewString()
	now := time.Now().UTC()

	extraJSON := ""
	if len(body.Extra) > 0 {
		if b, err := json.Marshal(body.Extra); err == nil {
			extraJSON = string(b)
		}
	}

	rec := phi.AdminQueueRecord{
		QueuedID:         queuedID,
		HandoffType:      safetyType,
		Reason:           body.Reason,
		RequestID:        requestID,
		SessionID:        body.SessionID,
		CallerPhone:      body.CallerPhone,
		CallerEmail:      body.CallerEmail,
		Severity:         "urgent", // safety queue is always urgent
		Status:           "pending",
		ExtraJSON:        extraJSON,
		CreatedAt:        now.Format(time.RFC3339Nano),
		TTL:              phi.TTLFrom(now),
		SafetySignalKind: signalKind,
		NRSReportable:    body.NRSReportable,
	}

	ctx := r.Context()

	if h.SafetyQueue == nil {
		slog.Error("admin_safety: safety queue store not configured")
		httpx.WriteJSON(w, http.StatusCreated, map[string]string{"queued_id": queuedID})
		return
	}

	if err := h.SafetyQueue.Put(ctx, rec); err != nil {
		slog.Error("admin_safety: ddb put failed",
			"err", err, "request_id", requestID, "type", safetyType)
		// Fail open: still respond 201 so the AI doesn't stall.
		httpx.WriteJSON(w, http.StatusCreated, map[string]string{"queued_id": queuedID})
		return
	}

	slog.Info("admin_safety: queued",
		"queued_id", queuedID, "type", safetyType,
		"signal_kind", signalKind, "nrs_reportable", body.NRSReportable,
		"request_id", requestID)

	// Publish non-PHI summary to SNS so on-call staff are paged immediately.
	// This is best-effort; a failed SNS publish does NOT revert the DDB write.
	adminSafetyPublishSNS(ctx, h.SNS, h.SNSTopicARN, safetyType, requestID, body.Reason)

	adminSafetyWriteAudit(ctx, h.PHI, queuedID, safetyType, requestID, signalKind)

	httpx.WriteJSON(w, http.StatusCreated, map[string]string{"queued_id": queuedID})
}

// adminSafetyPublishSNS sends a non-PHI alert to the bt-alerts topic.
// The message body contains only: event type, request_id, truncated reason, severity.
// No caller names, DOB, phone, email, or any other PHI field.
func adminSafetyPublishSNS(ctx context.Context, pub snsPublisher, topicARN, safetyType, requestID, reason string) {
	if pub == nil || topicARN == "" {
		slog.Warn("admin_safety: SNS publisher not configured; alert skipped")
		return
	}

	// Truncate reason to 200 chars — prevents accidentally long strings in the
	// SNS subject and ensures no multi-sentence PHI accidentally slips in.
	if len(reason) > 200 {
		reason = reason[:200]
	}

	payload := map[string]string{
		"event":      "safety_alert",
		"type":       safetyType,
		"request_id": requestID,
		"reason":     reason,
		"severity":   "urgent",
	}
	msgBytes, err := json.Marshal(payload)
	if err != nil {
		slog.Error("admin_safety: marshal sns payload", "err", err)
		return
	}

	subject := fmt.Sprintf("[BT SAFETY] %s — %s", safetyType, requestID)
	in := &awssns.PublishInput{
		TopicArn: &topicARN,
		Message:  aws_string(string(msgBytes)),
		Subject:  aws_string(subject),
	}

	go func() {
		snsCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := pub.Publish(snsCtx, in); err != nil {
			slog.Error("admin_safety: sns publish failed", "err", err, "request_id", requestID)
		}
	}()
}

// adminSafetyWriteAudit records the safety write in the PHI audit log.
// Only non-PHI fields are logged.
func adminSafetyWriteAudit(ctx context.Context, store *phi.Store, queuedID, safetyType, requestID, signalKind string) {
	if store == nil {
		return
	}
	details := map[string]string{
		"queued_id":   queuedID,
		"safety_type": safetyType,
		"signal_kind": signalKind,
	}
	detailsJSON, _ := json.Marshal(details)
	row := phi.AccessAuditRecord{
		AuditID:      uuid.NewString(),
		AdminEmail:   "bt-ai",
		Action:       "safety_alert_queued",
		ResourceType: "safety_queue",
		ResourceID:   requestID,
		Details:      string(detailsJSON),
		CreatedAt:    time.Now().UTC(),
	}
	go func() {
		auditCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := store.PutAccessAudit(auditCtx, row); err != nil {
			slog.Error("admin_safety: audit write failed", "err", err, "request_id", requestID)
		}
	}()
}

// aws_string is a local helper that avoids importing "github.com/aws/aws-sdk-go-v2/aws"
// just for the aws.String pointer helper — the SNS package already uses *string.
func aws_string(s string) *string { return &s }
