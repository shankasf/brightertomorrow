package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// New creates a pgxpool.Pool connected to dsn with sensible defaults.
// It sets the search_path to bt,public on every new connection and
// verifies reachability via Ping before returning.
func New(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("db: parse dsn: %w", err)
	}

	// MaxConns raised from 10 → 25 to absorb concurrent admin fan-out
	// (the stats handler alone fires 17 parallel count queries, plus
	// detached audit-log inserts compete for the same pool). MinConns
	// raised so a burst doesn't pay cold-connect latency.
	cfg.MaxConns = 25
	cfg.MinConns = 5
	cfg.MaxConnIdleTime = 5 * time.Minute     // hold idle conns longer; 30s was too aggressive
	cfg.MaxConnLifetime = 30 * time.Minute    // recycle to prevent server-side staleness
	cfg.HealthCheckPeriod = 30 * time.Second  // detect dead connections before a request hits them

	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, "SET search_path TO bt, public; SET statement_timeout = '5s'")
		if err != nil {
			return fmt.Errorf("db: set session config: %w", err)
		}
		return nil
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("db: create pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping: %w", err)
	}

	return pool, nil
}
