package handlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// defaultSeriesDays is the default look-back window for the dashboard
// sparkline / area charts. The handler accepts ?days=N (clamped 1..90) so
// the dashboard's date-range filter can swap windows without re-deploying.
const defaultSeriesDays = 14
const maxSeriesDays = 90

func dailyCounts(ctx context.Context, pool *pgxpool.Pool, sql string, capHint int) ([]int, error) {
	rows, err := pool.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]int, 0, capHint)
	for rows.Next() {
		var d time.Time
		var n int
		if err := rows.Scan(&d, &n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// statsWindow describes the time range a single /admin/stats request is
// scoped to. `from` and `to` are inclusive UTC day boundaries (midnight ..
// 23:59:59.999). `days` is the count of days in the window (1..maxSeriesDays).
type statsWindow struct {
	days int
	from time.Time
	to   time.Time
}

// parseWindow reads the optional date-range query params and returns a
// validated window. Two modes:
//   - ?from=YYYY-MM-DD&to=YYYY-MM-DD  → explicit custom range (clamped to
//     maxSeriesDays). Used by the dashboard's "Custom" filter.
//   - ?days=N                          → relative window ending today.
//     Used by the "Today / 7d / 14d / 30d / 90d" preset pills.
//
// Falls back to defaultSeriesDays when nothing parses.
func parseWindow(r *http.Request) statsWindow {
	q := r.URL.Query()

	// Custom range: from + to must both be valid YYYY-MM-DD and from <= to.
	if fs, ts := q.Get("from"), q.Get("to"); fs != "" && ts != "" {
		fromD, ferr := time.Parse("2006-01-02", fs)
		toD, terr := time.Parse("2006-01-02", ts)
		if ferr == nil && terr == nil && !fromD.After(toD) {
			days := int(toD.Sub(fromD).Hours()/24) + 1
			if days > maxSeriesDays {
				days = maxSeriesDays
				toD = fromD.AddDate(0, 0, days-1)
			}
			from := time.Date(fromD.Year(), fromD.Month(), fromD.Day(), 0, 0, 0, 0, time.UTC)
			to := time.Date(toD.Year(), toD.Month(), toD.Day(), 23, 59, 59, 999999999, time.UTC)
			return statsWindow{days: days, from: from, to: to}
		}
	}

	// Preset days=N (default 14, clamp 1..max).
	n := defaultSeriesDays
	if raw := q.Get("days"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v >= 1 {
			n = v
		}
	}
	if n > maxSeriesDays {
		n = maxSeriesDays
	}
	now := time.Now().UTC()
	toDay := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 999999999, time.UTC)
	fromDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -(n - 1))
	return statsWindow{days: n, from: fromDay, to: toDay}
}

// AdminStatsHandler handles GET /admin/stats. Returns an operational picture
// of the practice using plain-English keys so the dashboard can render labels
// like "AI phone calls" / "AI voice chatbot" / "AI text chatbot" directly
// without translation.
//
// Hot-path latency budget
// =======================
// Each request fans out 17 Pg queries + a DDB intake scan + a DDB callback
// scan in parallel. Warm-pool p50 is ~90ms today and grows linearly with
// intake count; without a cache the dashboard's auto-refresh + multi-tab
// behavior turns into a small DDoS on Postgres. We keep a per-admin TTL
// cache in front of the handler.
//
// HIPAA note: the cached payload contains only aggregate counts (no
// names, emails, phone numbers, transcript bodies). The audit middleware
// still fires on every cache HIT because it wraps this handler — so "who
// looked at the dashboard, when" remains complete.
const statsCacheTTL = 30 * time.Second

type statsCacheEntry struct {
	at   time.Time
	body []byte
}

type AdminStatsHandler struct {
	Pool *pgxpool.Pool
	PHI  *phi.Store

	// cache is keyed by `userID|query` so two admins or two different date
	// ranges never share an entry. atomic load/store guards a value type to
	// avoid a lock on the hot path.
	cache sync.Map // map[string]*atomic.Pointer[statsCacheEntry]
}

