package calendar

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// ErrConflict is returned when a requested slot is already occupied.
var ErrConflict = errors.New("calendar: slot taken")

// ddbClient is the subset of the AWS DDB SDK we need. Matches the interface
// already declared in phi.Store — defined here by the consumer so we can
// inject a test double without touching the phi package.
type ddbClient interface {
	PutItem(ctx context.Context, in *dynamodb.PutItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	DeleteItem(ctx context.Context, in *dynamodb.DeleteItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error)
	Query(ctx context.Context, in *dynamodb.QueryInput, opts ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
}

// Store provides calendar-specific DDB access. Constructed with NewStore.
type Store struct {
	ddb             ddbClient
	janeEventsTable string
	softHoldsTable  string
	timeout         time.Duration
}

// StoreConfig controls Store construction.
type StoreConfig struct {
	DDB             ddbClient
	JaneEventsTable string
	SoftHoldsTable  string
	Timeout         time.Duration
}

// NewStore constructs a Store and validates required config.
func NewStore(cfg StoreConfig) (*Store, error) {
	if cfg.DDB == nil {
		return nil, errors.New("calendar: DDB client is required")
	}
	if cfg.JaneEventsTable == "" {
		return nil, errors.New("calendar: JaneEventsTable is required")
	}
	if cfg.SoftHoldsTable == "" {
		return nil, errors.New("calendar: SoftHoldsTable is required")
	}
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 5 * time.Second
	}
	return &Store{
		ddb:             cfg.DDB,
		janeEventsTable: cfg.JaneEventsTable,
		softHoldsTable:  cfg.SoftHoldsTable,
		timeout:         timeout,
	}, nil
}

// ---------------------------------------------------------------------------
// DDB record shapes
// ---------------------------------------------------------------------------

// JaneEvent is one row from bt-jane-events.
// PK = "staff#<staffId>", SK = "<type>#<startISO>#<uid>"
type JaneEvent struct {
	StaffID     int    `dynamodbav:"staffId"`
	Type        string `dynamodbav:"type"` // "shift" | "appointment" | etc.
	StartISO    string `dynamodbav:"startISO"`
	EndISO      string `dynamodbav:"endISO"`
	Summary     string `dynamodbav:"summary"`
	Description string `dynamodbav:"description"` // PHI — never return from list
	Location    string `dynamodbav:"location"`
	Status      string `dynamodbav:"status"`
	UID         string `dynamodbav:"uid"`
	FetchedAt   string `dynamodbav:"fetchedAt"`
	TTL         int64  `dynamodbav:"ttl"`
}

// SoftHold is one row from bt-soft-holds.
// PK = "staff#<staffId>", SK = holdId (UUID)
type SoftHold struct {
	HoldID           string `dynamodbav:"holdId"`
	StaffID          int    `dynamodbav:"staffId"`
	StartISO         string `dynamodbav:"startISO"`
	EndISO           string `dynamodbav:"endISO"`
	VisitorRef       string `dynamodbav:"visitorRef"`
	AppointmentDraft string `dynamodbav:"appointmentDraft"` // PHI JSON blob
	ExpiresAt        int64  `dynamodbav:"expiresAt"`        // Unix TTL
	CreatedAt        string `dynamodbav:"createdAt"`
}

// Slot is a candidate free slot for booking.
type Slot struct {
	StartISO string `json:"startISO"`
	EndISO   string `json:"endISO"`
}

// ---------------------------------------------------------------------------
// DDB keys
// ---------------------------------------------------------------------------

func staffPK(staffID int) string {
	return fmt.Sprintf("staff#%d", staffID)
}

// ---------------------------------------------------------------------------
// Query jane-events
// ---------------------------------------------------------------------------

// ListEvents returns jane-events for staffID whose startISO falls within
// [fromISO, toISO]. If staffID == 0 it queries all feed-connected therapists.
// PHI (description) is included in the returned structs — callers must NOT
// forward it to list responses; only the details endpoint may expose it.
func (s *Store) ListEvents(ctx context.Context, staffID int, fromISO, toISO string) ([]JaneEvent, error) {
	if staffID != 0 {
		return s.queryEventsForStaff(ctx, staffID, fromISO, toISO)
	}
	// Fan out over all feed-connected therapists.
	var all []JaneEvent
	for _, t := range Roster {
		if !t.FeedConnected {
			continue
		}
		evts, err := s.queryEventsForStaff(ctx, t.StaffID, fromISO, toISO)
		if err != nil {
			return nil, fmt.Errorf("calendar: list events for staff %d: %w", t.StaffID, err)
		}
		all = append(all, evts...)
	}
	return all, nil
}

func (s *Store) queryEventsForStaff(ctx context.Context, staffID int, fromISO, toISO string) ([]JaneEvent, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.janeEventsTable),
		KeyConditionExpression: aws.String("pk = :pk AND sk BETWEEN :from AND :to"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": &ddbtypes.AttributeValueMemberS{Value: staffPK(staffID)},
			// SK format: "<type>#<startISO>#<uid>" — range prefix works because
			// startISO is ISO 8601 UTC which sorts lexicographically by time.
			// We bound on "#" + fromISO and "~" (after all printable ASCII)
			// to capture any type prefix but stay within the date window.
			":from": &ddbtypes.AttributeValueMemberS{Value: "#" + fromISO},
			":to":   &ddbtypes.AttributeValueMemberS{Value: "~" + toISO},
		},
		ScanIndexForward: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("calendar: query jane events staff %d: %w", staffID, err)
	}

	evts := make([]JaneEvent, 0, len(out.Items))
	for _, it := range out.Items {
		var e JaneEvent
		if err := attributevalue.UnmarshalMap(it, &e); err != nil {
			return nil, fmt.Errorf("calendar: unmarshal jane event: %w", err)
		}
		// Ensure staffID is populated even if the attribute was stored as the
		// PK composite. Override from PK if zero.
		if e.StaffID == 0 {
			e.StaffID = staffID
		}
		// Keep any event whose window overlaps [fromISO, toISO). A shift that
		// starts before fromISO but ends after it still covers the slot — we
		// must not drop it. ISO 8601 UTC strings compare lexicographically by
		// time, so string compare is correct here.
		if e.EndISO > fromISO && e.StartISO < toISO {
			evts = append(evts, e)
		}
	}
	return evts, nil
}

