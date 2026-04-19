package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/aiclient"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/config"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/db"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/handlers"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/httprate"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("config load failed", "err", err)
		os.Exit(1)
	}

	setupLogger(cfg.LogLevel)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	pool, err := db.New(ctx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		slog.Error("db init failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	ai := aiclient.New(cfg.AIServiceURL)

	r := chi.NewRouter()

	// Global middleware.
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(appmw.Recoverer)
	r.Use(appmw.Logger)
	r.Use(corsMiddleware(cfg.CORSOrigins))

	// Health probes.
	r.Get("/healthz", handlers.Health)
	r.Get("/readyz", (&handlers.ReadyzHandler{Pool: pool}).ServeHTTP)

	// API v1.
	r.Route("/v1", func(r chi.Router) {
		r.Get("/faqs", (&handlers.FAQsHandler{Pool: pool}).ServeHTTP)
		r.With(httprate.LimitByIP(10, time.Minute)).Post("/contact", (&handlers.ContactHandler{Pool: pool}).ServeHTTP)
		r.With(httprate.LimitByIP(10, time.Minute)).Post("/newsletter", (&handlers.NewsletterHandler{Pool: pool}).ServeHTTP)
		r.With(httprate.LimitByIP(30, time.Minute)).Post("/chat", (&handlers.ChatHandler{Pool: pool, AIClient: ai, CookieSecure: cfg.CookieSecure}).ServeHTTP)
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Start in a goroutine so we can listen for shutdown signals.
	serverErr := make(chan error, 1)
	go func() {
		slog.Info("gateway starting", "addr", srv.Addr)
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
		close(serverErr)
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serverErr:
		slog.Error("server error", "err", err)
		os.Exit(1)
	case sig := <-quit:
		slog.Info("shutdown signal received", "signal", sig)
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "err", err)
		os.Exit(1)
	}

	slog.Info("gateway stopped")
}

// corsMiddleware returns a simple CORS middleware that allows the configured origins.
func corsMiddleware(allowed []string) func(http.Handler) http.Handler {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, o := range allowed {
		allowedSet[strings.ToLower(o)] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if _, ok := allowedSet[strings.ToLower(origin)]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
				w.Header().Set("Vary", "Origin")
			}

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func setupLogger(level string) {
	var l slog.Level
	switch strings.ToLower(level) {
	case "debug":
		l = slog.LevelDebug
	case "warn", "warning":
		l = slog.LevelWarn
	case "error":
		l = slog.LevelError
	default:
		l = slog.LevelInfo
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: l})))
}
