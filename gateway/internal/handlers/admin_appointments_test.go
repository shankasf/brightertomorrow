package handlers

import "testing"

// TestApplyWorkflowFilter verifies the three modes of the workflow_status filter:
//
//   - empty raw → archived rows are excluded; all others are included.
//   - "all"     → every row is returned.
//   - specific value → only rows whose effective status matches are returned.
func TestApplyWorkflowFilter(t *testing.T) {
	rows := []appointmentRow{
		{SubmissionUUID: "a", WorkflowStatus: "new"},
		{SubmissionUUID: "b", WorkflowStatus: "approved"},
		{SubmissionUUID: "c", WorkflowStatus: "archived"},
		{SubmissionUUID: "d", WorkflowStatus: ""},      // no attribute → effective "new"
		{SubmissionUUID: "e", WorkflowStatus: "cancelled"},
	}

	tests := []struct {
		name    string
		filter  workflowStatusFilter
		wantIDs []string
	}{
		{
			name:    "empty (default) excludes archived",
			filter:  workflowStatusFilter{raw: ""},
			wantIDs: []string{"a", "b", "d", "e"},
		},
		{
			name:    "all includes archived",
			filter:  workflowStatusFilter{raw: "all"},
			wantIDs: []string{"a", "b", "c", "d", "e"},
		},
		{
			name:    "specific value: approved",
			filter:  workflowStatusFilter{raw: "approved"},
			wantIDs: []string{"b"},
		},
		{
			name:    "specific value: archived",
			filter:  workflowStatusFilter{raw: "archived"},
			wantIDs: []string{"c"},
		},
		{
			name:    "specific value: new (includes empty-attribute rows)",
			filter:  workflowStatusFilter{raw: "new"},
			wantIDs: []string{"a", "d"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// applyWorkflowFilter mutates the slice backing array; copy first.
			in := make([]appointmentRow, len(rows))
			copy(in, rows)

			got := applyWorkflowFilter(in, tc.filter)

			if len(got) != len(tc.wantIDs) {
				t.Fatalf("len = %d, want %d; got IDs: %v", len(got), len(tc.wantIDs), ids(got))
			}
			for i, row := range got {
				if row.SubmissionUUID != tc.wantIDs[i] {
					t.Errorf("[%d] got %q, want %q", i, row.SubmissionUUID, tc.wantIDs[i])
				}
			}
		})
	}
}

func ids(rows []appointmentRow) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.SubmissionUUID
	}
	return out
}
