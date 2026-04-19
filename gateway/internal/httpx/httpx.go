package httpx

import (
	"encoding/json"
	"fmt"
	"net/http"
)

const maxBodyBytes = 64 * 1024 // 64 KiB

// WriteJSON marshals v as JSON and writes it to w with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(data)
}

// WriteError writes a JSON error body {"error": msg} with the given status.
func WriteError(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]string{"error": msg})
}

// WriteValidationError writes a JSON error body {"error":"validation","detail":detail} with status 400.
func WriteValidationError(w http.ResponseWriter, detail string) {
	WriteJSON(w, http.StatusBadRequest, map[string]string{
		"error":  "validation",
		"detail": detail,
	})
}

// ReadJSON decodes the request body into v.
// It rejects unknown fields and limits the body to 64 KiB.
// w is passed to MaxBytesReader so Go can close the connection early on oversized bodies.
func ReadJSON(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("httpx: decode json: %w", err)
	}
	return nil
}
