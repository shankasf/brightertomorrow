package match

import "time"

// DefaultConfig is the built-in quiz definition seeded on first boot.
// It mirrors the FLOW_BASE from the legacy therapist-match.html page.
// Admin can replace it via PUT /admin/api/match-config without a deploy.
var DefaultConfig = MatchConfig{
	IntroTitle:    "Find Your Therapist",
	IntroSubtitle: "Answer a few quick questions and we'll match you with the right fit.",
	UpdatedAt:     time.Time{}, // zero — will be set by store on first write
	Questions: []Question{
		{
			ID:       "type",
			Question: "Who are you looking for care for?",
			Sub:      "Select the option that best describes your situation.",
			Options: []QuestionOption{
				{Value: "therapy", Label: "For myself", Desc: "Individual therapy", Icon: "🧠"},
				{Value: "couples", Label: "For us as a couple", Desc: "Couples / relationship therapy", Icon: "💑"},
				{Value: "child", Label: "For my child", Desc: "Child therapy (under 12)", Icon: "🧒"},
				{Value: "teen", Label: "For my teenager", Desc: "Teen therapy (12–17)", Icon: "🎒"},
				{Value: "reiki", Label: "Reiki / holistic wellness", Desc: "Energy healing + mind-body work", Icon: "✨"},
			},
		},
		{
			ID:       "modality",
			Question: "How would you like to meet?",
			Sub:      "We offer both online and in-person sessions.",
			Options: []QuestionOption{
				{Value: "telehealth", Label: "Online (telehealth)", Desc: "Video sessions from anywhere", Icon: "💻"},
				{Value: "in-person", Label: "In-person", Desc: "At one of our Las Vegas offices", Icon: "🏢"},
				{Value: "either", Label: "Either works for me", Desc: "I'm flexible", Icon: "🔄"},
			},
		},
		{
			ID:           "location",
			Question:     "Which office location works best for you?",
			Sub:          "Both are in the Las Vegas metro area.",
			InPersonOnly: true,
			Options: []QuestionOption{
				{Value: "e-russell", Label: "East Russell Road", Desc: "Henderson / East Las Vegas", Icon: "📍"},
				{Value: "n-durango", Label: "North Durango Drive", Desc: "Northwest Las Vegas", Icon: "📍"},
			},
		},
		{
			ID:       "insurance",
			Question: "Will you be using insurance?",
			Sub:      "We accept most major commercial insurance plans.",
			Options: []QuestionOption{
				{Value: "in-network", Label: "Yes — in-network only", Desc: "Show me therapists who accept my plan", Icon: "🏥"},
				{Value: "private-pay", Label: "No — I'll pay out of pocket", Desc: "Self-pay / private-pay", Icon: "💳"},
				{Value: "no-pref", Label: "No preference", Desc: "Show me all available therapists", Icon: "🔍"},
			},
		},
	},
}
