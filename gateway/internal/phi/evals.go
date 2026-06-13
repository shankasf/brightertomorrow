// evals.go — DynamoDB persistence for Agent Accuracy eval runs and per-turn
// drill-down records.
//
// Eval data includes production transcripts and LLM judge rationale — both
// qualify as PHI under HIPAA §164.501. All items land in bt-main (CMK at rest,
// BAA-covered). No eval data may be written to Hostinger Postgres.
//
// Key design
// ==========
//
// Run summary (two items per run — one for direct lookup, one for list):
//
//	PK = "EVALRUN#<runId>"      SK = "META"
//	PK = "EVALRUNS"             SK = "RUN#<RFC3339Nano createdAt>#<runId>"
//
// The EVALRUNS partition lets us query newest-first without a GSI by using
// ScanIndexForward=false. The "RUN#<ts>#<id>" SK is lexicographically
// sortable because RFC3339Nano sorts like ISO-8601.
//
// Turn items:
//
//	PK = "EVALRUN#<runId>"      SK = "TURN#<000000 zero-padded seq>"
//
// RetainUntil: eval items use CreatedAt+1y (operational data, shorter than
// the 10-year PHI retention applied to intake/chat records — eval results are
// not clinical records and expire with model versions).
package phi

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// EvalRun is the summary record for one evaluation run.
// Counts, Metrics, and Breakdowns hold the aggregate numbers produced by the
// AI eval harness. Because DynamoDB maps of mixed numeric/object types are
// awkward to marshal/unmarshal reliably, Breakdowns is stored as a JSON
// string attribute and decoded back to any on read.
type EvalRun struct {
	RunID         string             `dynamodbav:"runId"`
	Kind          string             `dynamodbav:"kind"`           // "offline" | "online"
	Channel       string             `dynamodbav:"channel"`        // "chat" | "voice" | "phone"; empty (legacy) means chat
	Model         string             `dynamodbav:"model"`          // model string, e.g. "gpt-5.5-2026-04-23"
	PromptVersion string             `dynamodbav:"promptVersion"`  // e.g. "dev" | "v1.2"
	CreatedAt     time.Time          `dynamodbav:"createdAt"`
	RetainUntil   time.Time          `dynamodbav:"retainUntil"`
	Counts        map[string]int     `dynamodbav:"counts"`
	MetricCounts  map[string]int     `dynamodbav:"metricCounts"`
	Metrics       map[string]float64 `dynamodbav:"metrics"`
	// BreakdownsJSON is stored raw so mixed-type nested maps survive the
	// DynamoDB round-trip without reflection gymnastics. Callers decode via
	// BreakdownsDecoded(). Exported so attributevalue can marshal it.
	BreakdownsJSON string `dynamodbav:"breakdownsJson"`
	// DatasetVersion is a content hash of the golden dataset used for this run,
	// e.g. "ds_a1b2c3d4". Empty string on old rows (backward-compatible).
	DatasetVersion string `dynamodbav:"datasetVersion"`
	// RegressionJSON is a raw JSON string of the regression-vs-baseline verdict
	// (arbitrary nested object). Stored the same way as BreakdownsJSON.
	// Callers decode via RegressionDecoded(). Empty string on old rows.
	RegressionJSON string `dynamodbav:"regressionJson"`
}

// EvalTurn is the per-turn drill-down record for one eval run.
// DeterministicScoresJSON and JudgeJSON are stored as JSON strings for the
// same reason as EvalRun.BreakdownsJSON — they are arbitrary nested objects
// produced by the AI harness.
type EvalTurn struct {
	RunID                   string    `dynamodbav:"runId"`
	Seq                     int       `dynamodbav:"seq"`
	SessionID               string    `dynamodbav:"sessionId"`
	ConvoName               string    `dynamodbav:"convoName"`
	IsProduction            bool      `dynamodbav:"isProduction"`
	UserSays                string    `dynamodbav:"userSays"`
	Reply                   string    `dynamodbav:"reply"`
	Scene                   string    `dynamodbav:"scene"`
	Split                   string    `dynamodbav:"split"`
	Intent                  string    `dynamodbav:"intent"`
	ExpectedIntent          string    `dynamodbav:"expectedIntent"`
	Passed                  bool      `dynamodbav:"passed"`
	DeterministicScoresJSON string    `dynamodbav:"deterministicScoresJson"`
	JudgeJSON               string    `dynamodbav:"judgeJson"`
	LatencyMs               int       `dynamodbav:"latencyMs"`
	CreatedAt               time.Time `dynamodbav:"createdAt"`
	RetainUntil             time.Time `dynamodbav:"retainUntil"`
}