// GetEventByPKSK fetches a single jane-event by its raw PK and SK.
// Used by the details endpoint to return the description (PHI).
func (s *Store) GetEventByPKSK(ctx context.Context, pk, sk string) (*JaneEvent, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.janeEventsTable),
		Key: map[string]ddbtypes.AttributeValue{
			"pk": &ddbtypes.AttributeValueMemberS{Value: pk},
			"sk": &ddbtypes.AttributeValueMemberS{Value: sk},
		},
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("calendar: get event by pk/sk: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, ErrNotFound
	}
	var e JaneEvent
	if err := attributevalue.UnmarshalMap(out.Item, &e); err != nil {
		return nil, fmt.Errorf("calendar: unmarshal jane event detail: %w", err)
	}
	return &e, nil
}

// ---------------------------------------------------------------------------
// Soft-holds
// ---------------------------------------------------------------------------

// ListActiveHolds returns all soft-holds for staffID that have not yet expired.
func (s *Store) ListActiveHolds(ctx context.Context, staffID int) ([]SoftHold, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.softHoldsTable),
		KeyConditionExpression: aws.String("pk = :pk"),
		// Filter expired holds. expiresAt is a Unix epoch int.
		FilterExpression: aws.String("expiresAt > :now"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk":  &ddbtypes.AttributeValueMemberS{Value: staffPK(staffID)},
			":now": &ddbtypes.AttributeValueMemberN{Value: strconv.FormatInt(time.Now().Unix(), 10)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("calendar: list soft holds staff %d: %w", staffID, err)
	}
	holds := make([]SoftHold, 0, len(out.Items))
	for _, it := range out.Items {
		var h SoftHold
		if err := attributevalue.UnmarshalMap(it, &h); err != nil {
			return nil, fmt.Errorf("calendar: unmarshal soft hold: %w", err)
		}
		holds = append(holds, h)
	}
	return holds, nil
}

// GetHold fetches a single soft-hold by staffID and holdId.
func (s *Store) GetHold(ctx context.Context, staffID int, holdID string) (*SoftHold, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.softHoldsTable),
		Key: map[string]ddbtypes.AttributeValue{
			"pk": &ddbtypes.AttributeValueMemberS{Value: staffPK(staffID)},
			"sk": &ddbtypes.AttributeValueMemberS{Value: holdID},
		},
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("calendar: get hold: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, ErrNotFound
	}
	var h SoftHold
	if err := attributevalue.UnmarshalMap(out.Item, &h); err != nil {
		return nil, fmt.Errorf("calendar: unmarshal hold: %w", err)
	}
	return &h, nil
}

// PutHold writes a soft-hold. ExpiresAt must be set to a future Unix epoch.
func (s *Store) PutHold(ctx context.Context, h SoftHold) error {
	if h.HoldID == "" || h.StaffID == 0 {
		return errors.New("calendar: HoldID and StaffID are required")
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	item, err := attributevalue.MarshalMap(h)
	if err != nil {
		return fmt.Errorf("calendar: marshal hold: %w", err)
	}
	item["pk"] = &ddbtypes.AttributeValueMemberS{Value: staffPK(h.StaffID)}
	item["sk"] = &ddbtypes.AttributeValueMemberS{Value: h.HoldID}

	if _, err := s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.softHoldsTable),
		Item:      item,
	}); err != nil {
		return fmt.Errorf("calendar: put hold: %w", err)
	}
	return nil
}

