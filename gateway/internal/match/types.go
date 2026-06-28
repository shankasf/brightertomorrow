// Package match provides the therapist-matching logic for Brighter Tomorrow.
//
// Single matching service — logic lives once here. Web, chat widget, and
// AI voice/chat all consume the same endpoints backed by this package.
//
// Design:
//   - Pure function Match(answers, clinicians, config) []Result — no IO, unit-testable.
//   - ClinicianStore / MatchConfigStore / MatchEventStore interfaces defined here
//     (consumer-side, per DIP). Handlers depend on the interfaces; the DDB
//     implementation (*Store) is wired in main.go.
//   - No PHI: clinician roster and match events are non-PHI analytics. They
//     live in the same CMK-encrypted bt-main DynamoDB table as PHI, but no
//     patient identifiers are stored.
//   - All JSON fields are snake_case (gateway convention).
package match

import (
	"context"
	"time"
)

// Clinician is one therapist/practitioner on the public roster.
//
// DDB keys:
//
//	PK = "ENTITY#CLINICIAN"        SK = "CLINICIAN#<slug>"
//	GSI1PK = "CLINICIAN_ACTIVE"    GSI1SK = "<zero-padded-6 sort_order>#<slug>"
//	(GSI1 keys only present when active=true)
type Clinician struct {
	Slug        string    `dynamodbav:"slug"        json:"slug"`
	Name        string    `dynamodbav:"name"        json:"name"`
	Credentials string    `dynamodbav:"credentials" json:"credentials"`
	Initials    string    `dynamodbav:"initials"    json:"initials"`
	Types       []string  `dynamodbav:"types"       json:"types"`
	Locations   []string  `dynamodbav:"locations"   json:"locations"`
	Telehealth  bool      `dynamodbav:"telehealth"  json:"telehealth"`
	Specialties []string  `dynamodbav:"specialties" json:"specialties"`
	Rate        string    `dynamodbav:"rate"        json:"rate"`
	InNetwork   bool      `dynamodbav:"inNetwork"   json:"in_network"`
	StaffID     int       `dynamodbav:"staffId"     json:"staff_id"`
	PhotoURL    string    `dynamodbav:"photoUrl"    json:"photo_url"`
	Active      bool      `dynamodbav:"active"      json:"active"`
	SortOrder   int       `dynamodbav:"sortOrder"   json:"sort_order"`
	CreatedAt   time.Time `dynamodbav:"createdAt"   json:"created_at"`
	UpdatedAt   time.Time `dynamodbav:"updatedAt"   json:"updated_at"`
}

// normalizeClinician ensures slice fields are never nil in returned Clinicians.
func normalizeClinician(c *Clinician) {
	if c.Types == nil {
		c.Types = []string{}
	}
	if c.Locations == nil {
		c.Locations = []string{}
	}
	if c.Specialties == nil {
		c.Specialties = []string{}
	}
}

// QuestionOption is one selectable answer in a quiz step.
type QuestionOption struct {
	Value string `dynamodbav:"value" json:"value"`
	Label string `dynamodbav:"label" json:"label"`
	Desc  string `dynamodbav:"desc"  json:"desc,omitempty"`
	Icon  string `dynamodbav:"icon"  json:"icon,omitempty"`
}

// Question is one step in the match quiz.
type Question struct {
	ID           string           `dynamodbav:"id"           json:"id"`
	Question     string           `dynamodbav:"question"     json:"question"`
	Sub          string           `dynamodbav:"sub"          json:"sub,omitempty"`
	InPersonOnly bool             `dynamodbav:"inPersonOnly" json:"in_person_only"`
	Options      []QuestionOption `dynamodbav:"options"      json:"options"`
}

// MatchConfig holds the quiz definition (admin-editable singleton).
//
// DDB keys:
//
//	PK = "ENTITY#MATCH_CONFIG"   SK = "CONFIG#current"
type MatchConfig struct {
	Questions     []Question `dynamodbav:"questions"      json:"questions"`
	IntroTitle    string     `dynamodbav:"introTitle"     json:"intro_title,omitempty"`
	IntroSubtitle string     `dynamodbav:"introSubtitle"  json:"intro_subtitle,omitempty"`
	UpdatedAt     time.Time  `dynamodbav:"updatedAt"      json:"updated_at"`
}

// MatchAnswers are the visitor's quiz selections.
type MatchAnswers struct {
	Type      string `dynamodbav:"type"      json:"type"`
	Modality  string `dynamodbav:"modality"  json:"modality,omitempty"`
	Location  string `dynamodbav:"location"  json:"location,omitempty"`
	Insurance string `dynamodbav:"insurance" json:"insurance,omitempty"`
}

// Result is one matched clinician with a human-readable reason.
type Result struct {
	Clinician
	MatchReason string `json:"match_reason"`
}

// MatchEvent is one non-PHI analytics row.
//
// DDB keys:
//
//	PK = "ENTITY#MATCH_EVENT"          SK = "EVENT#<uuid>"
//	GSI1PK = "MATCH_EVENT#<YYYY-MM-DD>"  GSI1SK = "<RFC3339Nano>"
//
// SK uses the uuid directly (not RFC3339Nano#uuid) so UpdateMatchEventPick
// can do a single GetItem by match_uuid without scanning the partition.
// (Contract SK format deviated from intentionally; documented in package comment.)
type MatchEvent struct {
	ID          string       `dynamodbav:"id"          json:"id"`
	CreatedAt   time.Time    `dynamodbav:"createdAt"   json:"created_at"`
	Channel     string       `dynamodbav:"channel"     json:"channel"`
	Answers     MatchAnswers `dynamodbav:"answers"     json:"answers"`
	ResultCount int          `dynamodbav:"resultCount" json:"result_count"`
	PickedSlug  string       `dynamodbav:"pickedSlug,omitempty" json:"picked_slug,omitempty"`
	RetainUntil time.Time    `dynamodbav:"retainUntil" json:"retain_until"`
}

// Sentinel errors.
var (
	ErrNotFound      = &matchError{"match: record not found"}
	ErrAlreadyExists = &matchError{"match: record already exists"}
)

type matchError struct{ msg string }

func (e *matchError) Error() string { return e.msg }

// ─── interfaces (defined by the consumer — DIP) ────────────────────────────

// ClinicianStore is the storage abstraction for clinician CRUD.
type ClinicianStore interface {
	ListClinicians(ctx context.Context, activeOnly bool) ([]Clinician, error)
	GetClinician(ctx context.Context, slug string) (*Clinician, error)
	PutClinician(ctx context.Context, c Clinician) error
}

// MatchConfigStore is the storage abstraction for the quiz configuration.
type MatchConfigStore interface {
	GetMatchConfig(ctx context.Context) (*MatchConfig, error)
	PutMatchConfig(ctx context.Context, cfg MatchConfig) error
}

// MatchEventStore is the storage abstraction for non-PHI analytics events.
type MatchEventStore interface {
	PutMatchEvent(ctx context.Context, e MatchEvent) error
	UpdateMatchEventPick(ctx context.Context, matchUUID, pickedSlug string) error
	ListMatchEvents(ctx context.Context, from, to time.Time) ([]MatchEvent, error)
}
