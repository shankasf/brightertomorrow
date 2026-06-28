// store.go — DynamoDB persistence for the match feature (non-PHI).
//
// Single-table key design (bt-main):
//
//	Clinician:
//	  PK = "ENTITY#CLINICIAN"           SK = "CLINICIAN#<slug>"
//	  GSI1PK = "CLINICIAN_ACTIVE"       GSI1SK = "<zero-padded-6 sort_order>#<slug>"
//	  (GSI1 keys only present when active=true)
//
//	MatchConfig (singleton):
//	  PK = "ENTITY#MATCH_CONFIG"        SK = "CONFIG#current"
//
//	MatchEvent:
//	  PK = "ENTITY#MATCH_EVENT"         SK = "EVENT#<uuid>"
//	  GSI1PK = "MATCH_EVENT#<YYYY-MM-DD>"  GSI1SK = "<RFC3339Nano>"
//
// Note: MatchEvent SK uses SK=EVENT#<uuid> rather than EVENT#<RFC3339#uuid>
// so UpdateMatchEventPick can do a direct GetItem+UpdateItem by match_uuid
// (O(1)) instead of scanning the partition.
//
// No PHI is stored here. clinician roster and match events are public/
// non-PHI analytics. They share the CMK-encrypted bt-main table for
// operational simplicity.
package match

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

const (
	clinicianPKValue  = "ENTITY#CLINICIAN"
	configPKValue     = "ENTITY#MATCH_CONFIG"
	configSKValue     = "CONFIG#current"
	eventPKValue      = "ENTITY#MATCH_EVENT"
	clinicianActivePK = "CLINICIAN_ACTIVE"

	defaultGSI1Name = "GSI1"
)

// ddbClient is the minimal DynamoDB API surface the match store needs.
// The concrete *dynamodb.Client satisfies it, as does the phi.DDBClient interface.
type ddbClient interface {
	PutItem(ctx context.Context, in *dynamodb.PutItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	Query(ctx context.Context, in *dynamodb.QueryInput, opts ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	UpdateItem(ctx context.Context, in *dynamodb.UpdateItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
}

// StoreConfig controls Store construction.
type StoreConfig struct {
	DDB       ddbClient
	TableName string
	GSI1Name  string // defaults to "GSI1"
	Timeout   time.Duration
}

// Store implements ClinicianStore, MatchConfigStore, and MatchEventStore.
type Store struct {
	ddb       ddbClient
	tableName string
	gsi1Name  string
	timeout   time.Duration
}

// NewStore constructs and validates a Store.
func NewStore(cfg StoreConfig) (*Store, error) {
	if cfg.DDB == nil {
		return nil, errors.New("match: DDB client is required")
	}
	if cfg.TableName == "" {
		return nil, errors.New("match: TableName is required")
	}
	gsi := cfg.GSI1Name
	if gsi == "" {
		gsi = defaultGSI1Name
	}
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 5 * time.Second
	}
	return &Store{
		ddb:       cfg.DDB,
		tableName: cfg.TableName,
		gsi1Name:  gsi,
		timeout:   timeout,
	}, nil
}

// Compile-time interface checks.
var (
	_ ClinicianStore   = (*Store)(nil)
	_ MatchConfigStore = (*Store)(nil)
	_ MatchEventStore  = (*Store)(nil)
)

// ─── Clinician ─────────────────────────────────────────────────────────────

func clinicianSK(slug string) string { return "CLINICIAN#" + slug }
func clinicianGSI1SK(c Clinician) string {
	return fmt.Sprintf("%06d#%s", c.SortOrder, c.Slug)
}

// PutClinician upserts a clinician (create or full replacement).
// Set GSI1 keys only when active; inactive clinicians drop out of the active index.
func (s *Store) PutClinician(ctx context.Context, c Clinician) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	item, err := attributevalue.MarshalMap(c)
	if err != nil {
		return fmt.Errorf("match: marshal clinician %q: %w", c.Slug, err)
	}
	item["PK"] = &ddbtypes.AttributeValueMemberS{Value: clinicianPKValue}
	item["SK"] = &ddbtypes.AttributeValueMemberS{Value: clinicianSK(c.Slug)}

	if c.Active {
		item["GSI1PK"] = &ddbtypes.AttributeValueMemberS{Value: clinicianActivePK}
		item["GSI1SK"] = &ddbtypes.AttributeValueMemberS{Value: clinicianGSI1SK(c)}
	} else {
		// Remove GSI1 keys so the inactive clinician falls out of the active index.
		delete(item, "GSI1PK")
		delete(item, "GSI1SK")
	}

	_, err = s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("match: put clinician %q: %w", c.Slug, err)
	}
	return nil
}

