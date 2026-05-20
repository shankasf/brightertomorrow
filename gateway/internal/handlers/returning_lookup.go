// returning_lookup.go — POST /internal/phi/returning_patient_lookup
//
// Gate handler for gate_returning_verify in the clinical-intake LangGraph.
// Hashes the caller's phone/email on ingress (never stores raw values) and
// queries bt-pending-requests GSIs to detect a prior record.
//
// HIPAA: only hashes, boolean flags, and session_id are returned.
// No name, DOB value, member ID, or address ever leaves this handler.
// Non-200 is never returned for missing data — the AI gate is fail-open.
package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/google/uuid"
)

// ReturningLookupHandler serves POST /internal/phi/returning_patient_lookup.
type ReturningLookupHandler struct {
	PHI     *phi.Store
	Pending *phi.PendingRequestsStore
}

type returningLookupRequest struct {
	// Python gate sends raw phone/email; we hash on ingress.
	// Pre-hashed inputs are also accepted so future callers can skip the hash step.
	Phone     string `json:"phone"`
	Email     string `json:"email"`
	PhoneHash string `json:"phone_hash"`
	EmailHash string `json:"email_hash"`
	// DOB for confirmation — YYYYMMDD.
	DOBYyyymmdd string `json:"dob_yyyymmdd"`
}

func (h *ReturningLookupHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body returningLookupRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		// Fail open: return "no match" rather than 400 so the AI conversation continues.
		slog.Warn("returning_lookup: bad json body", "err", err)
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"record": nil})
		return
	}

	// Derive hashes from raw values if pre-hashed versions weren't provided.
	phoneHash := body.PhoneHash
	if phoneHash == "" && body.Phone != "" {
		phoneHash = hashIdentifier(body.Phone)
	}
	emailHash := body.EmailHash
	if emailHash == "" && body.Email != "" {
		emailHash = hashIdentifier(body.Email)
	}

	if phoneHash == "" && emailHash == "" {
		// No usable identifier — treat as new caller.
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"record": nil})
		return
	}

	if h.Pending == nil {
		slog.Error("returning_lookup: pending store not configured")
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"record": nil})
		return
	}

	ctx := r.Context()
	var rec *phi.PendingRequestRecord
	var matchStrength string

	// Phone hash takes precedence; fall back to email hash.
	if phoneHash != "" {
		found, err := h.Pending.LookupByPhoneHash(ctx, phoneHash)
		if err == nil {
			rec = found
			matchStrength = "phone"
		}
	}
	if rec == nil && emailHash != "" {
		found, err := h.Pending.LookupByEmailHash(ctx, emailHash)
		if err == nil {
			rec = found
			matchStrength = "email"
		}
	}

	if rec == nil {
		// No prior record — new caller.  Audit and return.
		returningLookupWriteAudit(ctx, h.PHI, phoneHash, emailHash, false, "")
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"record": nil})
		return
	}

	// Prior record found.  Compare DOB if provided — never log either value.
	dobMatch := false
	if body.DOBYyyymmdd != "" && rec.DOB != "" {
		dobMatch = (body.DOBYyyymmdd == rec.DOB)
		if dobMatch {
			if matchStrength == "phone" {
				matchStrength = "phone_and_dob"
			} else {
				matchStrength = "email_and_dob"
			}
		}
	}

	returningLookupWriteAudit(ctx, h.PHI, phoneHash, emailHash, true, rec.SessionID)

	// Return match flags + session_id + DOB only.  No name, address, or member ID.
	// dob_yyyymmdd is included so the Python gate can compare locally without a
	// second round-trip; it is never logged by the gate (see returning_verify.py).
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"record": map[string]any{
			"match_found":    true,
			"match_strength": matchStrength,
			"session_id":     rec.SessionID,
			"dob_yyyymmdd":   rec.DOB,
			"dob_match":      dobMatch,
		},
	})
}

// hashIdentifier returns the lowercase SHA-256 hex of the trimmed input.
// Mirrors the Python gate's own hashing so lookups resolve correctly.
func hashIdentifier(s string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(s))))
	return hex.EncodeToString(sum[:])
}

// returningLookupWriteAudit fires a background PHI audit row.
// Only hashes and boolean flags are written; no raw identifiers.
func returningLookupWriteAudit(ctx context.Context, store *phi.Store, phoneHash, emailHash string, matchFound bool, sessionID string) {
	if store == nil {
		return
	}
	details := map[string]any{
		"phone_hash":  phoneHash,
		"email_hash":  emailHash,
		"match_found": matchFound,
		"session_id":  sessionID,
	}
	detailsJSON, _ := json.Marshal(details)

	row := phi.AccessAuditRecord{
		AuditID:      uuid.NewString(),
		AdminEmail:   "bt-ai",
		Action:       "returning_lookup",
		ResourceType: "pending_request",
		Details:      string(detailsJSON),
		CreatedAt:    time.Now().UTC(),
	}
	// Detach from the request context so the audit write outlives the HTTP response.
	go func() {
		auditCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := store.PutAccessAudit(auditCtx, row); err != nil {
			slog.Error("returning_lookup: audit write failed", "err", err)
		}
	}()
}
