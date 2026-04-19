package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"unicode/utf8"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminAuthHandler handles admin authentication endpoints.
type AdminAuthHandler struct {
	Pool *pgxpool.Pool
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (b *loginRequest) validate() error {
	if utf8.RuneCountInString(b.Email) < 1 {
		return errors.New("email required")
	}
	if utf8.RuneCountInString(b.Password) < 1 {
		return errors.New("password required")
	}
	return nil
}

// Login handles POST /admin/auth/login.
func (h *AdminAuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var body loginRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if err := body.validate(); err != nil {
		httpx.WriteValidationError(w, err.Error())
		return
	}

	ipAddr := r.RemoteAddr
	ua := r.UserAgent()
	token, u, err := admin.Login(r.Context(), h.Pool, body.Email, body.Password, ipAddr, ua)
	if err != nil {
		switch {
		case errors.Is(err, admin.ErrInvalidCredentials):
			httpx.WriteError(w, http.StatusUnauthorized, "invalid credentials")
		case errors.Is(err, admin.ErrAccountLocked):
			httpx.WriteError(w, http.StatusTooManyRequests, err.Error())
		case errors.Is(err, admin.ErrInactiveAccount):
			httpx.WriteError(w, http.StatusForbidden, "account inactive")
		default:
			slog.Error("admin login", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		}
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"user": map[string]any{
			"id":    u.ID,
			"email": u.Email,
			"role":  u.Role,
		},
	})
}

// Logout handles POST /admin/auth/logout.
func (h *AdminAuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	token := admin.ExtractBearerToken(r)
	if token != "" {
		_ = admin.RevokeToken(r.Context(), h.Pool, token)
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// Me handles GET /admin/auth/me.
func (h *AdminAuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	u, _ := appmw.AdminFromContext(r.Context())
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id":    u.ID,
		"email": u.Email,
		"role":  u.Role,
	})
}