// GetClinician fetches one clinician by slug. Returns ErrNotFound if absent.
func (s *Store) GetClinician(ctx context.Context, slug string) (*Clinician, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.tableName),
		Key: map[string]ddbtypes.AttributeValue{
			"PK": &ddbtypes.AttributeValueMemberS{Value: clinicianPKValue},
			"SK": &ddbtypes.AttributeValueMemberS{Value: clinicianSK(slug)},
		},
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("match: get clinician %q: %w", slug, err)
	}
	if len(out.Item) == 0 {
		return nil, ErrNotFound
	}

	var c Clinician
	if err := attributevalue.UnmarshalMap(out.Item, &c); err != nil {
		return nil, fmt.Errorf("match: unmarshal clinician %q: %w", slug, err)
	}
	normalizeClinician(&c)
	return &c, nil
}

// ListClinicians returns all clinicians. When activeOnly is true, queries the
// CLINICIAN_ACTIVE GSI (ordered by sort_order). When false, queries the main
// table partition (unordered; caller sorts).
func (s *Store) ListClinicians(ctx context.Context, activeOnly bool) ([]Clinician, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	var out *dynamodb.QueryOutput
	var err error

	if activeOnly {
		out, err = s.ddb.Query(ctx, &dynamodb.QueryInput{
			TableName:              aws.String(s.tableName),
			IndexName:              aws.String(s.gsi1Name),
			KeyConditionExpression: aws.String("GSI1PK = :pk"),
			ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
				":pk": &ddbtypes.AttributeValueMemberS{Value: clinicianActivePK},
			},
			ScanIndexForward: aws.Bool(true), // sort_order ascending via GSI1SK
		})
	} else {
		out, err = s.ddb.Query(ctx, &dynamodb.QueryInput{
			TableName:              aws.String(s.tableName),
			KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :skp)"),
			ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
				":pk":  &ddbtypes.AttributeValueMemberS{Value: clinicianPKValue},
				":skp": &ddbtypes.AttributeValueMemberS{Value: "CLINICIAN#"},
			},
			ScanIndexForward: aws.Bool(true),
		})
	}
	if err != nil {
		return nil, fmt.Errorf("match: list clinicians (activeOnly=%v): %w", activeOnly, err)
	}

	result := make([]Clinician, 0, len(out.Items))
	for _, it := range out.Items {
		var c Clinician
		if err := attributevalue.UnmarshalMap(it, &c); err != nil {
			return nil, fmt.Errorf("match: unmarshal clinician (list): %w", err)
		}
		normalizeClinician(&c)
		result = append(result, c)
	}
	return result, nil
}

// ─── MatchConfig ───────────────────────────────────────────────────────────

// GetMatchConfig fetches the singleton config. Returns ErrNotFound if not yet seeded.
func (s *Store) GetMatchConfig(ctx context.Context) (*MatchConfig, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.tableName),
		Key: map[string]ddbtypes.AttributeValue{
			"PK": &ddbtypes.AttributeValueMemberS{Value: configPKValue},
			"SK": &ddbtypes.AttributeValueMemberS{Value: configSKValue},
		},
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("match: get match config: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, ErrNotFound
	}

	var cfg MatchConfig
	if err := attributevalue.UnmarshalMap(out.Item, &cfg); err != nil {
		return nil, fmt.Errorf("match: unmarshal match config: %w", err)
	}
	return &cfg, nil
}

// PutMatchConfig replaces the singleton config. UpdatedAt is set by the caller.
func (s *Store) PutMatchConfig(ctx context.Context, cfg MatchConfig) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	item, err := attributevalue.MarshalMap(cfg)
	if err != nil {
		return fmt.Errorf("match: marshal match config: %w", err)
	}
	item["PK"] = &ddbtypes.AttributeValueMemberS{Value: configPKValue}
	item["SK"] = &ddbtypes.AttributeValueMemberS{Value: configSKValue}

	_, err = s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("match: put match config: %w", err)
	}
	return nil
}

// ─── MatchEvent ────────────────────────────────────────────────────────────

func eventSK(id string) string { return "EVENT#" + id }
func eventGSI1PK(t time.Time) string {
	return "MATCH_EVENT#" + t.UTC().Format("2006-01-02")
}

// PutMatchEvent writes one non-PHI analytics event. ID must be a UUID set by the caller.
func (s *Store) PutMatchEvent(ctx context.Context, e MatchEvent) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	item, err := attributevalue.MarshalMap(e)
	if err != nil {
		return fmt.Errorf("match: marshal event %q: %w", e.ID, err)
	}
	item["PK"] = &ddbtypes.AttributeValueMemberS{Value: eventPKValue}
	item["SK"] = &ddbtypes.AttributeValueMemberS{Value: eventSK(e.ID)}
	item["GSI1PK"] = &ddbtypes.AttributeValueMemberS{Value: eventGSI1PK(e.CreatedAt)}
	item["GSI1SK"] = &ddbtypes.AttributeValueMemberS{Value: e.CreatedAt.UTC().Format(time.RFC3339Nano)}

	_, err = s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("match: put match event %q: %w", e.ID, err)
	}
	return nil
}

