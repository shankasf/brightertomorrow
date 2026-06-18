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
	Kind          string             `dynamodbav:"kind"`          // "offline" | "online"
	Channel       string             `dynamodbav:"channel"`       // "chat" | "voice" | "phone"; empty (legacy) means chat
	Model         string             `dynamodbav:"model"`         // model string, e.g. "gpt-5.5-2026-04-23"
	PromptVersion string             `dynamodbav:"promptVersion"` // e.g. "dev" | "v1.2"
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

// ---------------------------------------------------------------------------
// Human eval labels
// ---------------------------------------------------------------------------

// EvalHumanLabel is a human reviewer's assessment of one eval turn.
// Stored under PK = "EVALRUN#<runId>", SK = "TURN#<000000 seq>#HUMANLABEL"
// so it lives in the same partition as the turn it annotates and is returned
// by the same Query that fetches turns (SK prefix "TURN#").
//
// Note: the SK deliberately sorts AFTER the bare turn SK ("TURN#000001" <
// "TURN#000001#HUMANLABEL" lexicographically) so the label never collides
// with the turn item itself.
type EvalHumanLabel struct {
	RunID                   string    `dynamodbav:"runId"`
	Seq                     int       `dynamodbav:"seq"`
	Verdict                 string    `dynamodbav:"verdict"`                           // "agree" | "disagree"
	CorrectedIntent         string    `dynamodbav:"correctedIntent,omitempty"`         // only meaningful on disagree
	CorrectedTaskCompletion *bool     `dynamodbav:"correctedTaskCompletion,omitempty"` // only meaningful on disagree
	CorrectedTopicAdherence *bool     `dynamodbav:"correctedTopicAdherence,omitempty"` // only meaningful on disagree
	Note                    string    `dynamodbav:"note,omitempty"`                    // max 500 chars; no PHI
	LabeledBy               string    `dynamodbav:"labeledBy"`
	LabeledAt               time.Time `dynamodbav:"labeledAt"`
	RetainUntil             time.Time `dynamodbav:"retainUntil"`
}

// evalHumanLabelSK is the SK for a human label, placed after the turn SK.
func evalHumanLabelSK(seq int) string { return fmt.Sprintf("TURN#%06d#HUMANLABEL", seq) }

// PutEvalHumanLabel upserts a human label for one eval turn. An existing label
// is overwritten (last-write-wins) — callers may revise their verdict.
func (s *Store) PutEvalHumanLabel(ctx context.Context, label EvalHumanLabel) error {
	if label.RunID == "" {
		return fmt.Errorf("phi: EvalHumanLabel.RunID is required")
	}
	if label.Verdict != "agree" && label.Verdict != "disagree" {
		return fmt.Errorf("phi: EvalHumanLabel.Verdict must be 'agree' or 'disagree'")
	}
	if label.LabeledBy == "" {
		return fmt.Errorf("phi: EvalHumanLabel.LabeledBy is required")
	}
	if len(label.Note) > 500 {
		return fmt.Errorf("phi: EvalHumanLabel.Note exceeds 500 chars")
	}
	if label.LabeledAt.IsZero() {
		label.LabeledAt = time.Now().UTC()
	}
	if label.RetainUntil.IsZero() {
		label.RetainUntil = evalRetain(label.LabeledAt)
	}

	item, err := attributevalue.MarshalMap(label)
	if err != nil {
		return fmt.Errorf("phi: marshal eval human label: %w", err)
	}
	item["PK"] = &ddbtypes.AttributeValueMemberS{Value: evalRunPK(label.RunID)}
	item["SK"] = &ddbtypes.AttributeValueMemberS{Value: evalHumanLabelSK(label.Seq)}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	_, err = s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("phi: put eval human label: %w", err)
	}
	s.auditPHI("eval_human_labels", "INSERT", fmt.Sprintf("%s#%06d", label.RunID, label.Seq),
		actorFromContext(ctx), "")
	return nil
}

