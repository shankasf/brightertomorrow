// migrate_intake_to_ddb is a one-shot operator tool that copies PHI from
// bt.contact_submissions into DynamoDB bt-main, writes a non-PHI pointer row
// into bt.intake_pointers, and redacts the PHI columns from the source row.
//
// Usage:
//
//	DATABASE_URL=postgres://... BT_DDB_TABLE=bt-main \
//	  ./migrate_intake_to_ddb [-dry-run] [-limit N]
//
// The operation is fully idempotent: deterministic UUIDs (SHA-1 namespace) mean
// re-running after a partial failure is safe — already-migrated rows are skipped.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

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
		TableName: getEnv("BT_DDB_TABLE", "bt-main"),
		Timeout:   5 * time.Second,
	})
	if err != nil {
		log.Fatalf("phi store: %v", err)
	}

	rows, err := pool.Query(ctx, `
		SELECT id, full_name, email, phone, subject, message, source, created_at, retain_until
		  FROM bt.contact_submissions
		 WHERE source IN ('website-booking-flow', 'website-coverage-flow', 'chat-agent')
		   AND purged_at IS NULL
		   AND email NOT LIKE 'migrated-%@migrated.invalid'
		 ORDER BY id ASC
	`)
	if err != nil {
		log.Fatalf("query contact_submissions: %v", err)
	}
	defer rows.Close()

	var (
		scanned  int
		migrated int
		skipped  int
		failed   int
	)

	for rows.Next() {
		if *limit > 0 && scanned >= *limit {
			break
		}

		var row sourceRow
		if err := rows.Scan(
			&row.ID, &row.FullName, &row.Email, &row.Phone,
			&row.Subject, &row.Message, &row.Source,
			&row.CreatedAt, &row.RetainUntil,
		); err != nil {
			log.Printf("ERROR scan row: %v", err)
			failed++
			scanned++
			continue
		}
		scanned++

		result, err := migrateOne(ctx, pool, store, row, *dryRun)
		switch {
		case err != nil:
			log.Printf("ERROR row id=%d: %v", row.ID, err)
			failed++
		case result == resultSkipped:
			log.Printf("SKIP  row id=%d (already migrated)", row.ID)
			skipped++
		default:
			if *dryRun {
				log.Printf("DRY   row id=%d would migrate submission_uuid=%s", row.ID, result)
			} else {
				log.Printf("OK    row id=%d submission_uuid=%s", row.ID, result)
			}
			migrated++
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("ERROR iterating rows: %v", err)
	}

	log.Printf("DONE  scanned=%d migrated=%d skipped=%d failed=%d dry_run=%v",
		scanned, migrated, skipped, failed, *dryRun)
}

const resultSkipped = "SKIPPED"

// sourceRow is the raw Postgres record before parsing.
type sourceRow struct {
	ID          int64
	FullName    *string
	Email       *string
	Phone       *string
	Subject     *string
	Message     *string
	Source      string
	CreatedAt   time.Time
	RetainUntil *time.Time
}