// UpdateMatchEventPick records which clinician the visitor picked.
// Uses a direct UpdateItem by SK=EVENT#<uuid> — O(1).
// Returns ErrNotFound if the event is unknown (idempotent, no-op treated as
// success by the caller since this is a fire-and-forget operation).
func (s *Store) UpdateMatchEventPick(ctx context.Context, matchUUID, pickedSlug string) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	_, err := s.ddb.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(s.tableName),
		Key: map[string]ddbtypes.AttributeValue{
			"PK": &ddbtypes.AttributeValueMemberS{Value: eventPKValue},
			"SK": &ddbtypes.AttributeValueMemberS{Value: eventSK(matchUUID)},
		},
		UpdateExpression: aws.String("SET pickedSlug = :slug"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":slug": &ddbtypes.AttributeValueMemberS{Value: pickedSlug},
		},
		ConditionExpression: aws.String("attribute_exists(PK)"),
	})
	if err != nil {
		var cond *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &cond) {
			return ErrNotFound
		}
		return fmt.Errorf("match: update event pick %q: %w", matchUUID, err)
	}
	return nil
}

// ListMatchEvents returns all events in the [from, to] time window (inclusive),
// ordered by created_at ascending. Queries the main PK partition and filters
// in memory — acceptable at therapy-practice scale (<10k events/year).
func (s *Store) ListMatchEvents(ctx context.Context, from, to time.Time) ([]MatchEvent, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.tableName),
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :skp)"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk":  &ddbtypes.AttributeValueMemberS{Value: eventPKValue},
			":skp": &ddbtypes.AttributeValueMemberS{Value: "EVENT#"},
		},
		ScanIndexForward: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("match: list match events: %w", err)
	}

	fromUTC := from.UTC()
	toUTC := to.UTC()
	result := make([]MatchEvent, 0, len(out.Items))
	for _, it := range out.Items {
		var e MatchEvent
		if err := attributevalue.UnmarshalMap(it, &e); err != nil {
			return nil, fmt.Errorf("match: unmarshal match event: %w", err)
		}
		t := e.CreatedAt.UTC()
		if (t.Equal(fromUTC) || t.After(fromUTC)) && (t.Equal(toUTC) || t.Before(toUTC)) {
			result = append(result, e)
		}
	}
	return result, nil
}

// ─── Auto-seed ─────────────────────────────────────────────────────────────

// AutoSeed checks if the ENTITY#CLINICIAN partition is empty and, if so,
// upserts DefaultClinicians and DefaultConfig. Idempotent — safe to call
// on every boot. Call in a background goroutine; failures are non-fatal.
func (s *Store) AutoSeed(ctx context.Context) error {
	existing, err := s.ListClinicians(ctx, false)
	if err != nil {
		return fmt.Errorf("match: auto-seed check: %w", err)
	}
	if len(existing) > 0 {
		return nil // already seeded
	}
	return s.seed(ctx, DefaultClinicians, true)
}

// ForceSeed upserts all DefaultClinicians (idempotent update for existing records)
// and seeds DefaultConfig if absent. Used by the seed-clinicians CLI.
func (s *Store) ForceSeed(ctx context.Context) error {
	return s.seed(ctx, DefaultClinicians, false)
}

func (s *Store) seed(ctx context.Context, clinicians []Clinician, seedConfigIfAbsent bool) error {
	now := time.Now().UTC()
	for i := range clinicians {
		c := clinicians[i]
		if c.CreatedAt.IsZero() {
			c.CreatedAt = now
		}
		c.UpdatedAt = now
		if err := s.PutClinician(ctx, c); err != nil {
			return fmt.Errorf("match: seed clinician %q: %w", c.Slug, err)
		}
	}

	if seedConfigIfAbsent {
		if _, err := s.GetMatchConfig(ctx); errors.Is(err, ErrNotFound) {
			cfg := DefaultConfig
			cfg.UpdatedAt = now
			if err2 := s.PutMatchConfig(ctx, cfg); err2 != nil {
				return fmt.Errorf("match: seed config: %w", err2)
			}
		}
	} else {
		// ForceSeed always writes config.
		cfg := DefaultConfig
		cfg.UpdatedAt = now
		if err := s.PutMatchConfig(ctx, cfg); err != nil {
			return fmt.Errorf("match: seed config: %w", err)
		}
	}

	return nil
}

// newMatchEventID generates a new random UUID for a MatchEvent.
func newMatchEventID() string { return uuid.NewString() }
