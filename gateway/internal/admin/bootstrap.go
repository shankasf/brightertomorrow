package admin

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Bootstrap creates the initial superadmin if no admin users exist yet.
// Reads email + password from env via the provided arguments (caller reads os.Getenv).
// Idempotent: no-ops if any admin already exists.
func Bootstrap(ctx context.Context, pool *pgxpool.Pool, email, password string) {
	if email == "" || password == "" {
		return
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM bt.admin_users`).Scan(&count); err != nil {
		slog.Warn("admin bootstrap: count query failed", "err", err)
		return
	}
	if count > 0 {
		return
	}
	hash, err := HashPassword(password)
	if err != nil {
		slog.Error("admin bootstrap: bcrypt failed", "err", err)
		return
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO bt.admin_users (email, password_hash, role) VALUES ($1, $2, 'superadmin')`,
		email, hash,
	); err != nil {
		slog.Error("admin bootstrap: insert failed", "err", err)
		return
	}
	slog.Info("admin bootstrap: superadmin created", "email", email)
}
