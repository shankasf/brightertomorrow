package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/athena"
	"github.com/aws/aws-sdk-go-v2/service/athena/types"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
)

// Athena workgroup + Glue catalog names — kept in sync with the BtAppLogs
// CDK stack (infra/lib/app-logs-stack.ts).
const (
	athenaWorkgroup = "bt-log-search"
	logDatabase     = "bt_logs"
	logTable        = "app_logs"

	// Hard cap on rows returned to the UI. Athena itself paginates internally,
	// but we don't want the JSON payload to balloon.
	logSearchMaxRows = 500

	// How long we wait for an Athena query before giving up. Most queries
	// against a single partition return in 2-5s.
	logSearchQueryTimeout = 30 * time.Second

	// Athena polling cadence.
	logSearchPollInterval = 350 * time.Millisecond
)

// AthenaClient is the subset of the Athena API the handler uses.
// Keeping it an interface makes the handler trivially testable.
type AthenaClient interface {
	StartQueryExecution(ctx context.Context, in *athena.StartQueryExecutionInput, opts ...func(*athena.Options)) (*athena.StartQueryExecutionOutput, error)
	GetQueryExecution(ctx context.Context, in *athena.GetQueryExecutionInput, opts ...func(*athena.Options)) (*athena.GetQueryExecutionOutput, error)
	GetQueryResults(ctx context.Context, in *athena.GetQueryResultsInput, opts ...func(*athena.Options)) (*athena.GetQueryResultsOutput, error)
	StopQueryExecution(ctx context.Context, in *athena.StopQueryExecutionInput, opts ...func(*athena.Options)) (*athena.StopQueryExecutionOutput, error)
}

// logSearchFilters mirrors the admin UI form. All fields optional except
// fromTs (defaults to "now - 1h" if absent — partition pruning depends on it).
type logSearchFilters struct {
	Services  []string  // []{"gateway","bt-ai","frontend","web"} — empty means all
	Levels    []string  // ["INFO","WARN","ERROR"] — empty means all
	FromTs    time.Time // inclusive
	ToTs      time.Time // exclusive
	SessionID string    // exact match if non-empty
	PatientID string    // exact match if non-empty
	Text      string    // LIKE %text% over message + logger
	Limit     int       // 1..logSearchMaxRows
}

