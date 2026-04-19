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

	cfg.MaxConns = 10
	cfg.MinConns = 2                          // keep 2 connections warm; avoid cold-start latency
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
