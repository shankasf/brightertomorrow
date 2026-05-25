// appointment_lookup.go — GSI query for appointment lookup by phone hash.
//
// The byPhoneHash GSI on bt-main allows the AI voice agent to look up a
// patient's upcoming appointment by phone number without a full-table scan
// and without requiring an email address upfront.
//
// HIPAA: this file does no PHI logging.  The handler layer is responsible for
// firing the audit row and for enforcing the DOB second-factor gate before
// revealing any appointment details.
package phi

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

const byPhoneHashIndex = "byPhoneHash"

// LookupActiveAppointmentsByPhoneHash queries the byPhoneHash GSI and returns
// up to 10 records sorted by appointmentTime descending (most recent first).
// Returns an empty slice — never an error — when no records exist.
func (s *Store) LookupActiveAppointmentsByPhoneHash(ctx context.Context, phoneHash string) ([]IntakeRecord, error) {
	if phoneHash == "" {
		return []IntakeRecord{}, nil
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.tableName),
		IndexName:              aws.String(byPhoneHashIndex),
		KeyConditionExpression: aws.String("phoneHash = :ph"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":ph": &ddbtypes.AttributeValueMemberS{Value: phoneHash},
		},
		ScanIndexForward: aws.Bool(false), // most recent appointmentTime first
		Limit:            aws.Int32(10),
	})
	if err != nil {
		return nil, fmt.Errorf("phi: lookup by phone hash: %w", err)
	}

	records := make([]IntakeRecord, 0, len(out.Items))
	for _, it := range out.Items {
		var rec IntakeRecord
		if err := attributevalue.UnmarshalMap(it, &rec); err != nil {
			return nil, fmt.Errorf("phi: unmarshal intake (phone lookup): %w", err)
		}
		records = append(records, rec)
	}
	return records, nil
}
