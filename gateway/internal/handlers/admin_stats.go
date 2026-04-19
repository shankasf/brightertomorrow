package handlers

import (
	"log/slog"
	"net/http"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/jackc/pgx/v5/pgxpool"
)

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
	)

	queries := []struct {
		sql  string
		dest *int
	}{
		{`SELECT count(*) FROM bt.contact_submissions`, &totalContacts},
		{`SELECT count(*) FROM bt.contact_submissions WHERE created_at >= current_date`, &contactsToday},
		{`SELECT count(*) FROM bt.chat_sessions`, &totalChats},
		{`SELECT count(*) FROM bt.chat_sessions WHERE ended_at IS NULL AND purged_at IS NULL`, &activeChats},
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

	for _, q := range queries {
		if err := h.Pool.QueryRow(ctx, q.sql).Scan(q.dest); err != nil {
			slog.Error("admin stats query", "sql", q.sql, "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
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
	})
}
