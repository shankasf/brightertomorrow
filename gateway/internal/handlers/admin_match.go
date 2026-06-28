// admin_match.go — admin CRUD for the therapist-match feature.
//
// Routes (all under /admin/api, behind RequireAdmin):
//
//	GET    /admin/api/clinicians                 → { items:[Clinician], total }
//	POST   /admin/api/clinicians                 → create; body = clinicianInput
//	PUT    /admin/api/clinicians/{slug}          → full replace
//	DELETE /admin/api/clinicians/{slug}          → soft-delete (active=false)
//	GET    /admin/api/match-config               → { config }
//	PUT    /admin/api/match-config               → { config } replace
//	GET    /admin/api/match-stats?from=&to=      → aggregated stats
//
// Every mutation calls admin.LogPHIAccess for the HIPAA audit trail.
// Clinician data is non-PHI (public info) but we audit admin mutations
// to maintain a complete admin activity record per §164.312(b).
package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/match"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/go-chi/chi/v5"
)

// AdminMatchHandler handles all admin match-feature endpoints.
type AdminMatchHandler struct {
	Clinicians match.ClinicianStore
	Config     match.MatchConfigStore
	Events     match.MatchEventStore
	PHI        *phi.Store // for admin.LogPHIAccess audit rows
}

// ─── Clinicians ─────────────────────────────────────────────────────────────

