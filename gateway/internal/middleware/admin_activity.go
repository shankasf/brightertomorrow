package middleware

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// clientIP strips the port from r.RemoteAddr so it can be cast to Postgres
// inet. RemoteAddr is "host:port" (e.g. "10.42.0.112:53406") which inet
// rejects. RealIP middleware can also rewrite RemoteAddr to a bare IP
// (no port) from X-Forwarded-For — handle both forms.
func clientIP(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}

// statusRecorder wraps http.ResponseWriter to capture the written status code.
// Proxies Flush so SSE handlers under this middleware (e.g. /admin/api/logs/ai)
// can still flush events. Hijacker is intentionally NOT proxied — no admin
// route upgrades to a raw TCP connection (WebSocket admin proxies sit on
// other middleware chains).
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (sr *statusRecorder) WriteHeader(code int) {
	sr.status = code
	sr.ResponseWriter.WriteHeader(code)
}

// Flush is needed because the SSE admin log stream lives under this
// middleware. Without proxying, the handler's `w.(http.Flusher)` check
// returns false and we 500 before sending any bytes.
func (sr *statusRecorder) Flush() {
	if f, ok := sr.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// LogAdminActivity is middleware that records every authenticated admin API
// call to DynamoDB bt-main (async, post-response) and emits a structured
// slog event for CloudWatch.
//
// Now writes to DDB via phi.Store.PutAccessAudit — the Hostinger Postgres
// bt.admin_access_log table has been dropped (project_hostinger_not_hipaa).
//
// Must be installed after RequireAdmin so AdminFromContext is populated.
// Requests where AdminFromContext returns ok=false are silently skipped.
func LogAdminActivity(store *phi.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, ok := AdminFromContext(r.Context())
			if !ok {
				// Defense-in-depth: if RequireAdmin hasn't run, pass through
				// but never write an audit row with a missing identity.
				next.ServeHTTP(w, r)
				return
			}

			start := time.Now()
			sr := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(sr, r)
			elapsed := time.Since(start)

			path := r.URL.Path
			method := r.Method
			status := sr.status

			// routePattern is the chi-matched template (e.g. /admin/api/contacts/{id}).
			// Using the template rather than the actual path keeps the slog event
			// analytics-friendly and avoids any ambiguity about what's in the path.
			routePattern := chi.RouteContext(r.Context()).RoutePattern()
			if routePattern == "" {
				routePattern = path
			}

			action, resourceType, resourceID := deriveAction(method, path)

			// HIPAA §164.502(b) minimum-necessary: the details column MUST NOT
			// contain the raw query string (which may carry PHI like q=, email=,
			// name= search terms). Store only method, path_template, status and
			// duration — no query string, no request body, no response body.
			type detailsShape struct {
				Method       string `json:"method"`
				PathTemplate string `json:"path_template"`
				Status       int    `json:"status"`
				DurationMS   int64  `json:"duration_ms"`
			}
			detailsJSON, _ := json.Marshal(detailsShape{
				Method:       method,
				PathTemplate: routePattern,
				Status:       status,
				DurationMS:   elapsed.Milliseconds(),
			})

			ipAddr := clientIP(r.RemoteAddr)

			// Truncate user-agent to 500 chars to stay within the column constraint
			// and avoid persisting unexpectedly large strings.
			ua := r.UserAgent()
			if len(ua) > 500 {
				ua = ua[:500]
			}

			// --- skip list ---
			// Emit slog for ops visibility regardless of whether we write to DB.
			slog.Info("admin_activity",
				"action", action,
				"admin_email", u.Email,
				"ip", ipAddr,
				"method", method,
				"path_template", routePattern,
				"status", status,
				"duration_ms", elapsed.Milliseconds(),
				"resource_type", resourceType,
				"resource_id", resourceID,
			)

			if shouldSkipActivityLog(path) {
				return
			}

			// store == nil keeps unit tests and early-startup callers from
			// panicking if the middleware is wired before phi.Store is ready.
			if store == nil {
				return
			}

			// Write the DDB row asynchronously so the response is never delayed.
			// Fresh background context; the request context is already done by
			// the time this goroutine runs.
			adminID := u.ID
			adminEmail := u.Email
			rec := phi.AccessAuditRecord{
				AuditID:      uuid.NewString(),
				AdminUserID:  adminID,
				AdminEmail:   adminEmail,
				Action:       action,
				ResourceType: resourceType,
				ResourceID:   resourceID,
				IPAddress:    ipAddr,
				UserAgent:    ua,
				Details:      string(detailsJSON),
				CreatedAt:    time.Now().UTC(),
				RetainUntil:  time.Now().UTC().AddDate(10, 0, 0),
			}
			go func() {
				defer func() {
					if rcv := recover(); rcv != nil {
						slog.Error("admin_activity: panic in audit goroutine", "recovered", rcv)
					}
				}()
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if err := store.PutAccessAudit(ctx, rec); err != nil {
					slog.Error("admin_activity: ddb put failed",
						"err", err, "action", action, "admin_email", adminEmail)
				}
			}()
		})
	}
}

