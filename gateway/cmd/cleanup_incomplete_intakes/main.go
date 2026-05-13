// cleanup_incomplete_intakes scans every appointment booking pointer row
// in bt.intake_pointers, hydrates the matching PHI from DynamoDB, and
// deletes any submission that's missing a real value for ANY of the nine
// required identity fields (first/last name, DOB, phone, email, home
// address, sex, insurance name, insurance member ID).
//
// Why: the chatbot (and earlier callback flow) used to write rows with
// "Not provided" / "1900-01-01" placeholders for fields it didn't yet
// collect. The booking flow now requires all nine, but the historical
// rows pollute the admin view. This is a one-shot cleanup.
//
// Usage:
//
//	DATABASE_URL=postgres://... BT_DDB_TABLE=bt-main \
//	  ./cleanup_incomplete_intakes [-dry-run] [-limit N]
//
// Defaults to dry-run-style logging only when -dry-run is set; otherwise
// it deletes from DynamoDB and marks the Postgres pointer row as purged.
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"os"
	"strings"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Required identity fields. Any empty/placeholder value in any one of
// these makes the row a deletion candidate.
var requiredFields = []string{
	"first_name", "last_name", "date_of_birth", "phone", "email",
	"home_address", "sex", "insurance_name", "insurance_member_id",
}

// Placeholder values the chatbot or staff entered before all fields were
// truly required. Compared lower-cased after trimming.
var placeholders = map[string]struct{}{
	"":                    {},
	"not provided":        {},
	"not provided yet":    {},
	"not yet provided":    {},
	"tbd":                 {},
	"n/a":                 {},
	"na":                  {},
	"unknown":             {},
	"pending":             {},
	"none":                {},
	"none given":          {},
	"null":                {},
	"prefer not to say":   {},
	"decline to answer":   {},
	"rather not say":      {},
	"skip":                {},
	"skipped":             {},
	"no answer":           {},
	"x":                   {},
	"1900-01-01":          {}, // legacy DOB stub
}

func isPlaceholder(v string) bool {
	_, ok := placeholders[strings.ToLower(strings.TrimSpace(v))]
	return ok
}

func missingFields(rec *phi.IntakeRecord) []string {
	if rec == nil {
		return requiredFields
	}
	values := map[string]string{
		"first_name":          rec.FirstName,
		"last_name":           rec.LastName,
		"date_of_birth":       rec.DateOfBirth,
		"phone":               rec.Phone,
		"email":               rec.Email,
		"home_address":        rec.HomeAddress,
		"sex":                 rec.Sex,
		"insurance_name":      rec.InsuranceName,
		"insurance_member_id": rec.InsuranceMemberID,
	}
	var missing []string
	for _, f := range requiredFields {
		if isPlaceholder(values[f]) {
			missing = append(missing, f)
		}
	}
	return missing
}

func main() {
	dryRun := flag.Bool("dry-run", false, "log what would be deleted without touching anything")
	limit := flag.Int("limit", 0, "stop after scanning N rows (0 = unlimited)")
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
		TableName: getEnv("BT_DDB_TABLE", "bt-main"),
		Timeout:   5 * time.Second,
	})
	if err != nil {
		log.Fatalf("phi store: %v", err)
	}

	rows, err := pool.Query(ctx, `
		SELECT id, submission_uuid, email_hash, source, created_at
		  FROM bt.intake_pointers
		 WHERE purged_at IS NULL
		 ORDER BY id ASC
	`)
	if err != nil {
		log.Fatalf("query intake_pointers: %v", err)
	}
	defer rows.Close()

	var (
		scanned     int
		incomplete  int
		ddbMissing  int
		deletedDDB  int
		deletedPG   int
		failed      int
	)

	type ptr struct {
		id             int64
		submissionUUID string
		emailHash      string
		source         string
		createdAt      time.Time
	}
	var ptrs []ptr
	for rows.Next() {
		if *limit > 0 && scanned >= *limit {
			break
		}
		var p ptr
		if err := rows.Scan(&p.id, &p.submissionUUID, &p.emailHash, &p.source, &p.createdAt); err != nil {
			log.Printf("ERROR scan row: %v", err)
			failed++
			continue
		}
		ptrs = append(ptrs, p)
		scanned++
	}
	if err := rows.Err(); err != nil {
		log.Printf("ERROR iterating rows: %v", err)
	}
	rows.Close()

	for _, p := range ptrs {
		rec, err := store.GetIntake(ctx, p.emailHash, p.submissionUUID)
		if err != nil && !errors.Is(err, phi.ErrNotFound) {
			log.Printf("ERROR ddb get id=%d submission_uuid=%s: %v", p.id, p.submissionUUID, err)
			failed++
			continue
		}
		if errors.Is(err, phi.ErrNotFound) || rec == nil {
			// DDB record gone — pointer is orphaned.
			ddbMissing++
			log.Printf("ORPHAN id=%d submission_uuid=%s — pointer has no DDB record; purging pointer",
				p.id, p.submissionUUID)
			if !*dryRun {
				if err := purgePointer(ctx, pool, p.id); err != nil {
					log.Printf("ERROR purge pointer id=%d: %v", p.id, err)
					failed++
					continue
				}
				deletedPG++
			}
			continue
		}

		missing := missingFields(rec)
		if len(missing) == 0 {
			continue
		}
		incomplete++
		log.Printf("INCOMPLETE id=%d submission_uuid=%s source=%s missing=%v",
			p.id, p.submissionUUID, p.source, missing)
		if *dryRun {
			continue
		}

		if err := store.DeleteIntake(ctx, p.emailHash, p.submissionUUID); err != nil {
			log.Printf("ERROR ddb delete id=%d: %v", p.id, err)
			failed++
			continue
		}
		deletedDDB++
		if err := purgePointer(ctx, pool, p.id); err != nil {
			log.Printf("ERROR purge pointer id=%d (DDB deleted, manual reconciliation needed): %v",
				p.id, err)
			failed++
			continue
		}
		deletedPG++
	}

	log.Printf("DONE  scanned=%d incomplete=%d orphaned=%d deleted_ddb=%d purged_pointers=%d failed=%d dry_run=%v",
		scanned, incomplete, ddbMissing, deletedDDB, deletedPG, failed, *dryRun)
}

// purgePointer marks the pointer row purged_at = NOW() so list views skip
// it but the audit trail is preserved.
func purgePointer(ctx context.Context, pool *pgxpool.Pool, id int64) error {
	cmd, err := pool.Exec(ctx, `
		UPDATE bt.intake_pointers
		   SET purged_at = NOW(), status = 'purged_incomplete'
		 WHERE id = $1 AND purged_at IS NULL
	`, id)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func mustEnv(k string) string {
	v := os.Getenv(k)
	if v == "" {
		log.Fatalf("env %s required", k)
	}
	return v
}

func getEnv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