// migrateOne performs all work for a single contact_submissions row.
// Returns (submissionUUID, nil) on success, (resultSkipped, nil) if already
// done, or ("", err) on failure.
func migrateOne(
	ctx context.Context,
	pool *pgxpool.Pool,
	store *phi.Store,
	row sourceRow,
	dryRun bool,
) (string, error) {
	// Guard: email column must be present.
	if row.Email == nil || strings.TrimSpace(*row.Email) == "" {
		return "", errors.New("email column is empty — cannot derive key")
	}
	email := strings.TrimSpace(*row.Email)

	// Deterministic UUID: re-running produces the same UUID for the same row.
	submissionUUID := uuid.NewSHA1(
		uuid.NameSpaceURL,
		[]byte(fmt.Sprintf("contact_submissions/%d", row.ID)),
	).String()

	emailHash := phi.HashEmail(email)

	// Parse the message body into fields.
	msg := ""
	if row.Message != nil {
		msg = *row.Message
	}
	subject := ""
	if row.Subject != nil {
		subject = *row.Subject
	}
	fullNameCol := ""
	if row.FullName != nil {
		fullNameCol = strings.TrimSpace(*row.FullName)
	}
	phone := ""
	if row.Phone != nil {
		phone = strings.TrimSpace(*row.Phone)
	}

	rec, err := parseMessage(msg, subject, fullNameCol, email, phone, row.Source, row.CreatedAt)
	if err != nil {
		return "", fmt.Errorf("parse message: %w", err)
	}

	rec.SubmissionUUID = submissionUUID
	rec.EmailHash = emailHash
	rec.Source = row.Source
	rec.CreatedAt = row.CreatedAt

	// RetainUntil: use the column value if set, otherwise 10-year default.
	if row.RetainUntil != nil && !row.RetainUntil.IsZero() {
		rec.RetainUntil = *row.RetainUntil
	} else {
		rec.RetainUntil = row.CreatedAt.Add(10 * 365 * 24 * time.Hour)
	}

	if dryRun {
		log.Printf("DRY   row id=%d uuid=%s flow=%s payment=%s coverage=%s email=%s dob=%s",
			row.ID, submissionUUID, rec.Flow, rec.PaymentMethod, rec.CoverageStatus, email, rec.DateOfBirth)
		return submissionUUID, nil
	}

	// 1. Write to DynamoDB. ErrAlreadyExists means we already ran this row.
	if err := store.PutIntake(ctx, *rec); err != nil {
		if errors.Is(err, phi.ErrAlreadyExists) {
			// Still try to write the pointer and redact in case a previous
			// run wrote DDB but crashed before those steps.
			log.Printf("INFO  row id=%d DDB item already exists, continuing to pointer/redact", row.ID)
		} else {
			return "", fmt.Errorf("PutIntake: %w", err)
		}
	}

	ddbPK := "PATIENT#" + emailHash
	ddbSK := "INTAKE#" + submissionUUID

	// 2. Insert pointer row (idempotent via ON CONFLICT DO NOTHING).
	_, err = pool.Exec(ctx, `
		INSERT INTO bt.intake_pointers
			(submission_uuid, email_hash, flow, payment_method, status, source, ddb_pk, ddb_sk)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (submission_uuid) DO NOTHING
	`, submissionUUID, emailHash, rec.Flow, rec.PaymentMethod, rec.CoverageStatus,
		row.Source, ddbPK, ddbSK)
	if err != nil {
		return "", fmt.Errorf("insert intake_pointers: %w", err)
	}

	// 3. Redact PHI from the source row.
	tag, err := pool.Exec(ctx, `
		UPDATE bt.contact_submissions SET
			full_name = '[MIGRATED-' || id::text || ']',
			email     = 'migrated-' || id::text || '@migrated.invalid',
			phone     = NULL,
			subject   = NULL,
			message   = '[MIGRATED to DynamoDB submission_uuid=' || $1 || ']'
		WHERE id = $2 AND purged_at IS NULL
	`, submissionUUID, row.ID)
	if err != nil {
		return "", fmt.Errorf("redact contact_submissions id=%d: %w", row.ID, err)
	}
	if tag.RowsAffected() == 0 {
		// Row disappeared or was already purged between our SELECT and UPDATE.
		// Not an error — treat as already migrated.
		log.Printf("WARN  row id=%d not updated during redact (purged_at set concurrently?)", row.ID)
		return resultSkipped, nil
	}

	return submissionUUID, nil
}

// -----------------------------------------------------------------------
// Message parsing
// -----------------------------------------------------------------------

// parsedFields is the intermediate representation before we build IntakeRecord.
type parsedFields struct {
	flow                   string
	service                string
	paymentMethod          string
	fullName               string
	dob                    string
	phone                  string
	homeAddress            string
	sex                    string
	insuranceName          string
	insuranceMemberID      string
	subscriberName         string
	subscriberRelationship string
	notes                  string
	coverageStatus         string
	eligible               bool
	plan                   string
}