// shouldSkipActivityLog returns true for paths we deliberately exclude from
// the DB activity log to avoid noise. slog is always emitted regardless.
func shouldSkipActivityLog(path string) bool {
	// Auth paths — login/exchange have their own auth-event story; /me is
	// polled on every page navigation and would flood the log.
	if strings.HasPrefix(path, "/admin/api/auth/") {
		return true
	}
	// Stats endpoint is polled every few seconds by the dashboard — too chatty.
	if path == "/admin/api/stats" {
		return true
	}
	// Nav notification badges — polled on a timer, aggregate counts only (no
	// PHI), so the read carries no audit value and would otherwise flood the log.
	if strings.HasPrefix(path, "/admin/api/notifications/") {
		return true
	}
	return false
}

// actionEntry is a static rule matched against method + path prefix/exact.
type actionEntry struct {
	method       string
	pathPrefix   string
	pathSuffix   string // non-empty means exact suffix match on path
	action       string
	resourceType string
}

// staticActions is consulted in order; first match wins.
var staticActions = []actionEntry{
	// Appointments.
	{method: "GET", pathSuffix: "/admin/api/appointments.csv", action: "export_appointments_csv", resourceType: "appointments"},
	{method: "GET", pathPrefix: "/admin/api/appointments", action: "view_appointments_list", resourceType: "appointments"},
	{method: "POST", pathSuffix: "/admin/api/appointments/status", action: "update_appointment_status", resourceType: "appointments"},

	// Insurance checks.
	{method: "GET", pathSuffix: "/admin/api/insurance-checks.csv", action: "export_insurance_checks_csv", resourceType: "insurance_checks"},
	{method: "GET", pathPrefix: "/admin/api/insurance-checks", action: "view_insurance_checks_list", resourceType: "insurance_checks"},

	// Contacts.
	{method: "GET", pathPrefix: "/admin/api/contacts/", action: "view_contact", resourceType: "contacts"},
	{method: "GET", pathSuffix: "/admin/api/contacts", action: "view_contacts_list", resourceType: "contacts"},

	// Intake pointers.
	{method: "GET", pathPrefix: "/admin/api/intake-pointers/", action: "view_intake_pointer", resourceType: "intake_pointers"},
	{method: "GET", pathSuffix: "/admin/api/intake-pointers", action: "view_intake_pointers_list", resourceType: "intake_pointers"},

	// Chat sessions.
	{method: "GET", pathPrefix: "/admin/api/chat/sessions/", action: "view_chat_session", resourceType: "chat_sessions"},
	{method: "GET", pathSuffix: "/admin/api/chat/sessions", action: "view_chat_sessions_list", resourceType: "chat_sessions"},

	// Callbacks.
	{method: "GET", pathSuffix: "/admin/api/callbacks", action: "view_callbacks_list", resourceType: "callbacks"},

	// Newsletter.
	{method: "GET", pathSuffix: "/admin/api/newsletter", action: "view_newsletter_list", resourceType: "newsletter"},
	{method: "DELETE", pathPrefix: "/admin/api/newsletter/", action: "unsubscribe_newsletter", resourceType: "newsletter"},
	{method: "POST", pathPrefix: "/admin/api/newsletter/", pathSuffix: "/request-deletion", action: "request_newsletter_deletion", resourceType: "newsletter"},

	// Audit logs.
	{method: "GET", pathSuffix: "/admin/api/audit/phi", action: "view_phi_audit_log", resourceType: "audit_phi"},
	{method: "GET", pathSuffix: "/admin/api/audit/access", action: "view_activity_log", resourceType: "activity_log"},
	{method: "GET", pathSuffix: "/admin/api/audit/purge-queue", action: "view_purge_queue", resourceType: "audit_phi"},
	{method: "POST", pathPrefix: "/admin/api/audit/purge/contact/", action: "purge_contact", resourceType: "purge"},
	{method: "POST", pathPrefix: "/admin/api/audit/purge/chat/", action: "purge_chat", resourceType: "purge"},

	// Content: FAQs.
	{method: "GET", pathSuffix: "/admin/api/content/faqs", action: "view_faqs_list", resourceType: "faqs"},
	{method: "POST", pathSuffix: "/admin/api/content/faqs", action: "create_faq", resourceType: "faqs"},
	{method: "PUT", pathPrefix: "/admin/api/content/faqs/", action: "update_faq", resourceType: "faqs"},
	{method: "DELETE", pathPrefix: "/admin/api/content/faqs/", action: "delete_faq", resourceType: "faqs"},

	// Content: Blog.
	{method: "GET", pathSuffix: "/admin/api/content/blog", action: "view_blog_list", resourceType: "blog_posts"},
	{method: "GET", pathPrefix: "/admin/api/content/blog/", action: "view_blog_post", resourceType: "blog_posts"},
	{method: "POST", pathSuffix: "/admin/api/content/blog", action: "create_blog_post", resourceType: "blog_posts"},
	{method: "PUT", pathPrefix: "/admin/api/content/blog/", action: "update_blog_post", resourceType: "blog_posts"},
	{method: "DELETE", pathPrefix: "/admin/api/content/blog/", action: "delete_blog_post", resourceType: "blog_posts"},

	// Content: Settings.
	{method: "GET", pathSuffix: "/admin/api/content/settings", action: "view_settings", resourceType: "settings"},
	{method: "PUT", pathSuffix: "/admin/api/content/settings", action: "update_settings", resourceType: "settings"},

	// Content: Services.
	{method: "GET", pathSuffix: "/admin/api/content/services", action: "view_services_list", resourceType: "services"},
	{method: "POST", pathSuffix: "/admin/api/content/services", action: "create_service", resourceType: "services"},
	{method: "PUT", pathPrefix: "/admin/api/content/services/", action: "update_service", resourceType: "services"},
	{method: "DELETE", pathPrefix: "/admin/api/content/services/", action: "delete_service", resourceType: "services"},

	// Content: Testimonials.
	{method: "GET", pathSuffix: "/admin/api/content/testimonials", action: "view_testimonials_list", resourceType: "testimonials"},
	{method: "POST", pathSuffix: "/admin/api/content/testimonials", action: "create_testimonial", resourceType: "testimonials"},
	{method: "PUT", pathPrefix: "/admin/api/content/testimonials/", action: "update_testimonial", resourceType: "testimonials"},
	{method: "DELETE", pathPrefix: "/admin/api/content/testimonials/", action: "delete_testimonial", resourceType: "testimonials"},

	// Content: Locations.
	{method: "GET", pathSuffix: "/admin/api/content/locations", action: "view_locations_list", resourceType: "locations"},
	{method: "POST", pathSuffix: "/admin/api/content/locations", action: "create_location", resourceType: "locations"},
	{method: "PUT", pathPrefix: "/admin/api/content/locations/", action: "update_location", resourceType: "locations"},
	{method: "DELETE", pathPrefix: "/admin/api/content/locations/", action: "delete_location", resourceType: "locations"},

	// Content: Nav.
	{method: "GET", pathSuffix: "/admin/api/content/nav", action: "view_nav_list", resourceType: "nav"},
	{method: "POST", pathSuffix: "/admin/api/content/nav", action: "create_nav_item", resourceType: "nav"},
	{method: "PUT", pathPrefix: "/admin/api/content/nav/", action: "update_nav_item", resourceType: "nav"},
	{method: "DELETE", pathPrefix: "/admin/api/content/nav/", action: "delete_nav_item", resourceType: "nav"},

	// Content: Stats.
	{method: "GET", pathSuffix: "/admin/api/content/stats", action: "view_stats_list", resourceType: "stats"},
	{method: "PUT", pathPrefix: "/admin/api/content/stats/", action: "update_stat", resourceType: "stats"},

	// Content: Team.
	{method: "GET", pathSuffix: "/admin/api/content/team/groups", action: "view_team_groups", resourceType: "team"},
	{method: "GET", pathSuffix: "/admin/api/content/team/members", action: "view_team_members", resourceType: "team"},
	{method: "POST", pathSuffix: "/admin/api/content/team/members", action: "create_team_member", resourceType: "team"},
	{method: "PUT", pathPrefix: "/admin/api/content/team/members/", action: "update_team_member", resourceType: "team"},
	{method: "DELETE", pathPrefix: "/admin/api/content/team/members/", action: "delete_team_member", resourceType: "team"},

	// AI log stream.
	{method: "GET", pathSuffix: "/admin/api/logs/ai", action: "stream_ai_logs", resourceType: "admin_console"},
}