// DeleteHold removes a soft-hold after confirmation.
func (s *Store) DeleteHold(ctx context.Context, staffID int, holdID string) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	if _, err := s.ddb.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(s.softHoldsTable),
		Key: map[string]ddbtypes.AttributeValue{
			"pk": &ddbtypes.AttributeValueMemberS{Value: staffPK(staffID)},
			"sk": &ddbtypes.AttributeValueMemberS{Value: holdID},
		},
	}); err != nil {
		return fmt.Errorf("calendar: delete hold: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Free-slot computation
// ---------------------------------------------------------------------------

const maxSlots = 50

// timeWindow is a half-open [start, end) interval.
type timeWindow struct {
	start time.Time
	end   time.Time
}

func parseISO(s string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("calendar: parse time %q: %w", s, err)
	}
	return t.UTC(), nil
}

// FreeSlots computes available booking slots for staffID between fromISO and
// toISO. It fetches shifts from jane-events, subtracts appointments and active
// soft-holds, aligns starts to 30-minute boundaries, and returns the first
// maxSlots candidate slots of at least slotMinutes duration.
func (s *Store) FreeSlots(ctx context.Context, staffID int, fromISO, toISO string, slotMinutes int) ([]Slot, error) {
	events, err := s.queryEventsForStaff(ctx, staffID, fromISO, toISO)
	if err != nil {
		return nil, err
	}
	holds, err := s.ListActiveHolds(ctx, staffID)
	if err != nil {
		return nil, err
	}
	return computeFreeSlots(events, holds, fromISO, toISO, slotMinutes)
}

// computeFreeSlots is the pure function extracted for unit testing.
// events: all jane-events in range; holds: active soft-holds for the staff.
func computeFreeSlots(events []JaneEvent, holds []SoftHold, fromISO, toISO string, slotMinutes int) ([]Slot, error) {
	from, err := parseISO(fromISO)
	if err != nil {
		return nil, err
	}
	to, err := parseISO(toISO)
	if err != nil {
		return nil, err
	}
	dur := time.Duration(slotMinutes) * time.Minute

	// 1. Collect shift windows.
	var shifts []timeWindow
	for _, e := range events {
		if e.Type != "shift" {
			continue
		}
		s, err := parseISO(e.StartISO)
		if err != nil {
			continue
		}
		en, err := parseISO(e.EndISO)
		if err != nil {
			continue
		}
		// Intersect with query window.
		if s.Before(from) {
			s = from
		}
		if en.After(to) {
			en = to
		}
		if s.Before(en) {
			shifts = append(shifts, timeWindow{start: s, end: en})
		}
	}

	if len(shifts) == 0 {
		return nil, nil
	}
	sort.Slice(shifts, func(i, j int) bool { return shifts[i].start.Before(shifts[j].start) })

	// 2. Collect busy windows (appointments + active holds).
	var busy []timeWindow
	for _, e := range events {
		if e.Type != "appointment" {
			continue
		}
		s, err := parseISO(e.StartISO)
		if err != nil {
			continue
		}
		en, err := parseISO(e.EndISO)
		if err != nil {
			continue
		}
		busy = append(busy, timeWindow{start: s, end: en})
	}
	now := time.Now().Unix()
	for _, h := range holds {
		if h.ExpiresAt <= now {
			continue
		}
		hs, err := parseISO(h.StartISO)
		if err != nil {
			continue
		}
		he, err := parseISO(h.EndISO)
		if err != nil {
			continue
		}
		busy = append(busy, timeWindow{start: hs, end: he})
	}
	sort.Slice(busy, func(i, j int) bool { return busy[i].start.Before(busy[j].start) })

	// 3. For each shift, subtract busy intervals.
	var free []timeWindow
	for _, sh := range shifts {
		frag := subtractBusy(sh, busy)
		free = append(free, frag...)
	}

	// 4. Enumerate aligned slots from free fragments, return first maxSlots.
	return enumerateSlots(free, dur, maxSlots), nil
}

// subtractBusy removes busy intervals from a single shift window, returning
// the remaining free fragments.
func subtractBusy(shift timeWindow, busy []timeWindow) []timeWindow {
	result := []timeWindow{shift}
	for _, b := range busy {
		// Skip non-overlapping busy blocks.
		if !b.end.After(shift.start) || !b.start.Before(shift.end) {
			continue
		}
		next := make([]timeWindow, 0, len(result)+1)
		for _, r := range result {
			if !b.end.After(r.start) || !b.start.Before(r.end) {
				next = append(next, r)
				continue
			}
			if r.start.Before(b.start) {
				next = append(next, timeWindow{start: r.start, end: b.start})
			}
			if r.end.After(b.end) {
				next = append(next, timeWindow{start: b.end, end: r.end})
			}
		}
		result = next
	}
	return result
}

// enumerateSlots walks free fragments and emits aligned slots of `dur` duration.
// Starts are snapped to the next 30-minute boundary.
func enumerateSlots(free []timeWindow, dur time.Duration, maxCount int) []Slot {
	var slots []Slot
	for _, w := range free {
		cursor := alignTo30(w.start)
		for cursor.Add(dur).Before(w.end) || cursor.Add(dur).Equal(w.end) {
			slots = append(slots, Slot{
				StartISO: cursor.UTC().Format(time.RFC3339),
				EndISO:   cursor.Add(dur).UTC().Format(time.RFC3339),
			})
			if len(slots) >= maxCount {
				return slots
			}
			cursor = cursor.Add(30 * time.Minute)
		}
	}
	return slots
}

// alignTo30 snaps t forward to the next (or current) 30-minute boundary (UTC).
func alignTo30(t time.Time) time.Time {
	t = t.UTC()
	m := t.Minute()
	if m == 0 {
		return t.Truncate(time.Minute)
	}
	if m <= 30 {
		return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), 30, 0, 0, time.UTC)
	}
	// Advance to next hour's :00
	next := time.Date(t.Year(), t.Month(), t.Day(), t.Hour()+1, 0, 0, 0, time.UTC)
	return next
}

