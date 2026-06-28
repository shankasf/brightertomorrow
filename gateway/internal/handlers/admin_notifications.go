package handlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminNotificationsHandler powers the sidebar unread-count badges.
//
//   GET  /admin/api/notifications/counts → { counts: { <section>: n, ... } }
//   POST /admin/api/notifications/seen   { "section": "callbacks" } → clears it
//
// "Unread" for a section = rows that arrived after this admin last opened it
// (bt.admin_nav_seen.seen_at). A section the admin has never opened counts all
// non-purged rows. Opening the section upserts seen_at = now() which zeroes the
// badge.
//
// HIPAA: every value returned is an aggregate count — no names, phones, or
// transcript bodies — so this endpoint exposes no PHI (same basis as
// /admin/api/stats, which is likewise excluded from the access-audit log).
type AdminNotificationsHandler struct {
	Pool *pgxpool.Pool
	PHI  *phi.Store

	// Per-admin TTL cache so the client's 60s poll (× tabs × admins) doesn't
	// re-scan the DDB callback/intake/insurance partitions every time.
	cache sync.Map // map[int64]*atomic.Pointer[notifCacheEntry]
}

// notifSections is the canonical set of badge-able nav sections. Order is not
// significant; the map the client receives is keyed by these strings.
var notifSections = []string{
	"appointments",
	"callbacks",
	"insurance_checks",
	"contacts",
	"chat",
	"newsletter",
	"matching", // therapist-match quiz activity (count is always 0 — section exists for seen-state)
}

func isNotifSection(s string) bool {
	for _, v := range notifSections {
		if v == s {
			return true
		}
	}
	return false
}

const notifCacheTTL = 20 * time.Second

// epochBaseline is the "never opened this section" default — counts everything.
var epochBaseline = time.Unix(0, 0).UTC()

type notifCacheEntry struct {
	at   time.Time
	body []byte
}

func (h *AdminNotificationsHandler) cacheGet(id int64) ([]byte, bool) {
	v, ok := h.cache.Load(id)
	if !ok {
		return nil, false
	}
	e := v.(*atomic.Pointer[notifCacheEntry]).Load()
	if e == nil || time.Since(e.at) > notifCacheTTL {
		return nil, false
	}
	return e.body, true
}

func (h *AdminNotificationsHandler) cachePut(id int64, body []byte) {
	entry := &notifCacheEntry{at: time.Now(), body: body}
	v, _ := h.cache.LoadOrStore(id, &atomic.Pointer[notifCacheEntry]{})
	v.(*atomic.Pointer[notifCacheEntry]).Store(entry)
}

// cacheBust drops a single admin's cached counts so a Seen write is reflected
// on the very next Counts poll instead of up to notifCacheTTL later.
func (h *AdminNotificationsHandler) cacheBust(id int64) { h.cache.Delete(id) }

// seenMap loads this admin's last-seen timestamp per section, defaulting any
// section with no row to epochBaseline (so it counts all rows).
func (h *AdminNotificationsHandler) seenMap(ctx context.Context, adminID int64) (map[string]time.Time, error) {
	out := make(map[string]time.Time, len(notifSections))
	for _, s := range notifSections {
		out[s] = epochBaseline
	}
	rows, err := h.Pool.Query(ctx,
		`SELECT section, seen_at FROM bt.admin_nav_seen WHERE admin_user_id = $1`, adminID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var section string
		var seenAt time.Time
		if err := rows.Scan(&section, &seenAt); err != nil {
			return nil, err
		}
		if _, ok := out[section]; ok {
			out[section] = seenAt.UTC()
		}
	}
	return out, rows.Err()
}