// parseMessage converts the free-text message + column values into an
// IntakeRecord. Email comes from the column, not the message.
func parseMessage(
	msg, subject, fullNameCol, email, phoneCol, source string,
	_ time.Time,
) (*phi.IntakeRecord, error) {
	var f parsedFields

	// The chat-agent format uses short keys; the website format uses long keys.
	// Try to detect by looking for chat-agent sentinel keys.
	if isChatAgentMessage(msg) {
		parseChatAgent(msg, &f)
	} else {
		parseWebsite(msg, &f)
	}

	// Column values override message-parsed values where available.
	if fullNameCol != "" {
		f.fullName = fullNameCol
	}
	if phoneCol != "" {
		f.phone = phoneCol
	}
	// email is always from the column (guaranteed non-empty by the caller).

	// Derive flow from source if not parsed from message.
	if f.flow == "" {
		switch source {
		case "website-coverage-flow":
			f.flow = "coverage"
		default:
			f.flow = "booking"
		}
	}

	// Derive payment method from subject when not in message.
	if f.paymentMethod == "" {
		f.paymentMethod = paymentFromSubject(subject)
	}

	// Derive coverage status from subject if still blank.
	if f.coverageStatus == "" {
		f.coverageStatus = coverageFromSubject(subject)
	}

	// Validate minimally-required fields.
	if strings.TrimSpace(f.fullName) == "" {
		return nil, errors.New("full_name is empty — skipping")
	}
	if strings.TrimSpace(f.dob) == "" {
		return nil, errors.New("date_of_birth is empty — skipping")
	}

	dob, err := parseDOB(f.dob)
	if err != nil {
		return nil, fmt.Errorf("parse dob %q: %w", f.dob, err)
	}

	firstName, lastName := splitName(f.fullName)

	rec := &phi.IntakeRecord{
		Flow:                   f.flow,
		Service:                f.service,
		PaymentMethod:          f.paymentMethod,
		FirstName:              firstName,
		LastName:               lastName,
		DateOfBirth:            dob,
		Phone:                  f.phone,
		Email:                  email,
		HomeAddress:            f.homeAddress,
		Sex:                    f.sex,
		InsuranceName:          f.insuranceName,
		InsuranceMemberID:      f.insuranceMemberID,
		SubscriberName:         f.subscriberName,
		SubscriberRelationship: f.subscriberRelationship,
		Notes:                  f.notes,
		CoverageStatus:         f.coverageStatus,
		Eligible:               f.eligible,
	}

	if f.plan != "" {
		rec.Coverage = map[string]string{
			"status": f.coverageStatus,
			"plan":   f.plan,
		}
	}

	return rec, nil
}

// isChatAgentMessage returns true when the message was produced by the
// chat-agent's book_with_insurance_intake tool (short-key format).
func isChatAgentMessage(msg string) bool {
	lines := splitLines(msg)
	for _, l := range lines {
		k, _ := splitKV(l)
		switch strings.ToLower(strings.TrimSpace(k)) {
		case "reason", "dob", "insurance", "eligibility":
			return true
		}
	}
	return false
}

// parseChatAgent handles the chat-agent short-key format:
//
//	Reason: <service>
//	DOB: <date>
//	Insurance: <payer name> (member <id>)
//	Eligibility: VERIFIED — eligible
func parseChatAgent(msg string, f *parsedFields) {
	for _, line := range splitLines(msg) {
		k, v := splitKV(line)
		switch strings.ToLower(strings.TrimSpace(k)) {
		case "reason":
			f.service = v
		case "dob":
			f.dob = v
		case "insurance":
			// "BlueCross (member A1234)" or just "Aetna"
			f.insuranceName, f.insuranceMemberID = parseInsuranceLine(v)
		case "eligibility":
			// "VERIFIED — eligible" or "NEEDS_REVIEW — needs_review"
			upper := strings.ToUpper(v)
			if strings.Contains(upper, "VERIFIED") {
				f.coverageStatus = phi.StatusEligible
				f.eligible = true
			} else if strings.Contains(upper, "SELF") {
				f.coverageStatus = phi.StatusSelfPay
			} else {
				f.coverageStatus = phi.StatusNeedsReview
			}
		}
	}
	// Chat-agent rows are always booking flow + insurance payment.
	f.flow = "booking"
	if f.paymentMethod == "" {
		if f.insuranceName != "" {
			f.paymentMethod = "insurance"
		} else {
			f.paymentMethod = "self_pay"
		}
	}
}

// parseWebsite handles the website handler's long-key format produced by
// intakeMessage() in handlers/intake.go.
func parseWebsite(msg string, f *parsedFields) {
	for _, line := range splitLines(msg) {
		k, v := splitKV(line)
		switch strings.ToLower(strings.TrimSpace(k)) {
		case "flow":
			lower := strings.ToLower(v)
			if strings.Contains(lower, "coverage") {
				f.flow = "coverage"
			} else {
				f.flow = "booking"
			}
		case "service":
			f.service = v
		case "payment method":
			lower := strings.ToLower(v)
			if strings.Contains(lower, "self") || strings.Contains(lower, "out-of-network") {
				f.paymentMethod = "self_pay"
			} else {
				f.paymentMethod = "insurance"
			}
		case "full name":
			f.fullName = v
		case "date of birth":
			f.dob = v
		case "phone":
			f.phone = v
		case "home address":
			f.homeAddress = v
		case "sex":
			f.sex = v
		case "insurance name":
			f.insuranceName = v
		case "insurance id number":
			f.insuranceMemberID = v
		case "subscriber name":
			f.subscriberName = v
		case "relationship to subscriber":
			f.subscriberRelationship = v
		case "eligibility status":
			switch strings.ToLower(v) {
			case phi.StatusEligible:
				f.coverageStatus = phi.StatusEligible
				f.eligible = true
			case phi.StatusSelfPay:
				f.coverageStatus = phi.StatusSelfPay
			case phi.StatusVerificationError:
				f.coverageStatus = phi.StatusVerificationError
			default:
				f.coverageStatus = phi.StatusNeedsReview
			}
		case "eligible":
			f.eligible = strings.ToLower(v) == "yes"
		case "plan":
			f.plan = v
		case "notes":
			f.notes = v
		}
	}
}