// evalRunPK returns the primary-key prefix for a run's own items.
func evalRunPK(runID string) string { return "EVALRUN#" + runID }

const evalRunsPartitionKey = "EVALRUNS"

// evalRunListSK produces the sortable SK used in the EVALRUNS list partition.
// Format: "RUN#<RFC3339Nano>#<runId>" — RFC3339Nano is lexicographically
// sortable, so ScanIndexForward=false gives newest-first without a GSI.
func evalRunListSK(createdAt time.Time, runID string) string {
	return "RUN#" + createdAt.UTC().Format(time.RFC3339Nano) + "#" + runID
}

// evalTurnSK returns the SK for a turn item using a zero-padded sequence so
// lexicographic order matches numeric order for up to 999999 turns per run.
func evalTurnSK(seq int) string { return fmt.Sprintf("TURN#%06d", seq) }

// evalRetain is 1 year from creation — eval data is operational, not clinical.
func evalRetain(createdAt time.Time) time.Time { return createdAt.AddDate(1, 0, 0) }

// PutEvalRun writes both the META item (direct lookup) and the EVALRUNS
// list-index item (newest-first listing) for one eval run.
func (s *Store) PutEvalRun(ctx context.Context, run EvalRun) error {
	if run.RunID == "" {
		return fmt.Errorf("phi: EvalRun.RunID is required")
	}
	if run.Kind == "" {
		return fmt.Errorf("phi: EvalRun.Kind is required")
	}
	if run.CreatedAt.IsZero() {
		run.CreatedAt = time.Now().UTC()
	}
	if run.RetainUntil.IsZero() {
		run.RetainUntil = evalRetain(run.CreatedAt)
	}

	// Marshal the struct once; reuse the map for both writes.
	base, err := attributevalue.MarshalMap(run)
	if err != nil {
		return fmt.Errorf("phi: marshal eval run: %w", err)
	}

	// --- META item ---
	metaItem := cloneAttrMap(base)
	metaItem["PK"] = &ddbtypes.AttributeValueMemberS{Value: evalRunPK(run.RunID)}
	metaItem["SK"] = &ddbtypes.AttributeValueMemberS{Value: "META"}

	// --- EVALRUNS list item (same attributes, different PK/SK) ---
	listItem := cloneAttrMap(base)
	listItem["PK"] = &ddbtypes.AttributeValueMemberS{Value: evalRunsPartitionKey}
	listItem["SK"] = &ddbtypes.AttributeValueMemberS{Value: evalRunListSK(run.CreatedAt, run.RunID)}

	// Use BatchWriteItem to write both items atomically-ish (best-effort; DDB
	// single-table batches are atomic per item, not transactional across items,
	// which is fine — a partial failure will be surfaced as an error and the
	// caller retries the whole ingest).
	writes := []ddbtypes.WriteRequest{
		{PutRequest: &ddbtypes.PutRequest{Item: metaItem}},
		{PutRequest: &ddbtypes.PutRequest{Item: listItem}},
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	pending := writes
	for retry := 0; retry < 6 && len(pending) > 0; retry++ {
		resp, err := s.ddb.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: map[string][]ddbtypes.WriteRequest{s.tableName: pending},
		})
		if err != nil {
			return fmt.Errorf("phi: put eval run: %w", err)
		}
		pending = nil
		if resp != nil {
			if u, ok := resp.UnprocessedItems[s.tableName]; ok {
				pending = u
			}
		}
		if len(pending) == 0 {
			break
		}
		sleep := time.Duration(50<<retry) * time.Millisecond
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(sleep):
		}
	}
	if len(pending) > 0 {
		return fmt.Errorf("phi: put eval run: unprocessed items after retries")
	}
	s.auditPHI("eval_runs", "INSERT", run.RunID, actorFromContext(ctx), "")
	return nil
}

