// clinician_photo.go — upload + serve clinician avatar images.
//
//	POST /admin/api/clinicians/{slug}/photo   (RequireAdmin) — upload/replace
//	GET  /v1/clinicians/{slug}/photo           (public)       — serve bytes
//
// Photos are non-PHI public images. Bytes live in their own DDB item
// (SK=PHOTO#<slug>) so they never bloat roster/match list payloads. The
// upload does NOT require the clinician record to exist yet (so a brand-new
// clinician can have a photo uploaded before first save); when the record
// does exist, its photo_url is updated to the stable serve URL.
package handlers

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/match"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/go-chi/chi/v5"
)

// maxPhotoBytes caps the stored image. Kept under DynamoDB's 400 KB item limit
// (with headroom for keys/metadata). The admin UI resizes client-side first,
// so real uploads are far smaller; this is the server-side backstop.
const maxPhotoBytes = 350 * 1024

// allowedPhotoTypes is the set of accepted image content types.
var allowedPhotoTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
}

// ClinicianPhotoHandler serves + accepts clinician avatar images.
type ClinicianPhotoHandler struct {
	Photos     match.ClinicianPhotoStore
	Clinicians match.ClinicianStore
	PHI        *phi.Store // for admin.LogPHIAccess on upload
}

// Serve handles GET /v1/clinicians/{slug}/photo (public).
func (h *ClinicianPhotoHandler) Serve(w http.ResponseWriter, r *http.Request) {
	slug := strings.TrimSpace(chi.URLParam(r, "slug"))
	if slug == "" {
		http.NotFound(w, r)
		return
	}
	p, err := h.Photos.GetClinicianPhoto(r.Context(), slug)
	if err != nil {
		if errors.Is(err, match.ErrNotFound) {
			http.NotFound(w, r)
			return
		}
		slog.Error("clinician photo: serve", "slug", slug, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	ct := p.ContentType
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Length", strconv.Itoa(len(p.Data)))
	// Public, cacheable, but short TTL so a replacement shows up quickly. The
	// admin UI also appends ?v=<ts> for immediate cache-busting.
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(p.Data)
}

// Upload handles POST /admin/api/clinicians/{slug}/photo (RequireAdmin).
// Accepts the raw image bytes as the request body; Content-Type identifies the
// format. Returns { ok, photo_url } where photo_url is the stable serve path
// with a cache-busting version query.
func (h *ClinicianPhotoHandler) Upload(w http.ResponseWriter, r *http.Request) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	slug := strings.TrimSpace(chi.URLParam(r, "slug"))
	if slug == "" {
		httpx.WriteValidationError(w, "slug is required")
		return
	}

	ct := strings.ToLower(strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]))
	if !allowedPhotoTypes[ct] {
		httpx.WriteValidationError(w, "unsupported image type (use JPEG, PNG, or WebP)")
		return
	}

	// Read with a hard cap (one extra byte to detect overflow).
	data, err := io.ReadAll(io.LimitReader(r.Body, maxPhotoBytes+1))
	if err != nil {
		httpx.WriteValidationError(w, "could not read image")
		return
	}
	if len(data) == 0 {
		httpx.WriteValidationError(w, "empty image")
		return
	}
	if len(data) > maxPhotoBytes {
		httpx.WriteError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("image too large (max %d KB after resize)", maxPhotoBytes/1024))
		return
	}

	now := time.Now().UTC()
	if err := h.Photos.PutClinicianPhoto(r.Context(), slug, match.ClinicianPhoto{
		ContentType: ct,
		Data:        data,
		UpdatedAt:   now,
	}); err != nil {
		slog.Error("clinician photo: put", "slug", slug, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	photoURL := fmt.Sprintf("/v1/clinicians/%s/photo?v=%d", slug, now.UnixMilli())

	// If the clinician already exists, point its photo_url at the served image.
	// For a not-yet-saved clinician, the admin form holds the returned URL and
	// persists it on the next Save — so no update is needed here.
	if c, gerr := h.Clinicians.GetClinician(r.Context(), slug); gerr == nil {
		c.PhotoURL = photoURL
		c.UpdatedAt = now
		if perr := h.Clinicians.PutClinician(r.Context(), *c); perr != nil {
			slog.Error("clinician photo: update clinician url", "slug", slug, "err", perr)
			// Non-fatal: the bytes are stored and the URL is returned anyway.
		}
	}

	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "upload_clinician_photo", "clinician", slug)
	slog.Info("clinician photo uploaded", "slug", slug, "bytes", len(data), "admin", u.Email)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "photo_url": photoURL})
}