// -----------------------------------------------------------------------
// DOB parsing
// -----------------------------------------------------------------------

// parseDOB accepts YYYY-MM-DD (new), YYYYMMDD (old chat-agent compact), or
// a handful of human-readable forms. Returns ISO YYYY-MM-DD on success.
func parseDOB(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("empty")
	}

	formats := []string{
		"2006-01-02",           // YYYY-MM-DD — canonical ISO
		"20060102",             // YYYYMMDD — chat-agent compact
		"January 2, 2006",      // human: January 2, 1990
		"Jan 2, 2006",          // human: Jan 2, 1990
		"01/02/2006",           // US slash
		"1/2/2006",             // US slash short
		"02-Jan-2006",          // dd-Mon-YYYY
		"2006/01/02",           // ISO slash
	}

	for _, fmt := range formats {
		t, err := time.Parse(fmt, raw)
		if err == nil {
			return t.Format("2006-01-02"), nil
		}
	}
	return "", errors.New("unrecognised date format")
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

func splitLines(s string) []string {
	return strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
}

// splitKV splits "Key: value" into ("Key", "value"). Returns ("", "") if
// there is no colon.
func splitKV(line string) (string, string) {
	idx := strings.Index(line, ":")
	if idx < 0 {
		return "", ""
	}
	return strings.TrimSpace(line[:idx]), strings.TrimSpace(line[idx+1:])
}

// parseInsuranceLine parses "Aetna (member A1234567)" or just "Aetna".
func parseInsuranceLine(s string) (name, memberID string) {
	s = strings.TrimSpace(s)
	open := strings.Index(s, "(")
	close := strings.LastIndex(s, ")")
	if open >= 0 && close > open {
		name = strings.TrimSpace(s[:open])
		inner := strings.TrimSpace(s[open+1 : close])
		// "member A1234567" or "A1234567"
		inner = strings.TrimPrefix(inner, "member ")
		memberID = strings.TrimSpace(inner)
	} else {
		name = s
	}
	return name, memberID
}

// splitName splits "Jane Doe" into ("Jane", "Doe"). Single-token names
// produce (name, "").
func splitName(full string) (first, last string) {
	parts := strings.Fields(full)
	if len(parts) == 0 {
		return "", ""
	}
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], strings.Join(parts[1:], " ")
}

// paymentFromSubject derives payment_method from the stored subject line.
func paymentFromSubject(subject string) string {
	lower := strings.ToLower(subject)
	switch {
	case strings.Contains(lower, "self-pay") || strings.Contains(lower, "self pay"):
		return "self_pay"
	case strings.Contains(lower, "insurance") || strings.Contains(lower, "coverage") ||
		strings.Contains(lower, "eligible") || strings.Contains(lower, "verification"):
		return "insurance"
	default:
		return "insurance" // safe fallback: intake likely involved insurance
	}
}

// coverageFromSubject maps the subject column to a coverage status constant.
func coverageFromSubject(subject string) string {
	lower := strings.ToLower(subject)
	switch {
	case strings.Contains(lower, "self-pay") || strings.Contains(lower, "self pay"):
		return phi.StatusSelfPay
	case strings.Contains(lower, "eligible") && !strings.Contains(lower, "follow up") &&
		!strings.Contains(lower, "review"):
		return phi.StatusEligible
	case strings.Contains(lower, "verification error") || strings.Contains(lower, "needs review") ||
		strings.Contains(lower, "review needed"):
		return phi.StatusVerificationError
	default:
		return phi.StatusNeedsReview
	}
}

// -----------------------------------------------------------------------
// Env helpers
// -----------------------------------------------------------------------

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required env var %s is not set", key)
	}
	return v
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// pgx nullable scan helpers — pgxpool.Query returns pgx.Rows which maps NULL
// columns to nil for *string and *time.Time via the standard pgx codec. We
// use pgx.RowScanner-compatible fields in sourceRow, but pgx.Rows.Scan
// handles *T → nil for NULL automatically with pgx/v5.
var _ = pgx.ErrNoRows // import used in error sentinel