// IsSlotFree returns true if the given [startISO, endISO) window has no
// conflicting appointments or active holds for staffID.
func (s *Store) IsSlotFree(ctx context.Context, staffID int, startISO, endISO string) (bool, error) {
	events, err := s.queryEventsForStaff(ctx, staffID, startISO, endISO)
	if err != nil {
		return false, err
	}
	holds, err := s.ListActiveHolds(ctx, staffID)
	if err != nil {
		return false, err
	}
	slotStart, err := parseISO(startISO)
	if err != nil {
		return false, err
	}
	slotEnd, err := parseISO(endISO)
	if err != nil {
		return false, err
	}

	// Must be within a shift.
	inShift := false
	for _, e := range events {
		if e.Type != "shift" {
			continue
		}
		es, _ := parseISO(e.StartISO)
		ee, _ := parseISO(e.EndISO)
		if !slotStart.Before(es) && !slotEnd.After(ee) {
			inShift = true
			break
		}
	}
	if !inShift {
		return false, nil
	}

	// Must not overlap any appointment.
	for _, e := range events {
		if e.Type != "appointment" {
			continue
		}
		es, _ := parseISO(e.StartISO)
		ee, _ := parseISO(e.EndISO)
		if overlaps(slotStart, slotEnd, es, ee) {
			return false, nil
		}
	}

	// Must not overlap any active hold.
	now := time.Now().Unix()
	for _, h := range holds {
		if h.ExpiresAt <= now {
			continue
		}
		hs, _ := parseISO(h.StartISO)
		he, _ := parseISO(h.EndISO)
		if overlaps(slotStart, slotEnd, hs, he) {
			return false, nil
		}
	}
	return true, nil
}

// overlaps returns true if [as, ae) and [bs, be) share any time.
func overlaps(as, ae, bs, be time.Time) bool {
	return as.Before(be) && ae.After(bs)
}

// NearestAlternatives finds up to 3 alternative free slots near the requested time.
// Used for 409 responses.
func (s *Store) NearestAlternatives(ctx context.Context, staffID int, startISO, endISO string) ([]Slot, error) {
	slotStart, err := parseISO(startISO)
	if err != nil {
		return nil, err
	}
	// Search ±3 days around the requested slot.
	searchFrom := slotStart.Add(-72 * time.Hour).Format(time.RFC3339)
	searchTo := slotStart.Add(72 * time.Hour).Format(time.RFC3339)

	slotMins := 50
	if end, err2 := parseISO(endISO); err2 == nil {
		slotMins = int(end.Sub(slotStart).Minutes())
	}

	candidates, err := s.FreeSlots(ctx, staffID, searchFrom, searchTo, slotMins)
	if err != nil {
		return nil, err
	}

	// Remove the exact conflicted slot if it appears (shouldn't, but be safe).
	var alts []Slot
	for _, c := range candidates {
		if c.StartISO == startISO {
			continue
		}
		alts = append(alts, c)
		if len(alts) == 3 {
			break
		}
	}
	return alts, nil
}

// Sentinel errors.
var ErrNotFound = errors.New("calendar: record not found")
