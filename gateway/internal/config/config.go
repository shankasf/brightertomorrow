package config

import (
	"errors"
	"os"
	"strings"
)

// Config holds all runtime configuration for the gateway.
type Config struct {
	Port         string
	DatabaseURL  string
	AIServiceURL string
	LogLevel     string
	CORSOrigins  []string
}

var ErrMissingDatabaseURL = errors.New("config: DATABASE_URL is required")

// Load reads configuration from environment variables and applies defaults.
func Load() (*Config, error) {
	port := envOr("PORT", "8080")
	databaseURL := os.Getenv("DATABASE_URL")
	aiServiceURL := envOr("AI_SERVICE_URL", "http://127.0.0.1:8001")
	logLevel := envOr("LOG_LEVEL", "info")
	rawOrigins := envOr("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001")

	if databaseURL == "" {
		return nil, ErrMissingDatabaseURL
	}

	origins := splitTrimmed(rawOrigins, ",")

	return &Config{
		Port:         port,
		DatabaseURL:  databaseURL,
		AIServiceURL: aiServiceURL,
		LogLevel:     logLevel,
		CORSOrigins:  origins,
	}, nil
}

func envOr(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func splitTrimmed(s, sep string) []string {
	parts := strings.Split(s, sep)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
