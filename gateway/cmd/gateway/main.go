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

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/aiclient"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/config"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/db"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/handlers"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
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

	// Initialise AWS SDK v2 + PHI store. Standard env-var credentials
	// (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY) are picked up automatically.
	awsCfg, err := awsconfig.LoadDefaultConfig(
		context.Background(),
		awsconfig.WithRegion(cfg.AWSRegion),
	)
	if err != nil {
		slog.Error("aws config load failed", "err", err)
		os.Exit(1)
	}
	ddbClient := dynamodb.NewFromConfig(awsCfg)

	phiStore, err := phi.New(phi.Config{
		DDB:       ddbClient,
		TableName: cfg.DDBTable,
		Timeout:   3 * time.Second,
	})
	if err != nil {
		slog.Error("phi store init failed", "err", err)
		os.Exit(1)
	}

	// Bootstrap initial superadmin if no admin users exist yet.
	bootstrapCtx, bootstrapCancel := context.WithTimeout(context.Background(), 10*time.Second)
	admin.Bootstrap(bootstrapCtx, pool, cfg.AdminInitialEmail, cfg.AdminInitialPassword)
	bootstrapCancel()

	ai := aiclient.New(cfg.AIServiceURL)

	// Admin handlers.
	var cognitoVerifier *admin.CognitoVerifier
	if cfg.CognitoUserPoolID != "" && cfg.CognitoClientID != "" {
		cognitoVerifier = admin.NewCognitoVerifier(cfg.AWSRegion, cfg.CognitoUserPoolID, cfg.CognitoClientID)
		slog.Info("admin Cognito verifier enabled", "pool", cfg.CognitoUserPoolID)
	} else {
		slog.Warn("admin Cognito verifier disabled — COGNITO_USER_POOL_ID/COGNITO_CLIENT_ID not set")
	}
	adminAuthH := &handlers.AdminAuthHandler{Pool: pool, Cognito: cognitoVerifier}
	adminStatsH := &handlers.AdminStatsHandler{Pool: pool}
	adminContactsH := &handlers.AdminContactsHandler{Pool: pool, PHI: phiStore}
	adminChatH := &handlers.AdminChatHandler{Pool: pool}
	adminNewsletterH := &handlers.AdminNewsletterHandler{Pool: pool}
	adminAuditH := &handlers.AdminAuditHandler{Pool: pool}
	adminContentH := &handlers.AdminContentHandler{Pool: pool, AIClient: ai}
	adminAppointmentsH := &handlers.AdminAppointmentsHandler{Pool: pool, PHI: phiStore}
	adminInsuranceChecksH := &handlers.AdminInsuranceChecksHandler{Pool: pool, PHI: phiStore}

	intakeH := &handlers.IntakeHandler{Pool: pool, PHI: phiStore, CoverageChecker: ai}
	intakeInternalH := &handlers.IntakeInternalHandler{IntakeHandler: intakeH}

	readyzH := &handlers.ReadyzHandler{Pool: pool, PHI: phiStore}

	r := chi.NewRouter()

	// Global middleware.
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(appmw.Recoverer)
	r.Use(appmw.Logger)
	r.Use(corsMiddleware(cfg.CORSOrigins))

	// Health probes.
	r.Get("/healthz", handlers.Health)
	r.Get("/readyz", readyzH.ServeHTTP)

	// API v1.
	r.Route("/v1", func(r chi.Router) {
		r.Get("/faqs", (&handlers.FAQsHandler{Pool: pool}).ServeHTTP)
		r.With(httprate.LimitByIP(10, time.Minute)).Post("/contact", (&handlers.ContactHandler{Pool: pool}).ServeHTTP)
		r.With(httprate.LimitByIP(10, time.Minute)).Post("/intake", intakeH.ServeHTTP)
		r.With(httprate.LimitByIP(10, time.Minute)).Post("/newsletter", (&handlers.NewsletterHandler{Pool: pool}).ServeHTTP)
		r.With(httprate.LimitByIP(30, time.Minute)).Post("/chat", (&handlers.ChatHandler{Pool: pool, AIClient: ai, CookieSecure: cfg.CookieSecure}).ServeHTTP)
		r.With(httprate.LimitByIP(30, time.Minute)).Post("/chat/stream", (&handlers.ChatStreamHandler{Pool: pool, AIClient: ai, CookieSecure: cfg.CookieSecure}).ServeHTTP)
		r.With(httprate.LimitByIP(10, time.Minute)).Get("/voice", (&handlers.VoiceHandler{Pool: pool, AIServiceURL: cfg.AIServiceURL, CookieSecure: cfg.CookieSecure}).ServeHTTP)
	})

	// Internal routes — cluster-internal callers only (the bt-ai pod).
	// IMPORTANT: /internal/* MUST NOT be added to k8s/40-ingress.yaml.
	// Traefik does not route /internal/*, so these endpoints are only
	// reachable from inside the bt namespace. That network boundary is
	// the auth boundary; do not expose without adding signature auth.
	r.Route("/internal", func(r chi.Router) {
		r.Post("/intake/submit", intakeInternalH.ServeHTTP)
	})

	// Admin API — /admin/api/* routes to gateway (see k8s/40-ingress.yaml).
	// Page paths under /admin/* (without /api) are served by Next.js.
	r.Route("/admin/api", func(r chi.Router) {
		// Login: rate-limited to prevent brute-force §164.312(d).
		// Legacy bcrypt path (kept for emergency rollback; UI no longer uses it).
		r.With(httprate.LimitByIP(5, time.Minute)).Post("/auth/login", adminAuthH.Login)
		// Cognito ID-token exchange — primary login path. Cognito enforces password + MFA;
		// gateway verifies the JWT and issues its own session token.
		r.With(httprate.LimitByIP(10, time.Minute)).Post("/auth/exchange", adminAuthH.Exchange)

		// All other admin routes require a valid session token.
		r.Group(func(r chi.Router) {
			r.Use(appmw.RequireAdmin(pool))

			r.Post("/auth/logout", adminAuthH.Logout)
			r.Get("/auth/me", adminAuthH.Me)

			r.Get("/stats", adminStatsH.ServeHTTP)

			// PHI: contacts (access logged on detail view §164.312(b)).
			r.Get("/contacts", adminContactsH.List)
			r.Get("/contacts/{id}", adminContactsH.Get)

			// PHI: intake pointers + DDB-backed full records.
			r.Get("/intake-pointers", adminContactsH.ListIntakePointers)
			r.Get("/intake-pointers/{id}", adminContactsH.GetIntakePointer)

			// PHI: appointment requests (intake_pointers + DDB hydrated).
			// List + CSV export both audit each row read in admin_access_log.
			r.Get("/appointments", adminAppointmentsH.List)
			r.Get("/appointments.csv", adminAppointmentsH.ExportCSV)

			// PHI: insurance eligibility-check history.
			// Same audit pattern: every PHI row hydrated is logged.
			r.Get("/insurance-checks", adminInsuranceChecksH.List)
			r.Get("/insurance-checks.csv", adminInsuranceChecksH.ExportCSV)

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