func (h *AdminStatsHandler) cacheGet(key string) ([]byte, bool) {
	v, ok := h.cache.Load(key)
	if !ok {
		return nil, false
	}
	ptr := v.(*atomic.Pointer[statsCacheEntry])
	e := ptr.Load()
	if e == nil || time.Since(e.at) > statsCacheTTL {
		return nil, false
	}
	return e.body, true
}

func (h *AdminStatsHandler) cachePut(key string, body []byte) {
	entry := &statsCacheEntry{at: time.Now(), body: body}
	v, _ := h.cache.LoadOrStore(key, &atomic.Pointer[statsCacheEntry]{})
	v.(*atomic.Pointer[statsCacheEntry]).Store(entry)
}

func (h *AdminStatsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	win := parseWindow(r)
	seriesDays := win.days
	winFrom := win.from.Format("2006-01-02")
	winTo := win.to.Format("2006-01-02")

	// ---- Per-admin TTL cache (30s) ----
	// Keyed by admin user ID + raw query string. RawQuery preserves whatever
	// the dashboard sent (days=N or from=...&to=...) so two adjacent tabs on
	// the same window share the cached payload but a date-range switch falls
	// through to a fresh build.
	var cacheKey string
	if u, ok := appmw.AdminFromContext(ctx); ok {
		cacheKey = strconv.FormatInt(u.ID, 10) + "|" + r.URL.RawQuery
		if body, ok := h.cacheGet(cacheKey); ok {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Cache", "HIT")
			_, _ = w.Write(body)
			return
		}
	}

	// ---- Postgres-backed counters ----
	var (
		totalContacts int
		contactsToday int

		phoneCallsTotal int
		phoneCallsToday int
		phoneCallsActive int

		voiceChatbotTotal  int
		voiceChatbotToday  int
		voiceChatbotActive int

		textChatbotTotal  int
		textChatbotToday  int
		textChatbotActive int

		totalNewsletterSubs  int
		activeNewsletterSubs int

		purgeQueueSize int

		contactsSeries     []int
		phoneCallsSeries   []int
		voiceChatbotSeries []int
		textChatbotSeries  []int
	)

	// winFrom/winTo are already strict YYYY-MM-DD strings from parseWindow,
	// so direct interpolation is safe (no injection surface).
	seriesQ := func(tbl, ts, extraWhere string) string {
		where := ""
		if extraWhere != "" {
			where = "AND " + extraWhere + " "
		}
		return `WITH d AS (
			SELECT generate_series(
				DATE '` + winFrom + `',
				DATE '` + winTo + `',
				interval '1 day'
			)::date AS day
		)
		SELECT d.day, COALESCE(count(t.*), 0)::int
		FROM d
		LEFT JOIN ` + tbl + ` t
			ON t.` + ts + `::date = d.day ` + where + `
		GROUP BY d.day
		ORDER BY d.day`
	}

	// "Active" = open session with activity in the last 20 min.
	activeSQL := func(source string) string {
		return `SELECT count(*) FROM bt.chat_sessions s
		        WHERE s.source = '` + source + `'
		          AND s.ended_at IS NULL
		          AND s.purged_at IS NULL
		          AND COALESCE(s.last_message_at, s.started_at) > now() - INTERVAL '20 minutes'`
	}

	// `total` for every channel/contact is scoped to the selected date filter
	// (winFrom..winTo) so the dashboard KPIs change when the user moves the
	// range slider. `today` is always actual today regardless of window.
	// `active_now` and `purgeQueueSize` are point-in-time, also unscoped.
	dateRange := `created_at::date BETWEEN DATE '` + winFrom + `' AND DATE '` + winTo + `'`
	startedRange := `started_at::date BETWEEN DATE '` + winFrom + `' AND DATE '` + winTo + `'`

	queries := []struct {
		sql  string
		dest *int
	}{
		{`SELECT count(*) FROM bt.contact_submissions WHERE ` + dateRange, &totalContacts},
		{`SELECT count(*) FROM bt.contact_submissions WHERE created_at >= current_date`, &contactsToday},

		{`SELECT count(*) FROM bt.chat_sessions WHERE source = 'voice-phone' AND ` + startedRange, &phoneCallsTotal},
		{`SELECT count(*) FROM bt.chat_sessions WHERE source = 'voice-phone' AND started_at >= current_date`, &phoneCallsToday},
		{activeSQL("voice-phone"), &phoneCallsActive},

		{`SELECT count(*) FROM bt.chat_sessions WHERE source = 'voice-agent' AND ` + startedRange, &voiceChatbotTotal},
		{`SELECT count(*) FROM bt.chat_sessions WHERE source = 'voice-agent' AND started_at >= current_date`, &voiceChatbotToday},
		{activeSQL("voice-agent"), &voiceChatbotActive},

		{`SELECT count(*) FROM bt.chat_sessions WHERE source = 'chat-agent' AND ` + startedRange, &textChatbotTotal},
		{`SELECT count(*) FROM bt.chat_sessions WHERE source = 'chat-agent' AND started_at >= current_date`, &textChatbotToday},
		{activeSQL("chat-agent"), &textChatbotActive},

		// Newsletter totals are point-in-time list state, not event-rate;
		// leave unscoped so admins always see the true subscriber count.
		{`SELECT count(*) FROM bt.newsletter_subscribers`, &totalNewsletterSubs},
		{`SELECT count(*) FROM bt.newsletter_subscribers WHERE unsubscribed_at IS NULL`, &activeNewsletterSubs},

		{`SELECT count(*) FROM bt.phi_due_for_purge`, &purgeQueueSize},
	}

	gctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var (
		wg    sync.WaitGroup
		mu    sync.Mutex
		first error
	)
	for _, q := range queries {
		wg.Add(1)
		go func(q struct {
			sql  string
			dest *int
		}) {
			defer wg.Done()
			if err := h.Pool.QueryRow(gctx, q.sql).Scan(q.dest); err != nil {
				mu.Lock()
				if first == nil {
					first = err
					slog.Error("admin stats query", "sql", q.sql, "err", err)
				}
				mu.Unlock()
				cancel()
			}
		}(q)
	}

	seriesTargets := []struct {
		sql string
		out *[]int
	}{
		{seriesQ("bt.contact_submissions", "created_at", ""), &contactsSeries},
		{seriesQ("bt.chat_sessions", "started_at", "t.source = 'voice-phone'"), &phoneCallsSeries},
		{seriesQ("bt.chat_sessions", "started_at", "t.source = 'voice-agent'"), &voiceChatbotSeries},
		{seriesQ("bt.chat_sessions", "started_at", "t.source = 'chat-agent'"), &textChatbotSeries},
	}
	for _, q := range seriesTargets {
		wg.Add(1)
		go func(q struct {
			sql string
			out *[]int
		}) {
			defer wg.Done()
			vals, err := dailyCounts(gctx, h.Pool, q.sql, seriesDays)
			if err != nil {
				mu.Lock()
				if first == nil {
					first = err
					slog.Error("admin stats series", "sql", q.sql, "err", err)
				}
				mu.Unlock()
				cancel()
				return
			}
			*q.out = vals
		}(q)
	}

	// ---- DDB-backed counters (intakes + callbacks) ----
	// Run alongside Postgres queries via the same waitgroup.
	type intakeSummary struct {
		total            int
		today            int
		eligible         int
		selfPay          int
		needsReview      int
		verificationErr  int
		series           []int
	}
	type callbackSummary struct {
		total int
		today int
	}

	var intakes intakeSummary
	var callbacks callbackSummary

	if h.PHI != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			recs, _, err := h.PHI.ListIntakePointers(gctx, phi.IntakeFilter{Limit: 10000})
			if err != nil {
				mu.Lock()
				if first == nil {
					first = err
					slog.Error("admin stats: intake list", "err", err)
				}
				mu.Unlock()
				cancel()
				return
			}
			// All counters are scoped to the same window as the Postgres
			// series so the dashboard's KPI cards reflect the selected date
			// filter. `today` is always actual today regardless of window.
			winStartUTC := win.from
			winEndUTC := win.to
			series := make([]int, seriesDays)
			todayStart := time.Now().UTC().Truncate(24 * time.Hour)
			for _, rec := range recs {
				// ListIntakePointers already skips purged rows.
				if !rec.CreatedAt.Before(todayStart) {
					intakes.today++
				}
				// Skip anything outside the selected window for totals + status.
				if rec.CreatedAt.Before(winStartUTC) || rec.CreatedAt.After(winEndUTC) {
					continue
				}
				intakes.total++
				switch rec.CoverageStatus {
				case phi.StatusEligible:
					intakes.eligible++
				case phi.StatusSelfPay:
					intakes.selfPay++
				case phi.StatusNeedsReview:
					intakes.needsReview++
				case phi.StatusVerificationError:
					intakes.verificationErr++
				}
				dayIdx := int(rec.CreatedAt.UTC().Truncate(24 * time.Hour).Sub(winStartUTC).Hours() / 24)
				if dayIdx >= 0 && dayIdx < seriesDays {
					series[dayIdx]++
				}
			}
			intakes.series = series
		}()

		wg.Add(1)
		go func() {
			defer wg.Done()
			recs, _, err := h.PHI.ListCallbacks(gctx, phi.CallbackFilter{Limit: 10000})
			if err != nil {
				mu.Lock()
				if first == nil {
					first = err
					slog.Error("admin stats: callback list", "err", err)
				}
				mu.Unlock()
				cancel()
				return
			}
			winStartUTC := win.from
			winEndUTC := win.to
			todayStart := time.Now().UTC().Truncate(24 * time.Hour)
			for _, rec := range recs {
				if rec.PurgedAt != nil {
					continue
				}
				if !rec.CreatedAt.Before(todayStart) {
					callbacks.today++
				}
				if rec.CreatedAt.Before(winStartUTC) || rec.CreatedAt.After(winEndUTC) {
					continue
				}
				callbacks.total++
			}
		}()
	}

	wg.Wait()
	if first != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	if intakes.series == nil {
		intakes.series = make([]int, seriesDays)
	}

	// Day labels (matches the order of every series).
	labels := make([]string, seriesDays)
	for i := 0; i < seriesDays; i++ {
		labels[i] = win.from.AddDate(0, 0, i).Format("2006-01-02")
	}

	payload := map[string]any{
		"contacts": map[string]any{
			"total": totalContacts,
			"today": contactsToday,
		},
		// "AI phone calls" — patient called the clinic's published number and
		// spoke to the realtime voice agent over Twilio.
		"phone_calls": map[string]any{
			"total":      phoneCallsTotal,
			"today":      phoneCallsToday,
			"active_now": phoneCallsActive,
		},
		// "AI voice chatbot" — visitor opened the website voice widget
		// (WebRTC mic to the realtime voice agent).
		"voice_chatbot": map[string]any{
			"total":      voiceChatbotTotal,
			"today":      voiceChatbotToday,
			"active_now": voiceChatbotActive,
		},
		// "AI text chatbot" — visitor used the website chat bubble.
		"text_chatbot": map[string]any{
			"total":      textChatbotTotal,
			"today":      textChatbotToday,
			"active_now": textChatbotActive,
		},
		"appointments": map[string]any{
			"total": intakes.total,
			"today": intakes.today,
			"by_status": map[string]int{
				"eligible":           intakes.eligible,
				"self_pay":           intakes.selfPay,
				"needs_review":       intakes.needsReview,
				"verification_error": intakes.verificationErr,
			},
		},
		"callbacks": map[string]any{
			"total": callbacks.total,
			"today": callbacks.today,
		},
		"newsletter": map[string]any{
			"total":  totalNewsletterSubs,
			"active": activeNewsletterSubs,
		},
		"compliance": map[string]any{
			"purge_queue_size": purgeQueueSize,
		},
		"series": map[string]any{
			"days":          labels,
			"contacts":      contactsSeries,
			"phone_calls":   phoneCallsSeries,
			"voice_chatbot": voiceChatbotSeries,
			"text_chatbot":  textChatbotSeries,
			"appointments":  intakes.series,
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		slog.Error("admin stats: marshal", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if cacheKey != "" {
		h.cachePut(cacheKey, body)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Cache", "MISS")
	_, _ = w.Write(body)
}
