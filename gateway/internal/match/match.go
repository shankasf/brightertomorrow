package match

import (
	"fmt"
	"sort"
	"strings"
)

// Match is the pure matching function — no IO, fully unit-testable.
//
// Algorithm (port of therapist-match.html showResults):
//  1. Keep clinician if answers.type ∈ clinician.types.
//  2. If modality=="telehealth": clinician.telehealth must be true.
//  3. If modality=="in-person" and location is non-empty: location ∈ clinician.locations.
//  4. If insurance=="in-network": clinician.in_network must be true.
//  5. No constraint for modality=="either", insurance=="private-pay"/"no-pref", or empty location.
//
// Input clinicians need not be pre-filtered — inactive clinicians are skipped.
// Results are sorted by sort_order ascending. cfg is accepted for future
// data-driven taxonomy extensions but is unused by the core filter today.
func Match(answers MatchAnswers, clinicians []Clinician, _ *MatchConfig) []Result {
	results := make([]Result, 0, len(clinicians))

	for _, c := range clinicians {
		if !c.Active {
			continue
		}
		if !hasType(c.Types, answers.Type) {
			continue
		}
		if answers.Modality == "telehealth" && !c.Telehealth {
			continue
		}
		if answers.Modality == "in-person" && answers.Location != "" {
			if !hasLocation(c.Locations, answers.Location) {
				continue
			}
		}
		if answers.Insurance == "in-network" && !c.InNetwork {
			continue
		}
		results = append(results, Result{
			Clinician:   c,
			MatchReason: buildReason(answers, c),
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].SortOrder < results[j].SortOrder
	})
	return results
}

// hasType reports whether the clinician's type list contains the given type.
// Empty needle is a no-pref pass-through (returns true always).
func hasType(types []string, needle string) bool {
	if needle == "" {
		return true
	}
	needle = strings.ToLower(strings.TrimSpace(needle))
	for _, t := range types {
		if strings.EqualFold(t, needle) {
			return true
		}
	}
	return false
}

// hasLocation reports whether the clinician's location list contains the given location.
// Empty needle is treated as no-constraint (returns true).
func hasLocation(locations []string, needle string) bool {
	if needle == "" {
		return true
	}
	needle = strings.ToLower(strings.TrimSpace(needle))
	for _, l := range locations {
		if strings.EqualFold(l, needle) {
			return true
		}
	}
	return false
}

// buildReason returns a short human-readable summary of why this clinician matched.
func buildReason(a MatchAnswers, c Clinician) string {
	parts := make([]string, 0, 3)

	// Modality
	switch a.Modality {
	case "telehealth":
		parts = append(parts, "Available via telehealth")
	case "in-person":
		if a.Location != "" {
			parts = append(parts, fmt.Sprintf("In-person at %s", labelLocation(a.Location)))
		} else {
			parts = append(parts, "In-person sessions available")
		}
	case "either":
		if c.Telehealth {
			parts = append(parts, "Telehealth and in-person available")
		}
	}

	// Insurance
	switch a.Insurance {
	case "in-network":
		parts = append(parts, "Accepts in-network insurance")
	case "private-pay":
		parts = append(parts, "Private pay welcome")
	}

	if len(parts) == 0 {
		return "Available and accepting new clients"
	}
	return strings.Join(parts, " · ")
}

func labelLocation(loc string) string {
	switch loc {
	case "e-russell":
		return "East Russell Road"
	case "n-durango":
		return "North Durango Drive"
	default:
		return loc
	}
}
