// Package calendar provides the in-app calendar layer: therapist roster,
// DynamoDB access for jane-events and soft-holds, and free-slot computation.
package calendar

// Therapist is one entry in the practice roster.
type Therapist struct {
	StaffID       int    `json:"staffId"`
	Name          string `json:"name"`
	FeedConnected bool   `json:"feedConnected"`
	ColorHex      string `json:"colorHex"`
}

// Roster is the canonical list of 10 therapists. All have iCal feeds wired
// (feedConnected: true) — the prior 4 "no-feed" entries got self-served
// tokens on 2026-05-21. This is the single source of truth — admin UI and
// AI agents derive the staffId set from this slice.
var Roster = []Therapist{
	{StaffID: 71, Name: "Sagar Shankaran", FeedConnected: true, ColorHex: "#7C3AED"},
	{StaffID: 47, Name: "Elisia Danley", FeedConnected: true, ColorHex: "#DB2777"},
	{StaffID: 24, Name: "Keunshea Fleming", FeedConnected: true, ColorHex: "#2563EB"},
	{StaffID: 21, Name: "Alayna Hammond", FeedConnected: true, ColorHex: "#059669"},
	{StaffID: 34, Name: "Christie Johnson", FeedConnected: true, ColorHex: "#D97706"},
	{StaffID: 53, Name: "Janelle Thompson", FeedConnected: true, ColorHex: "#DC2626"},
	{StaffID: 59, Name: "Samara Cobb", FeedConnected: true, ColorHex: "#0891B2"},
	{StaffID: 16, Name: "Joanne Tran", FeedConnected: true, ColorHex: "#9333EA"},
	{StaffID: 45, Name: "Jordan Fuller", FeedConnected: true, ColorHex: "#65A30D"},
	{StaffID: 66, Name: "Monica Gonzalez", FeedConnected: true, ColorHex: "#EA580C"},
}

// rosterByID maps staffId → Therapist for O(1) lookup. Built once at init.
var rosterByID = func() map[int]Therapist {
	m := make(map[int]Therapist, len(Roster))
	for _, t := range Roster {
		m[t.StaffID] = t
	}
	return m
}()

// ByID returns the therapist for the given staffId and whether it was found.
func ByID(staffID int) (Therapist, bool) {
	t, ok := rosterByID[staffID]
	return t, ok
}
