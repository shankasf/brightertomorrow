package handlers

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/aiclient"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminContentHandler handles all content-management CRUD endpoints.
type AdminContentHandler struct {
	Pool     *pgxpool.Pool
	AIClient *aiclient.Client // used to trigger FAQ re-embedding after writes
}

// triggerFAQEmbed fires a non-blocking re-embed of all FAQs.
// Call after any FAQ create / update / delete so vectors stay current.
func (h *AdminContentHandler) triggerFAQEmbed() {
	if h.AIClient == nil {
		return
	}
	go h.AIClient.TriggerFAQEmbed(func(msg string, args ...any) {
		slog.Warn(msg, args...)
	})
}

// ─── FAQs ─────────────────────────────────────────────────────────────────────

type faqBody struct {
	Question  string  `json:"question"`
	Answer    string  `json:"answer"`
	Category  *string `json:"category"`
	Position  int     `json:"position"`
	Published bool    `json:"published"`
}

func (h *AdminContentHandler) ListFAQs(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, question, answer, category, position, published FROM bt.faqs ORDER BY position`)
	if err != nil {
		slog.Error("admin faqs list", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()
	type faqRow struct {
		ID        int64   `json:"id"`
		Question  string  `json:"question"`
		Answer    string  `json:"answer"`
		Category  *string `json:"category"`
		Position  int     `json:"position"`
		Published bool    `json:"published"`
	}
	var faqs []faqRow
	for rows.Next() {
		var f faqRow
		if err := rows.Scan(&f.ID, &f.Question, &f.Answer, &f.Category, &f.Position, &f.Published); err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		faqs = append(faqs, f)
	}
	if faqs == nil {
		faqs = []faqRow{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"faqs": faqs})
}

func (h *AdminContentHandler) CreateFAQ(w http.ResponseWriter, r *http.Request) {
	var b faqBody
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	var id int64
	err := h.Pool.QueryRow(r.Context(),
		`INSERT INTO bt.faqs (question, answer, category, position, published)
		 VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		b.Question, b.Answer, b.Category, b.Position, b.Published,
	).Scan(&id)
	if err != nil {
		slog.Error("admin faq create", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	h.triggerFAQEmbed()
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (h *AdminContentHandler) UpdateFAQ(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var b faqBody
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	tag, err := h.Pool.Exec(r.Context(),
		`UPDATE bt.faqs SET question=$1, answer=$2, category=$3, position=$4, published=$5 WHERE id=$6`,
		b.Question, b.Answer, b.Category, b.Position, b.Published, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *AdminContentHandler) DeleteFAQ(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	tag, err := h.Pool.Exec(r.Context(), `DELETE FROM bt.faqs WHERE id=$1`, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	h.triggerFAQEmbed()
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ─── Blog Posts ───────────────────────────────────────────────────────────────

type blogBody struct {
	Slug      string  `json:"slug"`
	Title     string  `json:"title"`
	Excerpt   *string `json:"excerpt"`
	BodyMD    *string `json:"body_md"`
	CoverURL  *string `json:"cover_url"`
	Author    *string `json:"author"`
	Published bool    `json:"published"`
}

func (h *AdminContentHandler) ListBlogPosts(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, slug, title, excerpt, cover_url, author, published,
		        to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		 FROM bt.blog_posts ORDER BY published_at DESC`)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()
	type postRow struct {
		ID          int64   `json:"id"`
		Slug        string  `json:"slug"`
		Title       string  `json:"title"`
		Excerpt     *string `json:"excerpt"`
		CoverURL    *string `json:"cover_url"`
		Author      *string `json:"author"`
		Published   bool    `json:"published"`
		PublishedAt string  `json:"published_at"`
	}
	var posts []postRow
	for rows.Next() {
		var p postRow
		if err := rows.Scan(&p.ID, &p.Slug, &p.Title, &p.Excerpt, &p.CoverURL, &p.Author, &p.Published, &p.PublishedAt); err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		posts = append(posts, p)
	}
	if posts == nil {
		posts = []postRow{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"posts": posts})
}

func (h *AdminContentHandler) GetBlogPost(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	type postDetail struct {
		ID          int64   `json:"id"`
		Slug        string  `json:"slug"`
		Title       string  `json:"title"`
		Excerpt     *string `json:"excerpt"`
		BodyMD      *string `json:"body_md"`
		CoverURL    *string `json:"cover_url"`
		Author      *string `json:"author"`
		Published   bool    `json:"published"`
		PublishedAt string  `json:"published_at"`
	}
	var p postDetail
	err := h.Pool.QueryRow(r.Context(),
		`SELECT id, slug, title, excerpt, body_md, cover_url, author, published,
		        to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		 FROM bt.blog_posts WHERE id=$1`, id,
	).Scan(&p.ID, &p.Slug, &p.Title, &p.Excerpt, &p.BodyMD, &p.CoverURL, &p.Author, &p.Published, &p.PublishedAt)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, p)
}

func (h *AdminContentHandler) CreateBlogPost(w http.ResponseWriter, r *http.Request) {
	var b blogBody
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	var id int64
	err := h.Pool.QueryRow(r.Context(),
		`INSERT INTO bt.blog_posts (slug, title, excerpt, body_md, cover_url, author, published)
		 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
		b.Slug, b.Title, b.Excerpt, b.BodyMD, b.CoverURL, b.Author, b.Published,
	).Scan(&id)
	if err != nil {
		slog.Error("admin blog create", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (h *AdminContentHandler) UpdateBlogPost(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var b blogBody
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	tag, err := h.Pool.Exec(r.Context(),
		`UPDATE bt.blog_posts SET slug=$1, title=$2, excerpt=$3, body_md=$4,
		        cover_url=$5, author=$6, published=$7 WHERE id=$8`,
		b.Slug, b.Title, b.Excerpt, b.BodyMD, b.CoverURL, b.Author, b.Published, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *AdminContentHandler) DeleteBlogPost(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	tag, err := h.Pool.Exec(r.Context(), `DELETE FROM bt.blog_posts WHERE id=$1`, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *AdminContentHandler) BulkPublishBlogPosts(w http.ResponseWriter, r *http.Request) {
	type bulkPublishBody struct {
		IDs       []int64 `json:"ids"`
		Published bool    `json:"published"`
	}
	var b bulkPublishBody
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if len(b.IDs) == 0 {
		httpx.WriteValidationError(w, "ids must be a non-empty array")
		return
	}

	var (
		tag pgconn.CommandTag
		err error
	)
	if b.Published {
		tag, err = h.Pool.Exec(r.Context(),
			`UPDATE bt.blog_posts SET published = true, published_at = now() WHERE id = ANY($1)`,
			b.IDs)
	} else {
		tag, err = h.Pool.Exec(r.Context(),
			`UPDATE bt.blog_posts SET published = false WHERE id = ANY($1)`,
			b.IDs)
	}
	if err != nil {
		slog.Error("admin blog bulk publish", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "updated": tag.RowsAffected()})
}

// ─── Site Settings ────────────────────────────────────────────────────────────

func (h *AdminContentHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	type settings struct {
		BrandName     string `json:"brand_name"`
		Tagline       *string `json:"tagline"`
		PrimaryPhone  *string `json:"primary_phone"`
		PrimaryEmail  *string `json:"primary_email"`
		PrimaryColor  string `json:"primary_color"`
		TextColor     string `json:"text_color"`
		MutedColor    string `json:"muted_color"`
		SurfaceColor  string `json:"surface_color"`
		LogoURL       *string `json:"logo_url"`
		HeroImageURL  *string `json:"hero_image_url"`
	}
	var s settings
	err := h.Pool.QueryRow(r.Context(),
		`SELECT brand_name, tagline, primary_phone, primary_email,
		        primary_color, text_color, muted_color, surface_color, logo_url, hero_image_url
		 FROM bt.site_settings WHERE id=1`,
	).Scan(&s.BrandName, &s.Tagline, &s.PrimaryPhone, &s.PrimaryEmail,
		&s.PrimaryColor, &s.TextColor, &s.MutedColor, &s.SurfaceColor, &s.LogoURL, &s.HeroImageURL)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, s)
}

func (h *AdminContentHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	type settingsBody struct {
		BrandName    string  `json:"brand_name"`
		Tagline      *string `json:"tagline"`
		PrimaryPhone *string `json:"primary_phone"`
		PrimaryEmail *string `json:"primary_email"`
		PrimaryColor string  `json:"primary_color"`
		TextColor    string  `json:"text_color"`
		MutedColor   string  `json:"muted_color"`
		SurfaceColor string  `json:"surface_color"`
		LogoURL      *string `json:"logo_url"`
		HeroImageURL *string `json:"hero_image_url"`
	}
	var b settingsBody
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	_, err := h.Pool.Exec(r.Context(),
		`UPDATE bt.site_settings SET brand_name=$1, tagline=$2, primary_phone=$3, primary_email=$4,
		        primary_color=$5, text_color=$6, muted_color=$7, surface_color=$8,
		        logo_url=$9, hero_image_url=$10, updated_at=now() WHERE id=1`,
		b.BrandName, b.Tagline, b.PrimaryPhone, b.PrimaryEmail,
		b.PrimaryColor, b.TextColor, b.MutedColor, b.SurfaceColor,
		b.LogoURL, b.HeroImageURL)
	if err != nil {
		slog.Error("admin settings update", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ─── Team ─────────────────────────────────────────────────────────────────────

func (h *AdminContentHandler) ListTeamGroups(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, slug, title, description, position FROM bt.team_groups ORDER BY position`)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()
	type groupRow struct {
		ID          int64   `json:"id"`
		Slug        string  `json:"slug"`
		Title       string  `json:"title"`
		Description *string `json:"description"`
		Position    int     `json:"position"`
	}
	var groups []groupRow
	for rows.Next() {
		var g groupRow
		if err := rows.Scan(&g.ID, &g.Slug, &g.Title, &g.Description, &g.Position); err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		groups = append(groups, g)
	}
	if groups == nil {
		groups = []groupRow{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

func (h *AdminContentHandler) ListTeamMembers(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, group_id, full_name, credentials, role, bio, photo_url,
		        email, accepts_new, position, published,
		        office_locations, pricing_tier, network_status, specialties
		 FROM bt.team_members ORDER BY position`)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()
	type memberRow struct {
		ID              int64    `json:"id"`
		GroupID         *int64   `json:"group_id"`
		FullName        string   `json:"full_name"`
		Credentials     *string  `json:"credentials"`
		Role            *string  `json:"role"`
		Bio             *string  `json:"bio"`
		PhotoURL        *string  `json:"photo_url"`
		Email           *string  `json:"email"`
		AcceptsNew      bool     `json:"accepts_new"`
		Position        int      `json:"position"`
		Published       bool     `json:"published"`
		OfficeLocations []string `json:"office_locations"`
		PricingTier     *string  `json:"pricing_tier"`
		NetworkStatus   *string  `json:"network_status"`
		Specialties     []string `json:"specialties"`
	}
	var members []memberRow
	for rows.Next() {
		var m memberRow
		if err := rows.Scan(&m.ID, &m.GroupID, &m.FullName, &m.Credentials, &m.Role, &m.Bio,
			&m.PhotoURL, &m.Email, &m.AcceptsNew, &m.Position, &m.Published,
			&m.OfficeLocations, &m.PricingTier, &m.NetworkStatus, &m.Specialties); err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		if m.OfficeLocations == nil {
			m.OfficeLocations = []string{}
		}
		if m.Specialties == nil {
			m.Specialties = []string{}
		}
		members = append(members, m)
	}
	if members == nil {
		members = []memberRow{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"members": members})
}

func (h *AdminContentHandler) CreateTeamMember(w http.ResponseWriter, r *http.Request) {
	type body struct {
		GroupID         *int64   `json:"group_id"`
		FullName        string   `json:"full_name"`
		Credentials     *string  `json:"credentials"`
		Role            *string  `json:"role"`
		Bio             *string  `json:"bio"`
		PhotoURL        *string  `json:"photo_url"`
		Email           *string  `json:"email"`
		AcceptsNew      bool     `json:"accepts_new"`
		Position        int      `json:"position"`
		Published       bool     `json:"published"`
		OfficeLocations []string `json:"office_locations"`
		PricingTier     *string  `json:"pricing_tier"`
		NetworkStatus   *string  `json:"network_status"`
		Specialties     []string `json:"specialties"`
	}
	var b body
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if b.OfficeLocations == nil {
		b.OfficeLocations = []string{}
	}
	if b.Specialties == nil {
		b.Specialties = []string{}
	}
	var id int64
	err := h.Pool.QueryRow(r.Context(),
		`INSERT INTO bt.team_members
		        (group_id, full_name, credentials, role, bio, photo_url, email, accepts_new, position, published,
		         office_locations, pricing_tier, network_status, specialties)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
		b.GroupID, b.FullName, b.Credentials, b.Role, b.Bio, b.PhotoURL, b.Email, b.AcceptsNew, b.Position, b.Published,
		b.OfficeLocations, b.PricingTier, b.NetworkStatus, b.Specialties,
	).Scan(&id)
	if err != nil {
		slog.Error("admin team member create", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (h *AdminContentHandler) UpdateTeamMember(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	type body struct {
		GroupID         *int64   `json:"group_id"`
		FullName        string   `json:"full_name"`
		Credentials     *string  `json:"credentials"`
		Role            *string  `json:"role"`
		Bio             *string  `json:"bio"`
		PhotoURL        *string  `json:"photo_url"`
		Email           *string  `json:"email"`
		AcceptsNew      bool     `json:"accepts_new"`
		Position        int      `json:"position"`
		Published       bool     `json:"published"`
		OfficeLocations []string `json:"office_locations"`
		PricingTier     *string  `json:"pricing_tier"`
		NetworkStatus   *string  `json:"network_status"`
		Specialties     []string `json:"specialties"`
	}
	var b body
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if b.OfficeLocations == nil {
		b.OfficeLocations = []string{}
	}
	if b.Specialties == nil {
		b.Specialties = []string{}
	}
	tag, err := h.Pool.Exec(r.Context(),
		`UPDATE bt.team_members SET group_id=$1, full_name=$2, credentials=$3, role=$4, bio=$5,
		        photo_url=$6, email=$7, accepts_new=$8, position=$9, published=$10,
		        office_locations=$11, pricing_tier=$12, network_status=$13, specialties=$14
		 WHERE id=$15`,
		b.GroupID, b.FullName, b.Credentials, b.Role, b.Bio,
		b.PhotoURL, b.Email, b.AcceptsNew, b.Position, b.Published,
		b.OfficeLocations, b.PricingTier, b.NetworkStatus, b.Specialties, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *AdminContentHandler) DeleteTeamMember(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	tag, err := h.Pool.Exec(r.Context(), `DELETE FROM bt.team_members WHERE id=$1`, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ─── Services ─────────────────────────────────────────────────────────────────

func (h *AdminContentHandler) ListServices(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, slug, title, short_desc, long_desc, image_url, icon, position, published FROM bt.services ORDER BY position`)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()
	type row struct {
		ID        int64   `json:"id"`
		Slug      string  `json:"slug"`
		Title     string  `json:"title"`
		ShortDesc *string `json:"short_desc"`
		LongDesc  *string `json:"long_desc"`
		ImageURL  *string `json:"image_url"`
		Icon      *string `json:"icon"`
		Position  int     `json:"position"`
		Published bool    `json:"published"`
	}
	var items []row
	for rows.Next() {
		var v row
		if err := rows.Scan(&v.ID, &v.Slug, &v.Title, &v.ShortDesc, &v.LongDesc, &v.ImageURL, &v.Icon, &v.Position, &v.Published); err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		items = append(items, v)
	}
	if items == nil {
		items = []row{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"services": items})
}

func (h *AdminContentHandler) CreateService(w http.ResponseWriter, r *http.Request) {
	type body struct {
		Slug      string  `json:"slug"`
		Title     string  `json:"title"`
		ShortDesc *string `json:"short_desc"`
		LongDesc  *string `json:"long_desc"`
		ImageURL  *string `json:"image_url"`
		Icon      *string `json:"icon"`
		Position  int     `json:"position"`
		Published bool    `json:"published"`
	}
	var b body
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	var id int64
	if err := h.Pool.QueryRow(r.Context(),
		`INSERT INTO bt.services (slug, title, short_desc, long_desc, image_url, icon, position, published)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
		b.Slug, b.Title, b.ShortDesc, b.LongDesc, b.ImageURL, b.Icon, b.Position, b.Published,
	).Scan(&id); err != nil {
		slog.Error("admin service create", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (h *AdminContentHandler) UpdateService(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	type body struct {
		Slug      string  `json:"slug"`
		Title     string  `json:"title"`
		ShortDesc *string `json:"short_desc"`
		LongDesc  *string `json:"long_desc"`
		ImageURL  *string `json:"image_url"`
		Icon      *string `json:"icon"`
		Position  int     `json:"position"`
		Published bool    `json:"published"`
	}
	var b body
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	tag, err := h.Pool.Exec(r.Context(),
		`UPDATE bt.services SET slug=$1, title=$2, short_desc=$3, long_desc=$4,
		        image_url=$5, icon=$6, position=$7, published=$8 WHERE id=$9`,
		b.Slug, b.Title, b.ShortDesc, b.LongDesc, b.ImageURL, b.Icon, b.Position, b.Published, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *AdminContentHandler) DeleteService(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	tag, err := h.Pool.Exec(r.Context(), `DELETE FROM bt.services WHERE id=$1`, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ─── Testimonials ─────────────────────────────────────────────────────────────

func (h *AdminContentHandler) ListTestimonials(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, author, quote, rating, position, published FROM bt.testimonials ORDER BY position`)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()
	type row struct {
		ID        int64  `json:"id"`
		Author    string `json:"author"`
		Quote     string `json:"quote"`
		Rating    *int   `json:"rating"`
		Position  int    `json:"position"`
		Published bool   `json:"published"`
	}
	var items []row
	for rows.Next() {
		var v row
		if err := rows.Scan(&v.ID, &v.Author, &v.Quote, &v.Rating, &v.Position, &v.Published); err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		items = append(items, v)
	}
	if items == nil {
		items = []row{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"testimonials": items})
}

func (h *AdminContentHandler) CreateTestimonial(w http.ResponseWriter, r *http.Request) {
	type body struct {
		Author    string `json:"author"`
		Quote     string `json:"quote"`
		Rating    *int   `json:"rating"`
		Position  int    `json:"position"`
		Published bool   `json:"published"`
	}
	var b body
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	var id int64
	if err := h.Pool.QueryRow(r.Context(),
		`INSERT INTO bt.testimonials (author, quote, rating, position, published) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		b.Author, b.Quote, b.Rating, b.Position, b.Published,
	).Scan(&id); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": id})
}

func (h *AdminContentHandler) UpdateTestimonial(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	type body struct {
		Author    string `json:"author"`
		Quote     string `json:"quote"`
		Rating    *int   `json:"rating"`
		Position  int    `json:"position"`
		Published bool   `json:"published"`
	}
	var b body
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	tag, err := h.Pool.Exec(r.Context(),
		`UPDATE bt.testimonials SET author=$1, quote=$2, rating=$3, position=$4, published=$5 WHERE id=$6`,
		b.Author, b.Quote, b.Rating, b.Position, b.Published, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *AdminContentHandler) DeleteTestimonial(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	tag, err := h.Pool.Exec(r.Context(), `DELETE FROM bt.testimonials WHERE id=$1`, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ─── Locations ────────────────────────────────────────────────────────────────

func (h *AdminContentHandler) ListLocations(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, name, address1, address2, city, state, postal_code, phone, is_telehealth, position
		 FROM bt.locations ORDER BY position`)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()
	type row struct {
		ID          int64   `json:"id"`
		Name        string  `json:"name"`
		Address1    *string `json:"address1"`
		Address2    *string `json:"address2"`
		City        *string `json:"city"`
		State       *string `json:"state"`
		PostalCode  *string `json:"postal_code"`
		Phone       *string `json:"phone"`
		IsTelehealth bool   `json:"is_telehealth"`
		Position    int     `json:"position"`
	}
	var items []row
	for rows.Next() {
		var v row
		if err := rows.Scan(&v.ID, &v.Name, &v.Address1, &v.Address2, &v.City, &v.State,
			&v.PostalCode, &v.Phone, &v.IsTelehealth, &v.Position); err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		items = append(items, v)
	}
	if items == nil {
		items = []row{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"locations": items})
}

func (h *AdminContentHandler) UpsertLocation(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	type body struct {
		Name         string  `json:"name"`
		Address1     *string `json:"address1"`
		Address2     *string `json:"address2"`
		City         *string `json:"city"`
		State        *string `json:"state"`
		PostalCode   *string `json:"postal_code"`
		Phone        *string `json:"phone"`
		IsTelehealth bool    `json:"is_telehealth"`
		Position     int     `json:"position"`
	}
	var b body
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}

	if idStr == "" {
		var id int64
		if err := h.Pool.QueryRow(r.Context(),
			`INSERT INTO bt.locations (name, address1, address2, city, state, postal_code, phone, is_telehealth, position)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
			b.Name, b.Address1, b.Address2, b.City, b.State, b.PostalCode, b.Phone, b.IsTelehealth, b.Position,
		).Scan(&id); err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": id})
		return
	}
	id, _ := strconv.ParseInt(idStr, 10, 64)
	tag, err := h.Pool.Exec(r.Context(),
		`UPDATE bt.locations SET name=$1, address1=$2, address2=$3, city=$4, state=$5,
		        postal_code=$6, phone=$7, is_telehealth=$8, position=$9 WHERE id=$10`,
		b.Name, b.Address1, b.Address2, b.City, b.State, b.PostalCode, b.Phone, b.IsTelehealth, b.Position, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *AdminContentHandler) DeleteLocation(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	tag, err := h.Pool.Exec(r.Context(), `DELETE FROM bt.locations WHERE id=$1`, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ─── Nav Items ────────────────────────────────────────────────────────────────

func (h *AdminContentHandler) ListNavItems(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, parent_id, label, href, position, location FROM bt.nav_items ORDER BY location, position`)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()
	type row struct {
		ID       int64   `json:"id"`
		ParentID *int64  `json:"parent_id"`
		Label    string  `json:"label"`
		Href     string  `json:"href"`
		Position int     `json:"position"`
		Location string  `json:"location"`
	}
	var items []row
	for rows.Next() {
		var v row
		if err := rows.Scan(&v.ID, &v.ParentID, &v.Label, &v.Href, &v.Position, &v.Location); err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		items = append(items, v)
	}
	if items == nil {
		items = []row{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"nav_items": items})
}

func (h *AdminContentHandler) UpsertNavItem(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	type body struct {
		ParentID *int64 `json:"parent_id"`
		Label    string `json:"label"`
		Href     string `json:"href"`
		Position int    `json:"position"`
		Location string `json:"location"`
	}
	var b body
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if idStr == "" {
		var id int64
		if err := h.Pool.QueryRow(r.Context(),
			`INSERT INTO bt.nav_items (parent_id, label, href, position, location)
			 VALUES ($1,$2,$3,$4,$5) RETURNING id`,
			b.ParentID, b.Label, b.Href, b.Position, b.Location,
		).Scan(&id); err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"id": id})
		return
	}
	id, _ := strconv.ParseInt(idStr, 10, 64)
	tag, err := h.Pool.Exec(r.Context(),
		`UPDATE bt.nav_items SET parent_id=$1, label=$2, href=$3, position=$4, location=$5 WHERE id=$6`,
		b.ParentID, b.Label, b.Href, b.Position, b.Location, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *AdminContentHandler) DeleteNavItem(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	tag, err := h.Pool.Exec(r.Context(), `DELETE FROM bt.nav_items WHERE id=$1`, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ─── Stats ────────────────────────────────────────────────────────────────────

func (h *AdminContentHandler) ListStats(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, label, value::text, suffix, position FROM bt.stats ORDER BY position`)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()
	type row struct {
		ID       int64   `json:"id"`
		Label    string  `json:"label"`
		Value    string  `json:"value"`
		Suffix   *string `json:"suffix"`
		Position int     `json:"position"`
	}
	var items []row
	for rows.Next() {
		var v row
		if err := rows.Scan(&v.ID, &v.Label, &v.Value, &v.Suffix, &v.Position); err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		items = append(items, v)
	}
	if items == nil {
		items = []row{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"stats": items})
}

func (h *AdminContentHandler) UpdateStat(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	type body struct {
		Label    string  `json:"label"`
		Value    string  `json:"value"`
		Suffix   *string `json:"suffix"`
		Position int     `json:"position"`
	}
	var b body
	if err := httpx.ReadJSON(w, r, &b); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	tag, err := h.Pool.Exec(r.Context(),
		`UPDATE bt.stats SET label=$1, value=$2::numeric, suffix=$3, position=$4 WHERE id=$5`,
		b.Label, b.Value, b.Suffix, b.Position, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
