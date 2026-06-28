// seed-clinicians upserts the default clinician roster and match config into
// the bt-main DynamoDB table. Safe to run multiple times (idempotent).
//
// Usage:
//
//	DDB_TABLE=bt-main AWS_REGION=us-east-1 go run ./cmd/seed-clinicians
//
// AWS credentials are read from the standard AWS SDK chain
// (env vars > ~/.aws/credentials > EC2/ECS metadata).
package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/match"
)

func main() {
	setupLogger()

	table := os.Getenv("DDB_TABLE")
	if table == "" {
		table = "bt-main"
	}
	region := os.Getenv("AWS_REGION")
	if region == "" {
		region = "us-east-1"
	}

	slog.Info("seed-clinicians starting", "table", table, "region", region)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		slog.Error("aws config load failed", "err", err)
		os.Exit(1)
	}
	ddbClient := dynamodb.NewFromConfig(awsCfg)

	store, err := match.NewStore(match.StoreConfig{
		DDB:       ddbClient,
		TableName: table,
		Timeout:   10 * time.Second,
	})
	if err != nil {
		slog.Error("match store init failed", "err", err)
		os.Exit(1)
	}

	slog.Info("upserting clinicians", "count", len(match.DefaultClinicians))
	if err := store.ForceSeed(ctx); err != nil {
		slog.Error("seed failed", "err", err)
		os.Exit(1)
	}

	slog.Info("seed-clinicians complete",
		"clinicians", len(match.DefaultClinicians),
	)
}

func setupLogger() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))
}
