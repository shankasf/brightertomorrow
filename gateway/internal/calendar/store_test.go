package calendar

import (
	"testing"
	"time"
)

// slotISO builds a slot from plain times for test readability.
func slotISO(start, end string) Slot {
	return Slot{StartISO: start, EndISO: end}
}

func mustParse(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t.UTC()
}

func TestAlignTo30(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"2024-06-10T09:00:00Z", "2024-06-10T09:00:00Z"}, // already on boundary
		{"2024-06-10T09:01:00Z", "2024-06-10T09:30:00Z"}, // between :00 and :30 → :30
		{"2024-06-10T09:29:00Z", "2024-06-10T09:30:00Z"}, // just before :30 → :30
		{"2024-06-10T09:30:00Z", "2024-06-10T09:30:00Z"}, // exactly :30 → :30
		{"2024-06-10T09:31:00Z", "2024-06-10T10:00:00Z"}, // past :30 → next hour
		{"2024-06-10T09:59:00Z", "2024-06-10T10:00:00Z"}, // just before next hour
	}
	for _, tc := range cases {
		got := alignTo30(mustParse(tc.input)).Format(time.RFC3339)
		if got != tc.want {
			t.Errorf("alignTo30(%s) = %s, want %s", tc.input, got, tc.want)
		}
	}
}

func TestSubtractBusy(t *testing.T) {
	shift := timeWindow{
		start: mustParse("2024-06-10T09:00:00Z"),
		end:   mustParse("2024-06-10T17:00:00Z"),
	}

	t.Run("no busy", func(t *testing.T) {
		frags := subtractBusy(shift, nil)
		if len(frags) != 1 {
			t.Fatalf("expected 1 fragment, got %d", len(frags))
		}
		if frags[0] != shift {
			t.Errorf("expected shift unchanged, got %v", frags[0])
		}
	})

	t.Run("busy splits shift in half", func(t *testing.T) {
		busy := []timeWindow{{
			start: mustParse("2024-06-10T12:00:00Z"),
			end:   mustParse("2024-06-10T13:00:00Z"),
		}}
		frags := subtractBusy(shift, busy)
		if len(frags) != 2 {
			t.Fatalf("expected 2 fragments, got %d", len(frags))
		}
		if frags[0].end != mustParse("2024-06-10T12:00:00Z") {
			t.Errorf("first fragment wrong end: %v", frags[0].end)
		}
		if frags[1].start != mustParse("2024-06-10T13:00:00Z") {
			t.Errorf("second fragment wrong start: %v", frags[1].start)
		}
	})

	t.Run("busy outside shift ignored", func(t *testing.T) {
		busy := []timeWindow{{
			start: mustParse("2024-06-10T18:00:00Z"),
			end:   mustParse("2024-06-10T19:00:00Z"),
		}}
		frags := subtractBusy(shift, busy)
		if len(frags) != 1 {
			t.Fatalf("expected 1 fragment, got %d", len(frags))
		}
	})

	t.Run("busy covers entire shift", func(t *testing.T) {
		busy := []timeWindow{{
			start: mustParse("2024-06-10T08:00:00Z"),
			end:   mustParse("2024-06-10T18:00:00Z"),
		}}
		frags := subtractBusy(shift, busy)
		if len(frags) != 0 {
			t.Errorf("expected empty, got %d fragments", len(frags))
		}
	})
}