// deriveAction maps an HTTP method + path to a (action, resourceType, resourceID) triple.
// resourceID is extracted as the last path segment when the path ends with an identifier
// (e.g. /admin/api/contacts/42 → "42").
func deriveAction(method, path string) (action, resourceType, resourceID string) {
	for _, e := range staticActions {
		if e.method != method {
			continue
		}
		// pathSuffix set without pathPrefix means exact match on the full path.
		if e.pathSuffix != "" && e.pathPrefix == "" {
			if path == e.pathSuffix {
				return e.action, e.resourceType, ""
			}
			continue
		}
		// pathPrefix only.
		if e.pathPrefix != "" && e.pathSuffix == "" {
			if strings.HasPrefix(path, e.pathPrefix) {
				id := strings.TrimPrefix(path, e.pathPrefix)
				// Strip any further sub-segments — take only the first token.
				if slash := strings.IndexByte(id, '/'); slash >= 0 {
					id = id[:slash]
				}
				return e.action, e.resourceType, id
			}
			continue
		}
		// Both set: prefix AND suffix match (e.g. /newsletter/{id}/request-deletion).
		if e.pathPrefix != "" && e.pathSuffix != "" {
			if strings.HasPrefix(path, e.pathPrefix) && strings.HasSuffix(path, e.pathSuffix) {
				inner := strings.TrimPrefix(path, e.pathPrefix)
				id := strings.TrimSuffix(inner, e.pathSuffix)
				id = strings.Trim(id, "/")
				return e.action, e.resourceType, id
			}
			continue
		}
	}

	// Fallback: <METHOD>_<last_segment>, resource_type = "admin_console".
	segments := strings.Split(strings.TrimSuffix(path, "/"), "/")
	last := ""
	if len(segments) > 0 {
		last = segments[len(segments)-1]
	}
	last = strings.ToLower(strings.ReplaceAll(last, "-", "_"))
	action = strings.ToLower(method) + "_" + last
	return action, "admin_console", ""
}

// nullIfEmpty returns nil when s is empty, otherwise s. Used so resource_id
// is stored as SQL NULL rather than an empty string.
func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
