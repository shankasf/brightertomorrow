package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminAuthHandler handles admin authentication endpoints.
type AdminAuthHandler struct {
	Pool     *pgxpool.Pool
	Cognito  *admin.CognitoVerifier // optional; nil disables /auth/exchange
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
		var lockErr *admin.LockoutError
		switch {
		case errors.As(err, &lockErr):
			// Lockout: include the unlock timestamp + a plain-English reason
			// so the UI can render a countdown and explain what happened.
			retryAfter := int(time.Until(lockErr.Until).Seconds())
			if retryAfter < 0 {
				retryAfter = 0
			}
			w.Header().Set("Retry-After", time.Until(lockErr.Until).Round(time.Second).String())
			httpx.WriteJSON(w, http.StatusTooManyRequests, map[string]any{
				"error":         "account_locked",
				"message":       "Account temporarily locked",
				"reason":        "Too many failed sign-in attempts (5). The account is locked for 30 minutes as a security measure (HIPAA §164.312 brute-force protection).",
				"locked_until":  lockErr.Until.UTC().Format(time.RFC3339),
				"retry_after_s": retryAfter,
			})
		case errors.Is(err, admin.ErrInvalidCredentials):
			httpx.WriteError(w, http.StatusUnauthorized, "invalid credentials")
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

type exchangeRequest struct {
	IDToken string `json:"id_token"`
}

// Exchange handles POST /admin/auth/exchange — accepts a Cognito ID token,
// verifies it against the user pool's JWKS, looks up the admin in Postgres,
// and issues a gateway session token. This is the single sign-in path now;
// password+MFA both happen inside Cognito.
func (h *AdminAuthHandler) Exchange(w http.ResponseWriter, r *http.Request) {
	if h.Cognito == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "cognito not configured")
		return
	}
	var body exchangeRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if body.IDToken == "" {
		httpx.WriteValidationError(w, "id_token required")
		return
	}

	claims, err := h.Cognito.Verify(r.Context(), body.IDToken)
	if err != nil {
		slog.Warn("admin cognito verify failed", "err", err)
		httpx.WriteError(w, http.StatusUnauthorized, "invalid id_token")
		return
	}

	u, err := admin.LookupAdminByEmail(r.Context(), h.Pool, claims.Email)
	if err != nil {
		switch {
		case errors.Is(err, admin.ErrInvalidCredentials):
			// User authenticated to Cognito but isn't provisioned in admin_users.
			// Don't leak that distinction.
			httpx.WriteError(w, http.StatusForbidden, "not authorized")
		case errors.Is(err, admin.ErrInactiveAccount):
			httpx.WriteError(w, http.StatusForbidden, "account inactive")
		default:
			slog.Error("admin lookup", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		}
		return
	}

	token, err := admin.IssueSession(r.Context(), h.Pool, u, r.RemoteAddr, r.UserAgent())
	if err != nil {
		slog.Error("admin issue session", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
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

// Me handles GET /admin/auth/me.
func (h *AdminAuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	u, _ := appmw.AdminFromContext(r.Context())
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"id":    u.ID,
		"email": u.Email,
		"role":  u.Role,
	})
}
