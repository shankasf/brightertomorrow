// migrate_callbacks_to_ddb is a one-shot operator tool that copies every
// row from bt.callback_requests on Postgres into DynamoDB bt-main as
// phi.CallbackRecord items, then (optionally) drops the Postgres table.
//
// Why
// ===
// The Hostinger VPS that hosts the local Postgres is NOT BAA-covered;
// callback rows hold raw first_name + last_name + phone, which are HIPAA
// Safe Harbor identifiers. The new persistence path writes directly to
// DDB; this tool catches up the existing 27ish rows.
//
// Idempotent: re-running after a partial failure is safe — we derive a
// deterministic UUIDv5 from the Postgres `id` so the same row maps to the
// same DDB key on every run and PutCallback's ConditionExpression turns
// duplicate writes into a no-op.
//
// Usage:
//
//	DATABASE_URL=postgres://... BT_DDB_TABLE=bt-main BT_DDB_REGION=us-east-1 \
//	  ./migrate_callbacks_to_ddb [-dry-run] [-limit N]
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// callbackNS is the UUIDv5 namespace for deterministic IDs derived from
// the Postgres serial `id`. Stable across re-runs, opaque to outsiders.
var callbackNS = uuid.MustParse("d65b3a39-3a32-4f6d-9c1b-71d3a86e8d4f")

func main() {
	dryRun := flag.Bool("dry-run", false, "parse and log without writing anything")
	limit := flag.Int("limit", 0, "stop after N rows (0 = unlimited)")
	flag.Parse()

	ctx := context.Background()

	pool, err := pgxpool.New(ctx, mustEnv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(getEnv("BT_DDB_REGION", "us-east-1")),
	)
	if err != nil {
		log.Fatalf("aws config: %v", err)
	}
	ddb := dynamodb.NewFromConfig(awsCfg)
	store, err := phi.New(phi.Config{
		DDB:       ddb,
		TableName: mustEnv("BT_DDB_TABLE"),
		Timeout:   10 * time.Second,
	})
	if err != nil {
		log.Fatalf("phi store: %v", err)
	}

	sql := `SELECT id, first_name, last_name, phone, reason, source,
	               created_at, retain_until, purged_at
	          FROM bt.callback_requests
	         ORDER BY id`
	if *limit > 0 {
		sql += fmt.Sprintf(" LIMIT %d", *limit)
	}

	rows, err := pool.Query(ctx, sql)
	if err != nil {
		log.Fatalf("query callbacks: %v", err)
	}
	defer rows.Close()

	var migrated, skipped, failed int
	for rows.Next() {
		var (
			id          int64
			first, last string
			phone       string
			reason      string
			source      string
			createdAt   time.Time
			retainUntil *time.Time
			purgedAt    *time.Time
		)
		if err := rows.Scan(&id, &first, &last, &phone, &reason, &source,
			&createdAt, &retainUntil, &purgedAt); err != nil {
			log.Fatalf("scan: %v", err)
		}

		cbID := uuid.NewSHA1(callbackNS, []byte(fmt.Sprintf("%d", id))).String()

		retain := createdAt.AddDate(10, 0, 0)
		if retainUntil != nil {
			retain = *retainUntil
		}

		rec := phi.CallbackRecord{
			CallbackID:  cbID,
			FirstName:   first,
			LastName:    last,
			Phone:       phone,
			Reason:      reason,
			Source:      source,
			CreatedAt:   createdAt.UTC(),
			RetainUntil: retain.UTC(),
			PurgedAt:    purgedAt,
		}

		if *dryRun {
			log.Printf("dry-run: would write callback id=%d → %s (source=%s, created=%s)",
				id, cbID, source, createdAt.Format(time.RFC3339))
			migrated++
			continue
		}

		if err := store.PutCallback(ctx, rec); err != nil {
			if errors.Is(err, phi.ErrAlreadyExists) {
				skipped++
				continue
			}
			log.Printf("put callback id=%d failed: %v", id, err)
			failed++
			continue
		}
		migrated++
	}
	if err := rows.Err(); err != nil {
		log.Fatalf("iteration: %v", err)
	}

	log.Printf("done: migrated=%d skipped=%d failed=%d", migrated, skipped, failed)
	if failed > 0 {
		os.Exit(1)
	}
}

func mustEnv(k string) string {
	v := os.Getenv(k)
	if v == "" {
		log.Fatalf("%s required", k)
	}
	return v
}

func getEnv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// silence unused import if pgx ever stops being needed in scanning.
var _ = pgx.ErrNoRows
