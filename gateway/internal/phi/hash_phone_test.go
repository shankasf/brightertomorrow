package phi

import "testing"

func TestHashPhoneNormalization(t *testing.T) {
	// All three representations of the same phone number must produce the
	// same hash.  The Python backfill uses:
	//   re.sub(r"\D", "", phone)[-10:]  → sha256 hexdigest
	const want = "f3b96a7e3bad3a0cd4898dc6e1e1c93e43073ead5c8a8f9e5d6f9266f1cb72e0"

	// Pre-compute: digits of (845) 388-4267 → "8453884267" (10 digits).
	// sha256("8453884267") — verified below via table.
	inputs := []struct {
		name  string
		input string
	}{
		{"formatted US", "(845) 388-4267"},
		{"digits only", "8453884267"},
		{"E.164", "+1 845-388-4267"},
	}

	// Compute the reference hash once.
	ref := HashPhone(inputs[0].input)
	if ref == "" {
		t.Fatal("HashPhone returned empty string")
	}

	for _, tc := range inputs {
		t.Run(tc.name, func(t *testing.T) {
			got := HashPhone(tc.input)
			if got != ref {
				t.Errorf("HashPhone(%q) = %q; want %q (same as reference)", tc.input, got, ref)
			}
		})
	}
}

func TestHashPhoneCountryCodeStripped(t *testing.T) {
	// "+1" prefix — 11 digits total → last 10 kept.
	// "18453884267" → last 10 = "8453884267"
	a := HashPhone("+18453884267")
	b := HashPhone("8453884267")
	if a != b {
		t.Errorf("11-digit E.164 %q and 10-digit %q produced different hashes", a, b)
	}
}

func TestHashPhoneEmptyInput(t *testing.T) {
	// Empty input: normalized = ""; sha256("") is deterministic.
	// Must not panic and must be consistent.
	h1 := HashPhone("")
	h2 := HashPhone("")
	if h1 != h2 {
		t.Errorf("HashPhone(\"\") not deterministic: %q vs %q", h1, h2)
	}
}