// GetEvalHumanLabel fetches one human label by runID + seq. Returns ErrNotFound
// when the turn has not yet been labeled.
func (s *Store) GetEvalHumanLabel(ctx context.Context, runID string, seq int) (*EvalHumanLabel, error) {
	if runID == "" {
		return nil, fmt.Errorf("phi: runID is required")
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.tableName),
		Key: map[string]ddbtypes.AttributeValue{
			"PK": &ddbtypes.AttributeValueMemberS{Value: evalRunPK(runID)},
			"SK": &ddbtypes.AttributeValueMemberS{Value: evalHumanLabelSK(seq)},
		},
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("phi: get eval human label: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, ErrNotFound
	}
	var label EvalHumanLabel
	if err := attributevalue.UnmarshalMap(out.Item, &label); err != nil {
		return nil, fmt.Errorf("phi: unmarshal eval human label: %w", err)
	}
	return &label, nil
}

// ListEvalHumanLabels fetches all human labels for a run in one Query of the
// run's partition. It filters items whose SK ends with "#HUMANLABEL".
// Returns a map keyed by seq for O(1) join with the turn list.
func (s *Store) ListEvalHumanLabels(ctx context.Context, runID string) (map[int]*EvalHumanLabel, error) {
	if runID == "" {
		return nil, fmt.Errorf("phi: runID is required")
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
		ScanIndexForward: aws.Bool(true),
		// Fetch up to 2000 items — each turn *may* produce a bare TURN# item and
		// a TURN#...#HUMANLABEL item, so we over-fetch by 2x vs turn cap.
		Limit: aws.Int32(2000),
	})
	if err != nil {
		return nil, fmt.Errorf("phi: list eval human labels: %w", err)
	}

	const suffix = "#HUMANLABEL"
	result := make(map[int]*EvalHumanLabel, len(out.Items)/2)
	for _, it := range out.Items {
		skAttr, ok := it["SK"]
		if !ok {
			continue
		}
		sv, ok := skAttr.(*ddbtypes.AttributeValueMemberS)
		if !ok || len(sv.Value) < len(suffix) || sv.Value[len(sv.Value)-len(suffix):] != suffix {
			continue
		}
		var label EvalHumanLabel
		if err := attributevalue.UnmarshalMap(it, &label); err != nil {
			return nil, fmt.Errorf("phi: unmarshal eval human label (list): %w", err)
		}
		result[label.Seq] = &label
	}
	return result, nil
}

// ---------------------------------------------------------------------------
// Callback escalation verdict
// ---------------------------------------------------------------------------

// CallbackEscalationVerdict is a sibling item on the callback's own PK,
// stored with SK = "CALLBACK#escalation_verdict". It records whether an
// escalation (handoff to human) was appropriate or a false positive.
//
// Key design — sibling item (same PK as the callback meta row):
//
//	PK = "PATIENT#callback-<uuid>"
//	SK = "CALLBACK#escalation_verdict"
//
// This keeps the verdict co-located with the callback without touching the
// main GSI1 list partition, and avoids adding a new GSI. Summary computation
// (false-positive rate) over-fetches recent callbacks then batch-fetches
// verdicts — cheap for the current scale.
type CallbackEscalationVerdict struct {
	CallbackID  string    `dynamodbav:"callbackId"`
	Appropriate bool      `dynamodbav:"appropriate"`
	Note        string    `dynamodbav:"note,omitempty"` // max 500 chars; no PHI
	VerdictBy   string    `dynamodbav:"verdictBy"`
	VerdictAt   time.Time `dynamodbav:"verdictAt"`
	RetainUntil time.Time `dynamodbav:"retainUntil"`
}

const escalationVerdictSK = "CALLBACK#escalation_verdict"