// PutEvalTurns persists a slice of EvalTurn items using BatchWriteItem in
// chunks of 25 (DDB hard limit per call). Retries UnprocessedItems with
// exponential backoff, mirroring DeleteChatSession.
func (s *Store) PutEvalTurns(ctx context.Context, runID string, turns []EvalTurn) error {
	if runID == "" {
		return fmt.Errorf("phi: runID is required")
	}
	if len(turns) == 0 {
		return nil
	}
	// Capture actor + count before sub-contexts are created.
	actor := actorFromContext(ctx)
	turnCount := len(turns)

	now := time.Now().UTC()

	// Build all WriteRequests first so chunk logic is clean.
	writes := make([]ddbtypes.WriteRequest, 0, len(turns))
	for _, t := range turns {
		t.RunID = runID
		if t.CreatedAt.IsZero() {
			t.CreatedAt = now
		}
		if t.RetainUntil.IsZero() {
			t.RetainUntil = evalRetain(t.CreatedAt)
		}

		item, err := attributevalue.MarshalMap(t)
		if err != nil {
			return fmt.Errorf("phi: marshal eval turn seq=%d: %w", t.Seq, err)
		}
		item["PK"] = &ddbtypes.AttributeValueMemberS{Value: evalRunPK(runID)}
		item["SK"] = &ddbtypes.AttributeValueMemberS{Value: evalTurnSK(t.Seq)}

		writes = append(writes, ddbtypes.WriteRequest{
			PutRequest: &ddbtypes.PutRequest{Item: item},
		})
	}

	// Process in chunks of 25.
	for start := 0; start < len(writes); start += 25 {
		end := start + 25
		if end > len(writes) {
			end = len(writes)
		}
		chunk := writes[start:end]

		pending := chunk
		for retry := 0; retry < 6 && len(pending) > 0; retry++ {
			bctx, bcancel := context.WithTimeout(ctx, s.timeout)
			resp, err := s.ddb.BatchWriteItem(bctx, &dynamodb.BatchWriteItemInput{
				RequestItems: map[string][]ddbtypes.WriteRequest{s.tableName: pending},
			})
			bcancel()
			if err != nil {
				return fmt.Errorf("phi: put eval turns batch: %w", err)
			}
			pending = nil
			if resp != nil {
				if u, ok := resp.UnprocessedItems[s.tableName]; ok {
					pending = u
				}
			}
			if len(pending) == 0 {
				break
			}
			sleep := time.Duration(50<<retry) * time.Millisecond
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(sleep):
			}
		}
		if len(pending) > 0 {
			return fmt.Errorf("phi: put eval turns: %d items unprocessed after retries", len(pending))
		}
	}
	s.auditPHI("eval_turns", "INSERT", runID, actor,
		fmt.Sprintf(`{"count":%d}`, turnCount))
	return nil
}

// GetEvalRun fetches the META summary item for one run. Returns ErrNotFound
// if the run does not exist.
func (s *Store) GetEvalRun(ctx context.Context, runID string) (*EvalRun, error) {
	if runID == "" {
		return nil, fmt.Errorf("phi: runID is required")
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.tableName),
		Key: map[string]ddbtypes.AttributeValue{
			"PK": &ddbtypes.AttributeValueMemberS{Value: evalRunPK(runID)},
			"SK": &ddbtypes.AttributeValueMemberS{Value: "META"},
		},
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("phi: get eval run: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, ErrNotFound
	}

	var run EvalRun
	if err := attributevalue.UnmarshalMap(out.Item, &run); err != nil {
		return nil, fmt.Errorf("phi: unmarshal eval run: %w", err)
	}
	return &run, nil
}

