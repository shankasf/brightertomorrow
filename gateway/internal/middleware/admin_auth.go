package middleware

import (
	"context"
	"net/http"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5/pgxpool"
)

type adminCtxKey struct{}

// AdminFromContext retrieves the authenticated admin user from request context.
func AdminFromContext(ctx context.Context) (*admin.User, bool) {
	u, ok := ctx.Value(adminCtxKey{}).(*admin.User)
	return u, ok
}

// RequireAdmin validates the Bearer session token and injects the admin into context.
func RequireAdmin(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := admin.ExtractBearerToken(r)
			if token == "" {
				httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			u, err := admin.ValidateToken(r.Context(), pool, token)
			if err != nil {
				httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			ctx := context.WithValue(r.Context(), adminCtxKey{}, u)
			ctx = phi.WithActor(ctx, u.Email)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireSuperadmin extends RequireAdmin — rejects non-superadmin roles with 403.
func RequireSuperadmin(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	base := RequireAdmin(pool)
	return func(next http.Handler) http.Handler {
		return base(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, _ := AdminFromContext(r.Context())
			if u.Role != "superadmin" {
				httpx.WriteError(w, http.StatusForbidden, "forbidden")
				return
			}
			next.ServeHTTP(w, r)
		}))
	}
}
