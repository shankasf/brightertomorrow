// migrate_chat_messages_to_ddb walks bt.chat_messages and writes every row
// to DynamoDB under PK=CHAT#<session>, SK=TURN#<rfc3339nano>#<role-short>.
//
// Idempotent: PutItem without a condition expression simply overwrites if
// the same SK is computed twice for the same row, which is fine because the
// timestamp + role uniquely identify a turn.
//
// After this completes successfully, run:
//   psql "$DATABASE_URL" -c 'DROP TABLE bt.chat_messages CASCADE;'
//
// Safe to run while the gateway is serving traffic — new turns already go
// straight to DDB; this only backfills the historical Postgres rows.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"time"

	awsv2 "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "count rows without writing")
	flag.Parse()

	ctx := context.Background()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		slog.Error("DATABASE_URL not set")
		os.Exit(1)
	}
	tableName := os.Getenv("BT_DDB_TABLE")
	if tableName == "" {
		tableName = "bt-main"
	}

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		slog.Error("pool", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	awsCfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		slog.Error("aws config", "err", err)
		os.Exit(1)
	}
	ddb := dynamodb.NewFromConfig(awsCfg)

	store, err := phi.New(phi.Config{
		DDB:       ddb,
		TableName: tableName,
		Timeout:   10 * time.Second,
	})
	if err != nil {
		slog.Error("phi store", "err", err)
		os.Exit(1)
	}

	rows, err := pool.Query(ctx,
		`SELECT session_id::text, role, content, created_at
		 FROM bt.chat_messages
		 ORDER BY created_at`)
	if err != nil {
		slog.Error("query messages", "err", err)
		os.Exit(1)
	}
	defer rows.Close()

	migrated, skipped, errs := 0, 0, 0
	for rows.Next() {
		var sessionID, role, content string
		var createdAt time.Time
		if err := rows.Scan(&sessionID, &role, &content, &createdAt); err != nil {
			slog.Error("scan", "err", err)
			errs++
			continue
		}
		if *dryRun {
			migrated++
			continue
		}
		if err := store.PutChatTurn(ctx, phi.ChatTurn{
			SessionID:   sessionID,
			Role:        role,
			Content:     content,
			CreatedAt:   createdAt.UTC(),
			RetainUntil: createdAt.UTC().AddDate(10, 0, 0),
		}); err != nil {
			slog.Warn("put chat turn", "err", err, "session_id", sessionID)
			errs++
			continue
		}
		migrated++
		if migrated%500 == 0 {
			slog.Info("progress", "migrated", migrated, "errs", errs)
		}
	}
	if err := rows.Err(); err != nil {
		slog.Error("rows iter", "err", err)
		os.Exit(1)
	}

	fmt.Printf("done: migrated=%d skipped=%d errs=%d\n", migrated, skipped, errs)
	_ = awsv2.String // keep import live across SDK versions
}