func TestComputeFreeSlots(t *testing.T) {
	from := "2024-06-10T09:00:00Z"
	to := "2024-06-10T17:00:00Z"

	t.Run("single shift no appointments returns aligned slots", func(t *testing.T) {
		events := []JaneEvent{
			{StaffID: 71, Type: "shift", StartISO: from, EndISO: to},
		}
		slots, err := computeFreeSlots(events, nil, from, to, 50)
		if err != nil {
			t.Fatal(err)
		}
		if len(slots) == 0 {
			t.Fatal("expected slots, got none")
		}
		// First slot should start at 09:00 (already aligned).
		if slots[0].StartISO != "2024-06-10T09:00:00Z" {
			t.Errorf("first slot start = %s, want 09:00", slots[0].StartISO)
		}
		// All slots should be 50 minutes.
		for i, s := range slots {
			st := mustParse(s.StartISO)
			en := mustParse(s.EndISO)
			if en.Sub(st) != 50*time.Minute {
				t.Errorf("slot %d: duration %v, want 50m", i, en.Sub(st))
			}
		}
	})

	t.Run("appointment blocks slots", func(t *testing.T) {
		events := []JaneEvent{
			{StaffID: 71, Type: "shift", StartISO: from, EndISO: to},
			{StaffID: 71, Type: "appointment",
				StartISO: "2024-06-10T09:00:00Z",
				EndISO:   "2024-06-10T11:00:00Z"},
		}
		slots, err := computeFreeSlots(events, nil, from, to, 50)
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range slots {
			if s.StartISO < "2024-06-10T11:00:00Z" {
				t.Errorf("slot at %s overlaps appointment", s.StartISO)
			}
		}
	})

	t.Run("active hold blocks slot", func(t *testing.T) {
		nowUnix := time.Now().Unix()
		events := []JaneEvent{
			{StaffID: 71, Type: "shift", StartISO: from, EndISO: to},
		}
		holds := []SoftHold{{
			HoldID:    "h1",
			StaffID:   71,
			StartISO:  "2024-06-10T09:00:00Z",
			EndISO:    "2024-06-10T10:00:00Z",
			ExpiresAt: nowUnix + 300,
		}}
		slots, err := computeFreeSlots(events, holds, from, to, 50)
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range slots {
			if s.StartISO < "2024-06-10T10:00:00Z" {
				t.Errorf("slot at %s overlaps active hold", s.StartISO)
			}
		}
	})

	t.Run("expired hold does not block slot", func(t *testing.T) {
		nowUnix := time.Now().Unix()
		events := []JaneEvent{
			{StaffID: 71, Type: "shift", StartISO: from, EndISO: to},
		}
		holds := []SoftHold{{
			HoldID:    "h-expired",
			StaffID:   71,
			StartISO:  "2024-06-10T09:00:00Z",
			EndISO:    "2024-06-10T10:00:00Z",
			ExpiresAt: nowUnix - 1, // already expired
		}}
		slots, err := computeFreeSlots(events, holds, from, to, 50)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, s := range slots {
			if s.StartISO == "2024-06-10T09:00:00Z" {
				found = true
				break
			}
		}
		if !found {
			t.Error("expected 09:00 slot to be available after expired hold, but it wasn't")
		}
	})

	t.Run("no shifts returns nil slots", func(t *testing.T) {
		events := []JaneEvent{
			{StaffID: 71, Type: "appointment", StartISO: from, EndISO: to},
		}
		slots, err := computeFreeSlots(events, nil, from, to, 50)
		if err != nil {
			t.Fatal(err)
		}
		if len(slots) != 0 {
			t.Errorf("expected 0 slots without shifts, got %d", len(slots))
		}
	})

	t.Run("capped at maxSlots", func(t *testing.T) {
		// Long shift: 48 hours of open time → more than 50 x 50-min slots.
		events := []JaneEvent{
			{StaffID: 71, Type: "shift",
				StartISO: "2024-06-10T00:00:00Z",
				EndISO:   "2024-06-12T00:00:00Z"},
		}
		slots, err := computeFreeSlots(events, nil,
			"2024-06-10T00:00:00Z", "2024-06-12T00:00:00Z", 50)
		if err != nil {
			t.Fatal(err)
		}
		if len(slots) > maxSlots {
			t.Errorf("got %d slots, expected at most %d", len(slots), maxSlots)
		}
	})
}

func TestOverlaps(t *testing.T) {
	cases := []struct {
		as, ae, bs, be string
		want           bool
	}{
		{"09:00", "10:00", "10:00", "11:00", false}, // adjacent, no overlap
		{"09:00", "10:00", "09:30", "10:30", true},  // partial overlap
		{"09:00", "11:00", "09:30", "10:30", true},  // b inside a
		{"09:30", "10:30", "09:00", "11:00", true},  // a inside b
		{"10:00", "11:00", "08:00", "09:00", false}, // b before a
	}
	base := "2024-06-10T"
	for _, tc := range cases {
		as := mustParse(base + tc.as + ":00Z")
		ae := mustParse(base + tc.ae + ":00Z")
		bs := mustParse(base + tc.bs + ":00Z")
		be := mustParse(base + tc.be + ":00Z")
		got := overlaps(as, ae, bs, be)
		if got != tc.want {
			t.Errorf("overlaps(%s-%s, %s-%s) = %v, want %v",
				tc.as, tc.ae, tc.bs, tc.be, got, tc.want)
		}
	}
}
