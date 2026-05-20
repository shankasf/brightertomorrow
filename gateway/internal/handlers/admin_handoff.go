// admin_handoff.go — POST /internal/admin/handoff_queue
//
// Receives terminal handoff notifications from 5 LangGraph nodes:
// out_of_state, roi_required, admin_with_note, admin_verification, admin_callback.
//
// Writes to bt-admin-queue (KMS-encrypted DynamoDB, PITR, TTL 90 days).
// PHI fields (caller_phone, caller_email) are forwarded from the AI state but
// never logged — the DDB table is the only authorised PHI store for these rows.
// Returns 201 {"queued_id":"<uuid>"} on success; never 5xx (AI contract).
package handlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/google/uuid"
)

// validHandoffTypes is the closed set accepted for bt-admin-queue.
var validHandoffTypes = map[string]struct{}{
	"out_of_state":        {},
	"roi_required":        {},
	"admin_with_note":     {},
	"admin_verification":  {},
	"admin_callback":      {},
	// Catch-all for any new handoff the Python side adds before a gateway update.
	"handoff":             {},
}

// validHandoffSeverities is the closed set for admin-queue items.
var validHandoffSeverities = map[string]struct{}{
	"info":   {},
	"normal": {},
}

// AdminHandoffHandler serves POST /internal/admin/handoff_queue.
type AdminHandoffHandler struct {
	PHI        *phi.Store
	AdminQueue *phi.AdminQueueStore
}

type adminHandoffRequest struct {
	Type        string         `json:"type"`
	Reason      string         `json:"reason"`
	RequestID   string         `json:"request_id"`
	SessionID   string         `json:"session_id"`
	CallerPhone string         `json:"caller_phone"`
	CallerEmail string         `json:"caller_email"`
	Severity    string         `json:"severity"`
	Extra       map[string]any `json:"extra"`
}

func (h *AdminHandoffHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body adminHandoffRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		slog.Warn("admin_handoff: bad json body", "err", err)
		// Fail gracefully: still issue a queued_id so the AI doesn't retry.
		httpx.WriteJSON(w, http.StatusCreated, map[string]string{"queued_id": uuid.NewString()})
		return
	}

	// Normalise and sanitise — never trust free-form strings from the AI pod
	// for the type field; coerce to a known value or "handoff".
	handoffType := strings.TrimSpace(body.Type)
	if _, ok := validHandoffTypes[handoffType]; !ok {
		handoffType = "handoff"
	}
	severity := strings.TrimSpace(body.Severity)
	if _, ok := validHandoffSeverities[severity]; !ok {
		severity = "normal"
	}
	requestID := strings.TrimSpace(body.RequestID)
	if requestID == "" {
		requestID = uuid.NewString()
	}

	queuedID := uuid.NewString()
	now := time.Now().UTC()

	// Serialise free-form extra as JSON; skip if marshal fails.
	extraJSON := ""
	if len(body.Extra) > 0 {
		if b, err := json.Marshal(body.Extra); err == nil {
			extraJSON = string(b)
		}
	}

	rec := phi.AdminQueueRecord{
		QueuedID:    queuedID,
		HandoffType: handoffType,
		Reason:      body.Reason,
		RequestID:   requestID,
		SessionID:   body.SessionID,
		CallerPhone: body.CallerPhone,
		CallerEmail: body.CallerEmail,
		Severity:    severity,
		Status:      "pending",
		ExtraJSON:   extraJSON,
		CreatedAt:   now.Format(time.RFC3339Nano),
		TTL:         phi.TTLFrom(now),
	}

	ctx := r.Context()

	if h.AdminQueue == nil {
		slog.Error("admin_handoff: queue store not configured")
		httpx.WriteJSON(w, http.StatusCreated, map[string]string{"queued_id": queuedID})
		return
	}

	if err := h.AdminQueue.Put(ctx, rec); err != nil {
		slog.Error("admin_handoff: ddb put failed",
			"err", err, "request_id", requestID, "type", handoffType)
		// Fail open: still return 201 so the AI conversation doesn't stall.
		httpx.WriteJSON(w, http.StatusCreated, map[string]string{"queued_id": queuedID})
		return
	}

	slog.Info("admin_handoff: queued",
		"queued_id", queuedID, "type", handoffType,
		"severity", severity, "request_id", requestID)

	adminHandoffWriteAudit(ctx, h.PHI, queuedID, handoffType, requestID, severity)

	httpx.WriteJSON(w, http.StatusCreated, map[string]string{"queued_id": queuedID})
}

// adminHandoffWriteAudit records the handoff write in the PHI audit log.
// Only non-PHI fields (queued_id, type, request_id, severity) are logged.
func adminHandoffWriteAudit(ctx context.Context, store *phi.Store, queuedID, handoffType, requestID, severity string) {
	if store == nil {
		return
	}
	details := map[string]string{
		"queued_id":    queuedID,
		"handoff_type": handoffType,
		"severity":     severity,
	}
	detailsJSON, _ := json.Marshal(details)
	row := phi.AccessAuditRecord{
		AuditID:      uuid.NewString(),
		AdminEmail:   "bt-ai",
		Action:       "admin_handoff_queued",
		ResourceType: "admin_queue",
		ResourceID:   requestID,
		Details:      string(detailsJSON),
		CreatedAt:    time.Now().UTC(),
	}
	go func() {
		auditCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := store.PutAccessAudit(auditCtx, row); err != nil {
			slog.Error("admin_handoff: audit write failed", "err", err, "request_id", requestID)
		}
	}()
}
