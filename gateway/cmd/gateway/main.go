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

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
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

	// Bootstrap initial superadmin if no admin users exist yet.
	bootstrapCtx, bootstrapCancel := context.WithTimeout(context.Background(), 10*time.Second)
	admin.Bootstrap(bootstrapCtx, pool, cfg.AdminInitialEmail, cfg.AdminInitialPassword)
	bootstrapCancel()

	ai := aiclient.New(cfg.AIServiceURL)

	// Admin handlers.
	adminAuthH := &handlers.AdminAuthHandler{Pool: pool}
	adminStatsH := &handlers.AdminStatsHandler{Pool: pool}
	adminContactsH := &handlers.AdminContactsHandler{Pool: pool}
	adminChatH := &handlers.AdminChatHandler{Pool: pool}
	adminNewsletterH := &handlers.AdminNewsletterHandler{Pool: pool}
	adminAuditH := &handlers.AdminAuditHandler{Pool: pool}
	adminContentH := &handlers.AdminContentHandler{Pool: pool}

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
		r.With(httprate.LimitByIP(10, time.Minute)).Get("/voice", (&handlers.VoiceHandler{Pool: pool, AIServiceURL: cfg.AIServiceURL, CookieSecure: cfg.CookieSecure}).ServeHTTP)
	})

	// Admin API — /admin/* routes to gateway (see k8s/40-ingress.yaml).
	r.Route("/admin", func(r chi.Router) {
		// Login: rate-limited to prevent brute-force §164.312(d).
		r.With(httprate.LimitByIP(5, time.Minute)).Post("/auth/login", adminAuthH.Login)

		// All other admin routes require a valid session token.
		r.Group(func(r chi.Router) {
			r.Use(appmw.RequireAdmin(pool))

			r.Post("/auth/logout", adminAuthH.Logout)
			r.Get("/auth/me", adminAuthH.Me)

			r.Get("/stats", adminStatsH.ServeHTTP)

			// PHI: contacts (access logged on detail view §164.312(b)).
			r.Get("/contacts", adminContactsH.List)
			r.Get("/contacts/{id}", adminContactsH.Get)

			// PHI: chat sessions (access logged on detail view).
			r.Get("/chat/sessions", adminChatH.ListSessions)
			r.Get("/chat/sessions/{id}", adminChatH.GetSession)

			// Newsletter.
			r.Get("/newsletter", adminNewsletterH.List)
			r.Delete("/newsletter/{id}", adminNewsletterH.Unsubscribe)
			r.Post("/newsletter/{id}/request-deletion", adminNewsletterH.RequestDeletion)

			// Superadmin-only: audit logs, purge, content management.
			r.Group(func(r chi.Router) {
				r.Use(appmw.RequireSuperadmin(pool))

				r.Get("/audit/phi", adminAuditH.PHIAuditLog)
				r.Get("/audit/access", adminAuditH.AdminAccessLog)
				r.Get("/audit/purge-queue", adminAuditH.PurgeQueue)
				r.Post("/audit/purge/contact/{id}", adminAuditH.PurgeContact)
				r.Post("/audit/purge/chat/{id}", adminAuditH.PurgeChat)

				r.Get("/content/faqs", adminContentH.ListFAQs)
				r.Post("/content/faqs", adminContentH.CreateFAQ)
				r.Put("/content/faqs/{id}", adminContentH.UpdateFAQ)
				r.Delete("/content/faqs/{id}", adminContentH.DeleteFAQ)

				r.Get("/content/blog", adminContentH.ListBlogPosts)
				r.Get("/content/blog/{id}", adminContentH.GetBlogPost)
				r.Post("/content/blog", adminContentH.CreateBlogPost)
				r.Put("/content/blog/{id}", adminContentH.UpdateBlogPost)
				r.Delete("/content/blog/{id}", adminContentH.DeleteBlogPost)

				r.Get("/content/settings", adminContentH.GetSettings)
				r.Put("/content/settings", adminContentH.UpdateSettings)

				r.Get("/content/team/groups", adminContentH.ListTeamGroups)
				r.Get("/content/team/members", adminContentH.ListTeamMembers)
				r.Post("/content/team/members", adminContentH.CreateTeamMember)
				r.Put("/content/team/members/{id}", adminContentH.UpdateTeamMember)
				r.Delete("/content/team/members/{id}", adminContentH.DeleteTeamMember)

				r.Get("/content/services", adminContentH.ListServices)
				r.Post("/content/services", adminContentH.CreateService)
				r.Put("/content/services/{id}", adminContentH.UpdateService)
				r.Delete("/content/services/{id}", adminContentH.DeleteService)

				r.Get("/content/testimonials", adminContentH.ListTestimonials)
				r.Post("/content/testimonials", adminContentH.CreateTestimonial)
				r.Put("/content/testimonials/{id}", adminContentH.UpdateTestimonial)
				r.Delete("/content/testimonials/{id}", adminContentH.DeleteTestimonial)

				r.Get("/content/locations", adminContentH.ListLocations)
				r.Post("/content/locations", func(w http.ResponseWriter, r *http.Request) { adminContentH.UpsertLocation(w, r) })
				r.Put("/content/locations/{id}", adminContentH.UpsertLocation)
				r.Delete("/content/locations/{id}", adminContentH.DeleteLocation)

				r.Get("/content/nav", adminContentH.ListNavItems)
				r.Post("/content/nav", func(w http.ResponseWriter, r *http.Request) { adminContentH.UpsertNavItem(w, r) })
				r.Put("/content/nav/{id}", adminContentH.UpsertNavItem)
				r.Delete("/content/nav/{id}", adminContentH.DeleteNavItem)

				r.Get("/content/stats", adminContentH.ListStats)
				r.Put("/content/stats/{id}", adminContentH.UpdateStat)
			})
		})
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
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
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
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