// Search executes an Athena SELECT against the bt_logs.app_logs table and
// returns the matching rows. Mounted at /admin/api/logs/search behind
// RequireSuperadmin. Each invocation writes one admin_access_log row.
func (h *AdminLogsHandler) Search(w http.ResponseWriter, r *http.Request) {
	if h.Athena == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "log search not configured")
		return
	}

	f, err := parseLogSearchFilters(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Audit: one row per query — search criteria captured in the action
	// detail field below so a future audit can show "who searched for what."
	if u, ok := appmw.AdminFromContext(r.Context()); ok {
		// Resource id encodes the query shape (no PHI in the audit field
		// itself — patient_id filter is a hashed id, not raw PHI).
		resourceID := fmt.Sprintf(
			"search:services=%s,levels=%s,from=%s,to=%s,session=%t,patient=%t,text_len=%d",
			strings.Join(f.Services, "|"),
			strings.Join(f.Levels, "|"),
			f.FromTs.UTC().Format(time.RFC3339),
			f.ToTs.UTC().Format(time.RFC3339),
			f.SessionID != "",
			f.PatientID != "",
			len(f.Text),
		)
		admin.LogPHIAccess(r.Context(), h.PHI, r, u,
			"search_logs", "app_logs", resourceID)
	}

	ctx, cancel := context.WithTimeout(r.Context(), logSearchQueryTimeout)
	defer cancel()

	sql, params := buildLogSearchSQL(f)

	startOut, err := h.Athena.StartQueryExecution(ctx, &athena.StartQueryExecutionInput{
		QueryString:         aws.String(sql),
		WorkGroup:           aws.String(athenaWorkgroup),
		ExecutionParameters: params,
		QueryExecutionContext: &types.QueryExecutionContext{
			Database: aws.String(logDatabase),
			Catalog:  aws.String("AwsDataCatalog"),
		},
	})
	if err != nil {
		slog.Error("log search: start query", "err", err)
		httpx.WriteError(w, http.StatusBadGateway, "athena start failed")
		return
	}
	qid := aws.ToString(startOut.QueryExecutionId)

	if err := waitForAthena(ctx, h.Athena, qid); err != nil {
		// Try to stop the query on timeout so we don't accrue scan cost.
		if errors.Is(err, context.DeadlineExceeded) {
			_, _ = h.Athena.StopQueryExecution(ctx, &athena.StopQueryExecutionInput{
				QueryExecutionId: aws.String(qid),
			})
		}
		slog.Warn("log search: wait failed", "qid", qid, "err", err)
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("athena query: %v", err))
		return
	}

	resultsOut, err := h.Athena.GetQueryResults(ctx, &athena.GetQueryResultsInput{
		QueryExecutionId: aws.String(qid),
		MaxResults:       aws.Int32(int32(f.Limit + 1)), // +1 for the header row
	})
	if err != nil {
		slog.Error("log search: get results", "qid", qid, "err", err)
		httpx.WriteError(w, http.StatusBadGateway, "athena results failed")
		return
	}

	rows := convertAthenaRows(resultsOut)
	resp := map[string]any{
		"queryId": qid,
		"count":   len(rows),
		"rows":    rows,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// parseLogSearchFilters extracts and validates query-string filters.
// Unknown params are silently ignored (forward-compatibility).
func parseLogSearchFilters(r *http.Request) (logSearchFilters, error) {
	q := r.URL.Query()

	f := logSearchFilters{
		Limit: 200,
	}

	if s := q.Get("service"); s != "" {
		// Whitelist values to prevent injection via partition column.
		allowed := map[string]bool{"gateway": true, "bt-ai": true, "frontend": true, "web": true}
		for _, v := range strings.Split(s, ",") {
			v = strings.TrimSpace(v)
			if allowed[v] {
				f.Services = append(f.Services, v)
			}
		}
	}

	if s := q.Get("level"); s != "" {
		allowed := map[string]bool{"DEBUG": true, "INFO": true, "WARN": true, "WARNING": true, "ERROR": true, "CRITICAL": true}
		for _, v := range strings.Split(s, ",") {
			v = strings.TrimSpace(strings.ToUpper(v))
			if allowed[v] {
				f.Levels = append(f.Levels, v)
			}
		}
	}

	now := time.Now().UTC()
	if s := q.Get("from"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return f, fmt.Errorf("invalid from: %v", err)
		}
		f.FromTs = t.UTC()
	} else {
		f.FromTs = now.Add(-1 * time.Hour)
	}
	if s := q.Get("to"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return f, fmt.Errorf("invalid to: %v", err)
		}
		f.ToTs = t.UTC()
	} else {
		f.ToTs = now
	}

	// Sanity: from < to and the range is at most 30 days (partition pruning).
	if !f.FromTs.Before(f.ToTs) {
		return f, errors.New("from must be before to")
	}
	if f.ToTs.Sub(f.FromTs) > 30*24*time.Hour {
		return f, errors.New("time range cannot exceed 30 days")
	}

	f.SessionID = strings.TrimSpace(q.Get("session_id"))
	f.PatientID = strings.TrimSpace(q.Get("patient_id"))
	f.Text = strings.TrimSpace(q.Get("text"))

	if s := q.Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 {
			return f, errors.New("invalid limit")
		}
		if n > logSearchMaxRows {
			n = logSearchMaxRows
		}
		f.Limit = n
	}

	return f, nil
}

// buildLogSearchSQL returns a parameterized SELECT and its ExecutionParameters.
// Why parameterized: cleanly side-steps SQL injection for user-controlled
// text fields (session_id, patient_id, search text). Whitelisted enum-like
// filters (service, level) are inlined since their values are validated.
//
// IMPORTANT: WHERE clauses on year/month/day/hour use literal values so the
// Athena/Glue partition pruner can eliminate non-matching partitions before
// scanning. Using parameters there defeats pruning.
func buildLogSearchSQL(f logSearchFilters) (string, []string) {
	var (
		sb     strings.Builder
		params []string
	)

	sb.WriteString(`SELECT log_id, ts, ingestion_ts, level, service, message, logger,
                        session_id, patient_id, trace_id, request_id, pod, container, host
                 FROM ` + logDatabase + `.` + logTable + `
                 WHERE `)
	sb.WriteString(partitionRangeClause(f.FromTs, f.ToTs))

	if len(f.Services) > 0 {
		quoted := make([]string, 0, len(f.Services))
		for _, s := range f.Services {
			quoted = append(quoted, "'"+s+"'")
		}
		sb.WriteString(" AND service IN (" + strings.Join(quoted, ",") + ")")
	}
	if len(f.Levels) > 0 {
		quoted := make([]string, 0, len(f.Levels))
		for _, lv := range f.Levels {
			quoted = append(quoted, "'"+lv+"'")
		}
		sb.WriteString(" AND upper(level) IN (" + strings.Join(quoted, ",") + ")")
	}

	// Bound by event timestamp too (partitions are hour-aligned, this gives
	// minute-level precision inside the matched partitions).
	sb.WriteString(" AND ts >= timestamp ? AND ts < timestamp ?")
	params = append(params,
		f.FromTs.Format("2006-01-02 15:04:05.000"),
		f.ToTs.Format("2006-01-02 15:04:05.000"),
	)

	if f.SessionID != "" {
		sb.WriteString(" AND session_id = ?")
		params = append(params, f.SessionID)
	}
	if f.PatientID != "" {
		sb.WriteString(" AND patient_id = ?")
		params = append(params, f.PatientID)
	}
	if f.Text != "" {
		// LIKE on free text — match in both message and logger. Wildcards
		// added server-side so a user typing "tool_ok" matches "tool_ok=true".
		sb.WriteString(" AND (lower(message) LIKE ? OR lower(coalesce(logger,'')) LIKE ?)")
		// Athena's parameterized LIKE wants the wildcards in the value.
		pattern := "%" + strings.ToLower(f.Text) + "%"
		params = append(params, pattern, pattern)
	}

	// log_id dedup — defense-in-depth in case Vector ever re-reads.
	// Newest first.
	sb.WriteString(`
                 ORDER BY ts DESC
                 LIMIT ` + strconv.Itoa(f.Limit))

	return sb.String(), params
}