// Counts handles GET /admin/api/notifications/counts.
func (h *AdminNotificationsHandler) Counts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, ok := appmw.AdminFromContext(ctx)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if body, ok := h.cacheGet(u.ID); ok {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "HIT")
		_, _ = w.Write(body)
		return
	}

	seen, err := h.seenMap(ctx, u.ID)
	if err != nil {
		slog.Error("notifications: seen map", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	counts := make(map[string]int, len(notifSections))
	var (
		mu    sync.Mutex
		wg    sync.WaitGroup
		first error
	)
	gctx, cancel := context.WithCancel(ctx)
	defer cancel()
	set := func(section string, n int) {
		mu.Lock()
		counts[section] = n
		mu.Unlock()
	}
	fail := func(where string, err error) {
		mu.Lock()
		if first == nil {
			first = err
			slog.Error("notifications: count failed", "where", where, "err", err)
		}
		mu.Unlock()
		cancel()
	}

	// --- Postgres-backed sections ---
	pgCount := func(section, sql string, since time.Time) {
		defer wg.Done()
		var n int
		if err := h.Pool.QueryRow(gctx, sql, since).Scan(&n); err != nil {
			fail(section, err)
			return
		}
		set(section, n)
	}
	wg.Add(3)
	go pgCount("contacts",
		`SELECT count(*) FROM bt.contact_submissions WHERE created_at > $1 AND purged_at IS NULL`,
		seen["contacts"])
	go pgCount("chat",
		`SELECT count(*) FROM bt.chat_sessions WHERE started_at > $1 AND purged_at IS NULL`,
		seen["chat"])
	go pgCount("newsletter",
		`SELECT count(*) FROM bt.newsletter_subscribers WHERE created_at > $1 AND unsubscribed_at IS NULL`,
		seen["newsletter"])

	// --- DDB-backed sections (intakes / callbacks / insurance) ---
	if h.PHI != nil {
		wg.Add(3)
		go func() {
			defer wg.Done()
			since := seen["appointments"]
			recs, _, err := h.PHI.ListIntakePointers(gctx, phi.IntakeFilter{From: &since, Limit: 10000})
			if err != nil {
				fail("appointments", err)
				return
			}
			n := 0
			for _, rec := range recs {
				if rec.WorkflowStatus == "archived" {
					continue
				}
				if rec.CreatedAt.After(since) {
					n++
				}
			}
			set("appointments", n)
		}()
		go func() {
			defer wg.Done()
			since := seen["callbacks"]
			recs, _, err := h.PHI.ListCallbacks(gctx, phi.CallbackFilter{Limit: 10000})
			if err != nil {
				fail("callbacks", err)
				return
			}
			n := 0
			for _, rec := range recs {
				if rec.PurgedAt != nil {
					continue
				}
				if rec.CreatedAt.After(since) {
					n++
				}
			}
			set("callbacks", n)
		}()
		go func() {
			defer wg.Done()
			since := seen["insurance_checks"]
			recs, _, err := h.PHI.ListInsuranceChecks(gctx, phi.InsuranceCheckFilter{From: &since, Limit: 10000})
			if err != nil {
				fail("insurance_checks", err)
				return
			}
			n := 0
			for _, rec := range recs {
				if rec.CreatedAt.After(since) {
					n++
				}
			}
			set("insurance_checks", n)
		}()
	} else {
		set("appointments", 0)
		set("callbacks", 0)
		set("insurance_checks", 0)
	}

	// "matching" section: badge count is always 0 (section exists for seen-state
	// tracking only — the admin opens the Therapist Matching page to dismiss it).
	set("matching", 0)

	wg.Wait()
	if first != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	body, err := json.Marshal(map[string]any{"counts": counts})
	if err != nil {
		slog.Error("notifications: marshal", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	h.cachePut(u.ID, body)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Cache", "MISS")
	_, _ = w.Write(body)
}

// Seen handles POST /admin/api/notifications/seen — marks a section read for
// the calling admin, clearing its badge.
func (h *AdminNotificationsHandler) Seen(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u, ok := appmw.AdminFromContext(ctx)
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var body struct {
		Section string `json:"section"`
	}
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if !isNotifSection(body.Section) {
		httpx.WriteValidationError(w, "unknown section")
		return
	}
	_, err := h.Pool.Exec(ctx,
		`INSERT INTO bt.admin_nav_seen (admin_user_id, section, seen_at)
		 VALUES ($1, $2, now())
		 ON CONFLICT (admin_user_id, section)
		 DO UPDATE SET seen_at = now()`, u.ID, body.Section)
	if err != nil {
		slog.Error("notifications: seen upsert", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	h.cacheBust(u.ID)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}
