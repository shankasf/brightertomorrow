package match

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed seed_clinicians.json
var seedCliniciansJSON []byte

// DefaultClinicians is the starter roster loaded from the embedded JSON.
// The store's AutoSeed / ForceSeed methods use this.
var DefaultClinicians = mustLoadClinicians()

func mustLoadClinicians() []Clinician {
	var cs []Clinician
	if err := json.Unmarshal(seedCliniciansJSON, &cs); err != nil {
		panic(fmt.Sprintf("match: seed_clinicians.json parse failed: %v", err))
	}
	for i := range cs {
		normalizeClinician(&cs[i])
	}
	return cs
}