// PutEscalationVerdict upserts an escalation verdict for one callback.
func (s *Store) PutEscalationVerdict(ctx context.Context, v CallbackEscalationVerdict) error {
	if v.CallbackID == "" {
		return fmt.Errorf("phi: CallbackEscalationVerdict.CallbackID is required")
	}
	if v.VerdictBy == "" {
		return fmt.Errorf("phi: CallbackEscalationVerdict.VerdictBy is required")
	}
	if len(v.Note) > 500 {
		return fmt.Errorf("phi: CallbackEscalationVerdict.Note exceeds 500 chars")
	}
	if v.VerdictAt.IsZero() {
		v.VerdictAt = time.Now().UTC()
	}
	if v.RetainUntil.IsZero() {
		v.RetainUntil = v.VerdictAt.AddDate(7, 0, 0)
	}

	item, err := attributevalue.MarshalMap(v)
	if err != nil {
		return fmt.Errorf("phi: marshal escalation verdict: %w", err)
	}
	item["PK"] = &ddbtypes.AttributeValueMemberS{Value: callbackPK(v.CallbackID)}
	item["SK"] = &ddbtypes.AttributeValueMemberS{Value: escalationVerdictSK}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	_, err = s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("phi: put escalation verdict: %w", err)
	}
	s.auditPHI("callback_escalation_verdicts", "INSERT", v.CallbackID, actorFromContext(ctx), "")
	return nil
}

// GetEscalationVerdict fetches the escalation verdict for one callback.
// Returns ErrNotFound when no verdict exists yet.
func (s *Store) GetEscalationVerdict(ctx context.Context, callbackID string) (*CallbackEscalationVerdict, error) {
	if callbackID == "" {
		return nil, fmt.Errorf("phi: callbackID is required")
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.tableName),
		Key: map[string]ddbtypes.AttributeValue{
			"PK": &ddbtypes.AttributeValueMemberS{Value: callbackPK(callbackID)},
			"SK": &ddbtypes.AttributeValueMemberS{Value: escalationVerdictSK},
		},
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("phi: get escalation verdict: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, ErrNotFound
	}
	var v CallbackEscalationVerdict
	if err := attributevalue.UnmarshalMap(out.Item, &v); err != nil {
		return nil, fmt.Errorf("phi: unmarshal escalation verdict: %w", err)
	}
	return &v, nil
}

// BatchGetEscalationVerdicts fetches escalation verdicts for a slice of
// callback IDs using BatchGetItem. Items without a verdict are absent from
// the returned map (no error). Capped at 100 per AWS limit.
func (s *Store) BatchGetEscalationVerdicts(ctx context.Context, callbackIDs []string) (map[string]*CallbackEscalationVerdict, error) {
	result := make(map[string]*CallbackEscalationVerdict, len(callbackIDs))
	if len(callbackIDs) == 0 {
		return result, nil
	}

	// Deduplicate.
	seen := make(map[string]struct{}, len(callbackIDs))
	deduped := callbackIDs[:0:0]
	for _, id := range callbackIDs {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		deduped = append(deduped, id)
	}

	for start := 0; start < len(deduped); start += 100 {
		end := start + 100
		if end > len(deduped) {
			end = len(deduped)
		}
		chunk := deduped[start:end]

		reqKeys := make([]map[string]ddbtypes.AttributeValue, 0, len(chunk))
		for _, id := range chunk {
			reqKeys = append(reqKeys, map[string]ddbtypes.AttributeValue{
				"PK": &ddbtypes.AttributeValueMemberS{Value: callbackPK(id)},
				"SK": &ddbtypes.AttributeValueMemberS{Value: escalationVerdictSK},
			})
		}

		pending := map[string]ddbtypes.KeysAndAttributes{
			s.tableName: {Keys: reqKeys, ConsistentRead: aws.Bool(true)},
		}

		for attempt := 0; attempt < 6 && len(pending[s.tableName].Keys) > 0; attempt++ {
			bctx, bcancel := context.WithTimeout(ctx, s.timeout)
			resp, err := s.ddb.BatchGetItem(bctx, &dynamodb.BatchGetItemInput{
				RequestItems: pending,
			})
			bcancel()
			if err != nil {
				return result, fmt.Errorf("phi: batch get escalation verdicts: %w", err)
			}
			for _, items := range resp.Responses {
				for _, it := range items {
					var v CallbackEscalationVerdict
					if err := attributevalue.UnmarshalMap(it, &v); err != nil {
						return result, fmt.Errorf("phi: unmarshal escalation verdict (batch): %w", err)
					}
					result[v.CallbackID] = &v
				}
			}
			if u, ok := resp.UnprocessedKeys[s.tableName]; ok && len(u.Keys) > 0 {
				pending = map[string]ddbtypes.KeysAndAttributes{s.tableName: u}
				sleep := time.Duration(50<<attempt) * time.Millisecond
				select {
				case <-ctx.Done():
					return result, ctx.Err()
				case <-time.After(sleep):
				}
				continue
			}
			pending = nil
			break
		}
		if pending != nil && len(pending[s.tableName].Keys) > 0 {
			return result, fmt.Errorf("phi: batch get escalation verdicts: keys unprocessed after retries")
		}
	}
	return result, nil
}