// partitionRangeClause emits literal year/month/day/hour predicates for
// partition pruning. Athena WILL NOT prune partitions with parameterized
// predicates, so we inline the integer values (safe: derived from time.Time,
// not user-string).
func partitionRangeClause(from, to time.Time) string {
	// Walk the hour partitions inclusively on both ends. For ranges <= 24h
	// we emit explicit (year,month,day,hour) tuples; for longer ranges we
	// fall back to date-level pruning + ts filter handles the rest.
	durHours := int(to.Sub(from).Hours()) + 1
	if durHours <= 0 {
		durHours = 1
	}

	// For short ranges, hour-level tuple list keeps scan minimal.
	if durHours <= 48 {
		var tuples []string
		cur := from.Truncate(time.Hour)
		end := to
		for !cur.After(end) {
			tuples = append(tuples, fmt.Sprintf("(year=%d AND month=%d AND day=%d AND hour=%d)",
				cur.Year(), int(cur.Month()), cur.Day(), cur.Hour()))
			cur = cur.Add(time.Hour)
		}
		return "(" + strings.Join(tuples, " OR ") + ")"
	}

	// Longer range — prune at day level, let the `ts` predicate handle the rest.
	var tuples []string
	cur := from.Truncate(24 * time.Hour)
	for !cur.After(to) {
		tuples = append(tuples, fmt.Sprintf("(year=%d AND month=%d AND day=%d)",
			cur.Year(), int(cur.Month()), cur.Day()))
		cur = cur.Add(24 * time.Hour)
	}
	return "(" + strings.Join(tuples, " OR ") + ")"
}

func waitForAthena(ctx context.Context, cli AthenaClient, qid string) error {
	ticker := time.NewTicker(logSearchPollInterval)
	defer ticker.Stop()
	for {
		out, err := cli.GetQueryExecution(ctx, &athena.GetQueryExecutionInput{
			QueryExecutionId: aws.String(qid),
		})
		if err != nil {
			return err
		}
		if out.QueryExecution == nil || out.QueryExecution.Status == nil {
			return errors.New("missing query status")
		}
		switch out.QueryExecution.Status.State {
		case types.QueryExecutionStateSucceeded:
			return nil
		case types.QueryExecutionStateFailed, types.QueryExecutionStateCancelled:
			reason := aws.ToString(out.QueryExecution.Status.StateChangeReason)
			if reason == "" {
				reason = string(out.QueryExecution.Status.State)
			}
			return errors.New(reason)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

// convertAthenaRows turns Athena's columnar output into a slice of
// JSON objects keyed by column name.
func convertAthenaRows(out *athena.GetQueryResultsOutput) []map[string]any {
	if out == nil || out.ResultSet == nil || len(out.ResultSet.Rows) == 0 {
		return nil
	}
	// First row is the header.
	header := out.ResultSet.Rows[0]
	cols := make([]string, len(header.Data))
	for i, c := range header.Data {
		cols[i] = aws.ToString(c.VarCharValue)
	}

	rows := make([]map[string]any, 0, len(out.ResultSet.Rows)-1)
	for _, r := range out.ResultSet.Rows[1:] {
		obj := make(map[string]any, len(cols))
		for i, c := range r.Data {
			if i >= len(cols) {
				continue
			}
			if c.VarCharValue == nil {
				obj[cols[i]] = nil
				continue
			}
			obj[cols[i]] = aws.ToString(c.VarCharValue)
		}
		rows = append(rows, obj)
	}
	return rows
}