// ListClinicians handles GET /admin/api/clinicians.
// Returns all clinicians (including inactive) sorted by sort_order.
func (h *AdminMatchHandler) ListClinicians(w http.ResponseWriter, r *http.Request) {
	clinicians, err := h.Clinicians.ListClinicians(r.Context(), false)
	if err != nil {
		slog.Error("admin/clinicians list", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	// Sort by sort_order asc (all-clinicians query from main table is unordered).
	sort.Slice(clinicians, func(i, j int) bool {
		return clinicians[i].SortOrder < clinicians[j].SortOrder
	})
	if clinicians == nil {
		clinicians = []match.Clinician{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"items": clinicians,
		"total": len(clinicians),
	})
}

// clinicianInput is the accepted JSON shape for create / update.
// created_at is server-managed (not accepted from client; decoded but ignored).
type clinicianInput struct {
	Slug        string   `json:"slug"`
	Name        string   `json:"name"`
	Credentials string   `json:"credentials"`
	Initials    string   `json:"initials"`
	Types       []string `json:"types"`
	Locations   []string `json:"locations"`
	Telehealth  bool     `json:"telehealth"`
	Specialties []string `json:"specialties"`
	Rate        string   `json:"rate"`
	InNetwork   bool     `json:"in_network"`
	StaffID     int      `json:"staff_id"`
	PhotoURL    string   `json:"photo_url"`
	Active      bool     `json:"active"`
	SortOrder   int      `json:"sort_order"`
}

func (b *clinicianInput) toMatchClinician(createdAt time.Time) match.Clinician {
	now := time.Now().UTC()
	if createdAt.IsZero() {
		createdAt = now
	}
	return match.Clinician{
		Slug:        strings.TrimSpace(b.Slug),
		Name:        strings.TrimSpace(b.Name),
		Credentials: strings.TrimSpace(b.Credentials),
		Initials:    strings.TrimSpace(b.Initials),
		Types:       normalizeStrSlice(b.Types),
		Locations:   normalizeStrSlice(b.Locations),
		Telehealth:  b.Telehealth,
		Specialties: normalizeStrSlice(b.Specialties),
		Rate:        strings.TrimSpace(b.Rate),
		InNetwork:   b.InNetwork,
		StaffID:     b.StaffID,
		PhotoURL:    strings.TrimSpace(b.PhotoURL),
		Active:      b.Active,
		SortOrder:   b.SortOrder,
		CreatedAt:   createdAt,
		UpdatedAt:   now,
	}
}

func normalizeStrSlice(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func (b *clinicianInput) validate() string {
	if strings.TrimSpace(b.Slug) == "" {
		return "slug is required"
	}
	if strings.TrimSpace(b.Name) == "" {
		return "name is required"
	}
	if len(b.Types) == 0 {
		return "at least one type is required"
	}
	return ""
}

// CreateClinician handles POST /admin/api/clinicians.
func (h *AdminMatchHandler) CreateClinician(w http.ResponseWriter, r *http.Request) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var body clinicianInput
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if msg := body.validate(); msg != "" {
		httpx.WriteValidationError(w, msg)
		return
	}
	slug := strings.TrimSpace(body.Slug)

	// Check for duplicate slug.
	if _, err := h.Clinicians.GetClinician(r.Context(), slug); err == nil {
		httpx.WriteError(w, http.StatusConflict, "clinician with that slug already exists")
		return
	} else if !errors.Is(err, match.ErrNotFound) {
		slog.Error("admin/clinicians create: get check", "slug", slug, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	c := body.toMatchClinician(time.Time{})
	if err := h.Clinicians.PutClinician(r.Context(), c); err != nil {
		slog.Error("admin/clinicians create: put", "slug", slug, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "create_clinician", "clinician", slug)
	slog.Info("admin/clinicians create", "slug", slug, "admin", u.Email)
	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"ok": true, "slug": slug})
}

// UpdateClinician handles PUT /admin/api/clinicians/{slug}.
func (h *AdminMatchHandler) UpdateClinician(w http.ResponseWriter, r *http.Request) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	slug := chi.URLParam(r, "slug")

	// Must exist.
	existing, err := h.Clinicians.GetClinician(r.Context(), slug)
	if err != nil {
		if errors.Is(err, match.ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "clinician not found")
			return
		}
		slog.Error("admin/clinicians update: get", "slug", slug, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	var body clinicianInput
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	// Force the slug to the URL param (ignore body's slug).
	body.Slug = slug
	if msg := body.validate(); msg != "" {
		httpx.WriteValidationError(w, msg)
		return
	}

	c := body.toMatchClinician(existing.CreatedAt)
	if err := h.Clinicians.PutClinician(r.Context(), c); err != nil {
		slog.Error("admin/clinicians update: put", "slug", slug, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "update_clinician", "clinician", slug)
	slog.Info("admin/clinicians update", "slug", slug, "admin", u.Email)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// DeleteClinician handles DELETE /admin/api/clinicians/{slug}.
// Soft-delete: sets active=false. The record is preserved in DDB.
func (h *AdminMatchHandler) DeleteClinician(w http.ResponseWriter, r *http.Request) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	slug := chi.URLParam(r, "slug")

	existing, err := h.Clinicians.GetClinician(r.Context(), slug)
	if err != nil {
		if errors.Is(err, match.ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "clinician not found")
			return
		}
		slog.Error("admin/clinicians delete: get", "slug", slug, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	existing.Active = false
	existing.UpdatedAt = time.Now().UTC()
	if err := h.Clinicians.PutClinician(r.Context(), *existing); err != nil {
		slog.Error("admin/clinicians delete: put", "slug", slug, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "deactivate_clinician", "clinician", slug)
	slog.Info("admin/clinicians deactivate", "slug", slug, "admin", u.Email)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ─── MatchConfig ─────────────────────────────────────────────────────────────

// GetMatchConfig handles GET /admin/api/match-config.
func (h *AdminMatchHandler) GetMatchConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.Config.GetMatchConfig(r.Context())
	if err != nil {
		if errors.Is(err, match.ErrNotFound) {
			def := match.DefaultConfig
			cfg = &def
		} else {
			slog.Error("admin/match-config get", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"config": cfg})
}

type putMatchConfigReq struct {
	Config match.MatchConfig `json:"config"`
}

// PutMatchConfig handles PUT /admin/api/match-config.
func (h *AdminMatchHandler) PutMatchConfig(w http.ResponseWriter, r *http.Request) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var body putMatchConfigReq
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if len(body.Config.Questions) == 0 {
		httpx.WriteValidationError(w, "config.questions must not be empty")
		return
	}

	body.Config.UpdatedAt = time.Now().UTC()
	if err := h.Config.PutMatchConfig(r.Context(), body.Config); err != nil {
		slog.Error("admin/match-config put", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "update_match_config", "match_config", "current")
	slog.Info("admin/match-config updated", "admin", u.Email)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ─── MatchStats ──────────────────────────────────────────────────────────────

type matchStatsResp struct {
	Total            int            `json:"total"`
	ByType           map[string]int `json:"by_type"`
	ByModality       map[string]int `json:"by_modality"`
	ByLocation       map[string]int `json:"by_location"`
	ByInsurance      map[string]int `json:"by_insurance"`
	NoResultCount    int            `json:"no_result_count"`
	PickThroughCount int            `json:"pick_through_count"`
	TopPicked        []pickedEntry  `json:"top_picked"`
}

type pickedEntry struct {
	Slug  string `json:"slug"`
	Count int    `json:"count"`
}

// GetMatchStats handles GET /admin/api/match-stats?from=YYYY-MM-DD&to=YYYY-MM-DD.
// Date range is inclusive. Defaults: last 30 days.
func (h *AdminMatchHandler) GetMatchStats(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC()
	from, to := now.AddDate(0, 0, -30), now

	if fromStr := r.URL.Query().Get("from"); fromStr != "" {
		if t, err := time.Parse("2006-01-02", fromStr); err == nil {
			from = t.UTC()
		}
	}
	if toStr := r.URL.Query().Get("to"); toStr != "" {
		if t, err := time.Parse("2006-01-02", toStr); err == nil {
			// to is end-of-day inclusive
			to = t.UTC().Add(24*time.Hour - time.Nanosecond)
		}
	}

	events, err := h.Events.ListMatchEvents(r.Context(), from, to)
	if err != nil {
		slog.Error("admin/match-stats: list events", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	resp := matchStatsResp{
		ByType:      make(map[string]int),
		ByModality:  make(map[string]int),
		ByLocation:  make(map[string]int),
		ByInsurance: make(map[string]int),
		TopPicked:   []pickedEntry{},
	}
	pickedCounts := make(map[string]int)

	for _, e := range events {
		resp.Total++
		if e.Answers.Type != "" {
			resp.ByType[e.Answers.Type]++
		}
		if e.Answers.Modality != "" {
			resp.ByModality[e.Answers.Modality]++
		}
		if e.Answers.Location != "" {
			resp.ByLocation[e.Answers.Location]++
		}
		if e.Answers.Insurance != "" {
			resp.ByInsurance[e.Answers.Insurance]++
		}
		if e.ResultCount == 0 {
			resp.NoResultCount++
		}
		if e.PickedSlug != "" {
			resp.PickThroughCount++
			pickedCounts[e.PickedSlug]++
		}
	}

	// Build sorted top_picked (descending by count).
	for slug, cnt := range pickedCounts {
		resp.TopPicked = append(resp.TopPicked, pickedEntry{Slug: slug, Count: cnt})
	}
	sort.Slice(resp.TopPicked, func(i, j int) bool {
		if resp.TopPicked[i].Count != resp.TopPicked[j].Count {
			return resp.TopPicked[i].Count > resp.TopPicked[j].Count
		}
		return resp.TopPicked[i].Slug < resp.TopPicked[j].Slug
	})

	httpx.WriteJSON(w, http.StatusOK, resp)
}