// ListEvalRuns queries the EVALRUNS partition newest-first, returning at most
// limit items (clamped to 1..100).
func (s *Store) ListEvalRuns(ctx context.Context, limit int32) ([]EvalRun, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.tableName),
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :prefix)"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk":     &ddbtypes.AttributeValueMemberS{Value: evalRunsPartitionKey},
			":prefix": &ddbtypes.AttributeValueMemberS{Value: "RUN#"},
		},
		ScanIndexForward: aws.Bool(false), // newest-first
		Limit:            aws.Int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("phi: list eval runs: %w", err)
	}

	runs := make([]EvalRun, 0, len(out.Items))
	for _, it := range out.Items {
		var run EvalRun
		if err := attributevalue.UnmarshalMap(it, &run); err != nil {
			return nil, fmt.Errorf("phi: unmarshal eval run (list): %w", err)
		}
		runs = append(runs, run)
	}
	return runs, nil
}

// ListEvalTurns queries all TURN# items for a run in sequence order.
// limit is clamped to 1..1000.
func (s *Store) ListEvalTurns(ctx context.Context, runID string, limit int32) ([]EvalTurn, error) {
	if runID == "" {
		return nil, fmt.Errorf("phi: runID is required")
	}
	if limit <= 0 || limit > 1000 {
		limit = 500
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.tableName),
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :prefix)"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk":     &ddbtypes.AttributeValueMemberS{Value: evalRunPK(runID)},
			":prefix": &ddbtypes.AttributeValueMemberS{Value: "TURN#"},
		},
		ScanIndexForward: aws.Bool(true), // ascending seq order
		Limit:            aws.Int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("phi: list eval turns: %w", err)
	}

	turns := make([]EvalTurn, 0, len(out.Items))
	for _, it := range out.Items {
		var t EvalTurn
		if err := attributevalue.UnmarshalMap(it, &t); err != nil {
			return nil, fmt.Errorf("phi: unmarshal eval turn: %w", err)
		}
		turns = append(turns, t)
	}
	return turns, nil
}

// BreakdownsDecoded unmarshals BreakdownsJSON into a map[string]any.
// Returns nil (not an error) if the field is empty.
func (r *EvalRun) BreakdownsDecoded() (map[string]any, error) {
	if r.BreakdownsJSON == "" {
		return nil, nil
	}
	var v map[string]any
	if err := json.Unmarshal([]byte(r.BreakdownsJSON), &v); err != nil {
		return nil, fmt.Errorf("phi: decode breakdowns: %w", err)
	}
	return v, nil
}

// RegressionDecoded unmarshals RegressionJSON into map[string]any.
// Returns nil (not an error) if empty.
func (r *EvalRun) RegressionDecoded() (map[string]any, error) {
	if r.RegressionJSON == "" {
		return nil, nil
	}
	var v map[string]any
	if err := json.Unmarshal([]byte(r.RegressionJSON), &v); err != nil {
		return nil, fmt.Errorf("phi: decode regression: %w", err)
	}
	return v, nil
}

// DeterministicScoresDecoded unmarshals DeterministicScoresJSON into []any.
func (t *EvalTurn) DeterministicScoresDecoded() ([]any, error) {
	if t.DeterministicScoresJSON == "" {
		return nil, nil
	}
	var v []any
	if err := json.Unmarshal([]byte(t.DeterministicScoresJSON), &v); err != nil {
		return nil, fmt.Errorf("phi: decode deterministic scores: %w", err)
	}
	return v, nil
}

// JudgeDecoded unmarshals JudgeJSON into map[string]any.
func (t *EvalTurn) JudgeDecoded() (map[string]any, error) {
	if t.JudgeJSON == "" {
		return nil, nil
	}
	var v map[string]any
	if err := json.Unmarshal([]byte(t.JudgeJSON), &v); err != nil {
		return nil, fmt.Errorf("phi: decode judge: %w", err)
	}
	return v, nil
}

// cloneAttrMap performs a shallow copy of a DynamoDB attribute map so the two
// PutEvalRun items don't share the same map reference (PK/SK differ).
func cloneAttrMap(src map[string]ddbtypes.AttributeValue) map[string]ddbtypes.AttributeValue {
	dst := make(map[string]ddbtypes.AttributeValue, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}
