package admin

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LogPHIAccess records an admin PHI-access event.
// HIPAA §164.312(b): every admin read of PHI must be audited in the append-only log.
func LogPHIAccess(ctx context.Context, pool *pgxpool.Pool, r *http.Request, u *User, action, resourceType, resourceID string) {
	ipAddr := r.RemoteAddr
	ua := r.UserAgent()
	_, err := pool.Exec(ctx,
		`INSERT INTO bt.admin_access_log
		   (admin_user_id, admin_email, action, resource_type, resource_id, ip_address, user_agent)
		 VALUES ($1, $2, $3, $4, $5, $6::inet, $7)`,
		u.ID, u.Email, action, resourceType, resourceID, ipAddr, ua,
	)
	if err != nil {
		slog.Error("admin_access_log: insert failed",
			"err", err, "action", action, "resource_type", resourceType)
	}
}
