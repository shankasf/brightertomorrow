package handlers

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/jackc/pgx/v5/pgxpool"
)

// seriesDays is the look-back window for the dashboard sparkline / area charts.
// Returned in the /admin/stats response under `series` so the dashboard can
// render 14-day sparklines for contacts, chats, messages, newsletter.
const seriesDays = 14

// dailyCounts runs `SELECT date::date, count(*)::int` against a CTE that
// generates a complete day range so missing days come back as 0 instead of
// being dropped — keeps the chart x-axis stable.
func dailyCounts(ctx context.Context, pool *pgxpool.Pool, sql string) ([]int, error) {
	rows, err := pool.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]int, 0, seriesDays)
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

// AdminStatsHandler handles GET /admin/stats.
type AdminStatsHandler struct {
	Pool *pgxpool.Pool
}

func (h *AdminStatsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	type row struct{ label string; dest *int }

	var (
		totalContacts         int
		contactsToday         int
		totalChats            int
		activeChats           int
		chatsToday            int
		totalMessages         int
		totalNewsletterSubs   int
		activeNewsletterSubs  int
		totalFaqs             int
		totalBlogPosts        int
		publishedBlogPosts    int
		totalTeamMembers      int
		purgeQueueSize        int

		contactsSeries   []int
		chatsSeries      []int
		messagesSeries   []int
		newsletterSeries []int
	)

	// Day-bucket CTE: `generate_series(0..13)` so every day in the window appears
	// even if there's no data — keeps the chart x-axis aligned with reality.
	seriesQ := func(tbl, ts string) string {
		return `WITH d AS (
			SELECT generate_series(
				(current_date - interval '` + strconv.Itoa(seriesDays-1) + ` days')::date,
				current_date,
				interval '1 day'
			)::date AS day
		)
		SELECT d.day, COALESCE(count(t.*), 0)::int
		FROM d
		LEFT JOIN ` + tbl + ` t
			ON t.` + ts + `::date = d.day
		GROUP BY d.day
		ORDER BY d.day`
	}

	queries := []struct {
		sql  string
		dest *int
	}{
		{`SELECT count(*) FROM bt.contact_submissions`, &totalContacts},
		{`SELECT count(*) FROM bt.contact_submissions WHERE created_at >= current_date`, &contactsToday},
		{`SELECT count(*) FROM bt.chat_sessions`, &totalChats},
		// "Active" = open session with activity in the last 20 min (Zendesk Chat web standard).
		// A separate CronJob (k8s/71-chat-idle-cronjob.yaml) writes ended_at on the same threshold.
		{`SELECT count(*)
		  FROM bt.chat_sessions s
		  WHERE s.ended_at IS NULL
		    AND s.purged_at IS NULL
		    AND COALESCE(
		      (SELECT MAX(m.created_at) FROM bt.chat_messages m WHERE m.session_id = s.id),
		      s.started_at
		    ) > now() - INTERVAL '20 minutes'`, &activeChats},
		{`SELECT count(*) FROM bt.chat_sessions WHERE started_at >= current_date`, &chatsToday},
		{`SELECT count(*) FROM bt.chat_messages`, &totalMessages},
		{`SELECT count(*) FROM bt.newsletter_subscribers`, &totalNewsletterSubs},
		{`SELECT count(*) FROM bt.newsletter_subscribers WHERE unsubscribed_at IS NULL`, &activeNewsletterSubs},
		{`SELECT count(*) FROM bt.faqs`, &totalFaqs},
		{`SELECT count(*) FROM bt.blog_posts`, &totalBlogPosts},
		{`SELECT count(*) FROM bt.blog_posts WHERE published`, &publishedBlogPosts},
		{`SELECT count(*) FROM bt.team_members WHERE published`, &totalTeamMembers},
		{`SELECT count(*) FROM bt.phi_due_for_purge`, &purgeQueueSize},
	}

	// Fan out the count queries in parallel — each is independent and the
	// pgxpool can serve them concurrently. Cuts dashboard latency from
	// O(N · roundtrip) to O(roundtrip).
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
	// Series queries run in parallel with the counts above.
	seriesTargets := []struct {
		sql string
		out *[]int
	}{
		{seriesQ("bt.contact_submissions", "created_at"), &contactsSeries},
		{seriesQ("bt.chat_sessions", "started_at"), &chatsSeries},
		{seriesQ("bt.chat_messages", "created_at"), &messagesSeries},
		{seriesQ("bt.newsletter_subscribers", "created_at"), &newsletterSeries},
	}
	for _, q := range seriesTargets {
		wg.Add(1)
		go func(q struct {
			sql string
			out *[]int
		}) {
			defer wg.Done()
			vals, err := dailyCounts(gctx, h.Pool, q.sql)
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
	wg.Wait()
	if first != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// Day labels (matches the order of the series arrays).
	labels := make([]string, seriesDays)
	start := time.Now().AddDate(0, 0, -(seriesDays - 1))
	for i := 0; i < seriesDays; i++ {
		labels[i] = start.AddDate(0, 0, i).Format("2006-01-02")
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"contacts": map[string]any{
			"total":         totalContacts,
			"today":         contactsToday,
		},
		"chat": map[string]any{
			"total_sessions":  totalChats,
			"active_sessions": activeChats,
			"today_sessions":  chatsToday,
			"total_messages":  totalMessages,
		},
		"newsletter": map[string]any{
			"total":  totalNewsletterSubs,
			"active": activeNewsletterSubs,
		},
		"content": map[string]any{
			"faqs":             totalFaqs,
			"blog_posts":       totalBlogPosts,
			"published_posts":  publishedBlogPosts,
			"team_members":     totalTeamMembers,
		},
		"compliance": map[string]any{
			"purge_queue_size": purgeQueueSize,
		},
		"series": map[string]any{
			"days":       labels,
			"contacts":   contactsSeries,
			"chats":      chatsSeries,
			"messages":   messagesSeries,
			"newsletter": newsletterSeries,
		},
	})
}

