package match

import (
	"testing"
)

// fixture builds a small clinician roster for tests.
var testRoster = []Clinician{
	{
		Slug:       "alice",
		Name:       "Alice",
		Types:      []string{"therapy"},
		Locations:  []string{"e-russell"},
		Telehealth: true,
		InNetwork:  true,
		Active:     true,
		SortOrder:  1,
	},
	{
		Slug:       "bob",
		Name:       "Bob",
		Types:      []string{"child", "teen"},
		Locations:  []string{"n-durango"},
		Telehealth: false,
		InNetwork:  true,
		Active:     true,
		SortOrder:  2,
	},
	{
		Slug:       "carol",
		Name:       "Carol",
		Types:      []string{"therapy", "couples"},
		Locations:  []string{"e-russell", "n-durango"},
		Telehealth: true,
		InNetwork:  false,
		Active:     true,
		SortOrder:  3,
	},
	{
		Slug:       "dave",
		Name:       "Dave",
		Types:      []string{"reiki"},
		Locations:  []string{"e-russell"},
		Telehealth: true,
		InNetwork:  true,
		Active:     false, // inactive — must always be excluded
		SortOrder:  4,
	},
}

func TestMatch_TypeFilter(t *testing.T) {
	results := Match(MatchAnswers{Type: "therapy"}, testRoster, nil)
	// alice (therapy) + carol (therapy,couples) should match; bob (child/teen) and dave (inactive) should not
	if len(results) != 2 {
		t.Fatalf("type=therapy: expected 2 results, got %d", len(results))
	}
	if results[0].Slug != "alice" || results[1].Slug != "carol" {
		t.Errorf("unexpected slugs: %v %v", results[0].Slug, results[1].Slug)
	}
}

func TestMatch_ChildType(t *testing.T) {
	results := Match(MatchAnswers{Type: "child"}, testRoster, nil)
	if len(results) != 1 || results[0].Slug != "bob" {
		t.Fatalf("type=child: expected bob only, got %v", slugs(results))
	}
}

func TestMatch_TelehealthFilter(t *testing.T) {
	// bob has telehealth=false; only alice and carol should match for therapy+telehealth
	results := Match(MatchAnswers{Type: "therapy", Modality: "telehealth"}, testRoster, nil)
	for _, r := range results {
		if !r.Telehealth {
			t.Errorf("telehealth filter: %s has telehealth=false", r.Slug)
		}
	}
	// dave is inactive so excluded; bob is wrong type
	if len(results) != 2 {
		t.Fatalf("telehealth: expected 2 results, got %d: %v", len(results), slugs(results))
	}
}

func TestMatch_InPersonAndLocation(t *testing.T) {
	results := Match(MatchAnswers{
		Type:     "therapy",
		Modality: "in-person",
		Location: "n-durango",
	}, testRoster, nil)
	// carol is the only therapy clinician with n-durango location
	if len(results) != 1 || results[0].Slug != "carol" {
		t.Fatalf("in-person n-durango: expected carol, got %v", slugs(results))
	}
}

func TestMatch_InPersonNoLocationConstraint(t *testing.T) {
	// in-person with empty location = no location filter applied
	results := Match(MatchAnswers{
		Type:     "therapy",
		Modality: "in-person",
		Location: "",
	}, testRoster, nil)
	// alice + carol both therapy; bob is child/teen
	if len(results) != 2 {
		t.Fatalf("in-person no location: expected 2, got %d: %v", len(results), slugs(results))
	}
}

func TestMatch_InNetworkFilter(t *testing.T) {
	results := Match(MatchAnswers{Type: "therapy", Insurance: "in-network"}, testRoster, nil)
	for _, r := range results {
		if !r.InNetwork {
			t.Errorf("in-network filter: %s has in_network=false", r.Slug)
		}
	}
	// carol has in_network=false, so only alice should remain
	if len(results) != 1 || results[0].Slug != "alice" {
		t.Fatalf("in-network: expected alice only, got %v", slugs(results))
	}
}

func TestMatch_EitherModalityPassThrough(t *testing.T) {
	// modality="either" should not filter on telehealth
	results := Match(MatchAnswers{Type: "therapy", Modality: "either"}, testRoster, nil)
	// alice + carol — both therapy, active; bob is wrong type, dave is inactive
	if len(results) != 2 {
		t.Fatalf("either modality: expected 2, got %d: %v", len(results), slugs(results))
	}
}

func TestMatch_NoPreferenceInsurance(t *testing.T) {
	// insurance="no-pref" should not filter on in_network
	results := Match(MatchAnswers{Type: "therapy", Insurance: "no-pref"}, testRoster, nil)
	if len(results) != 2 {
		t.Fatalf("no-pref insurance: expected 2, got %d: %v", len(results), slugs(results))
	}
}

func TestMatch_PrivatePayInsurance(t *testing.T) {
	// insurance="private-pay" should not filter on in_network (similar to no-pref)
	results := Match(MatchAnswers{Type: "therapy", Insurance: "private-pay"}, testRoster, nil)
	if len(results) != 2 {
		t.Fatalf("private-pay: expected 2, got %d: %v", len(results), slugs(results))
	}
}

func TestMatch_EmptyRoster(t *testing.T) {
	results := Match(MatchAnswers{Type: "therapy"}, []Clinician{}, nil)
	if len(results) != 0 {
		t.Fatalf("empty roster: expected 0, got %d", len(results))
	}
}

func TestMatch_InactiveExcluded(t *testing.T) {
	// dave (reiki) is inactive; even if type matches, must be excluded
	results := Match(MatchAnswers{Type: "reiki"}, testRoster, nil)
	if len(results) != 0 {
		t.Fatalf("inactive excluded: expected 0 for reiki (only dave, who is inactive), got %d: %v",
			len(results), slugs(results))
	}
}

func TestMatch_SortOrder(t *testing.T) {
	// All therapy active clinicians: alice(1) < carol(3)
	results := Match(MatchAnswers{Type: "therapy"}, testRoster, nil)
	for i := 1; i < len(results); i++ {
		if results[i-1].SortOrder >= results[i].SortOrder {
			t.Errorf("sort order violated at index %d: %d >= %d", i,
				results[i-1].SortOrder, results[i].SortOrder)
		}
	}
}

func TestMatch_ConfigIsNilSafe(t *testing.T) {
	// config=nil must not panic
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("Match panicked with nil config: %v", r)
		}
	}()
	Match(MatchAnswers{Type: "therapy"}, testRoster, nil)
}

// slugs extracts slugs for readable test failure messages.
func slugs(rs []Result) []string {
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = r.Slug
	}
	return out
}
