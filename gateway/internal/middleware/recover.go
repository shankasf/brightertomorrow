package middleware

import (
	"log/slog"
	"net/http"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
)

// Recoverer catches panics, logs them, and returns a 500 JSON response.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic recovered", "panic", rec, "path", r.URL.Path)
				httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