// ---------------------------------------------------------------------------
// Chat feedback
// ---------------------------------------------------------------------------

// ChatFeedback is a thumbs-up/thumbs-down rating for one chat turn submitted
// from the public website widget.
//
// Key design:
//
//	PK = "CHATFEEDBACK#<session_id>"
//	SK = "TURN#<zero-padded turn_index>"
//
// Rationale: the chat-session PK ("CHAT#<session_id>") uses timestamp-based
// SKs that are not safely addressable by integer turn_index from the widget
// (the widget only knows the ordinal position, not the timestamp). A separate
// CHATFEEDBACK# partition keeps feedback cleanly isolated and queryable per
// session without touching the PHI chat-turn partition. Rating only — no
// message text is stored.
type ChatFeedback struct {
	SessionID   string    `dynamodbav:"sessionId"`
	TurnIndex   int       `dynamodbav:"turnIndex"`
	Rating      string    `dynamodbav:"rating"` // "up" | "down"
	CreatedAt   time.Time `dynamodbav:"createdAt"`
	RetainUntil time.Time `dynamodbav:"retainUntil"`
}

func chatFeedbackPK(sessionID string) string { return "CHATFEEDBACK#" + sessionID }
func chatFeedbackSK(turnIndex int) string    { return fmt.Sprintf("TURN#%06d", turnIndex) }

// PutChatFeedback upserts a rating for one chat turn. An existing rating is
// overwritten (last-write-wins — user may change their mind).
func (s *Store) PutChatFeedback(ctx context.Context, f ChatFeedback) error {
	if f.SessionID == "" {
		return fmt.Errorf("phi: ChatFeedback.SessionID is required")
	}
	if f.Rating != "up" && f.Rating != "down" {
		return fmt.Errorf("phi: ChatFeedback.Rating must be 'up' or 'down'")
	}
	if f.TurnIndex < 0 {
		return fmt.Errorf("phi: ChatFeedback.TurnIndex must be >= 0")
	}
	if f.CreatedAt.IsZero() {
		f.CreatedAt = time.Now().UTC()
	}
	if f.RetainUntil.IsZero() {
		// Feedback is not clinical PHI; retain for 2 years (operational data).
		f.RetainUntil = f.CreatedAt.AddDate(2, 0, 0)
	}

	item, err := attributevalue.MarshalMap(f)
	if err != nil {
		return fmt.Errorf("phi: marshal chat feedback: %w", err)
	}
	item["PK"] = &ddbtypes.AttributeValueMemberS{Value: chatFeedbackPK(f.SessionID)}
	item["SK"] = &ddbtypes.AttributeValueMemberS{Value: chatFeedbackSK(f.TurnIndex)}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	_, err = s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("phi: put chat feedback: %w", err)
	}
	// No PHI audit needed — rating only, no message content, no identifiers.
	return nil
}
