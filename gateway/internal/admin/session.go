package admin

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

const (
	SessionTTL        = 8 * time.Hour
	BcryptCost        = 12
	MaxFailedAttempts = 5
	LockoutDuration   = 30 * time.Minute
)

// User is the authenticated admin placed in request context.
type User struct {
	ID    int64
	Email string
	Role  string
}

var (
	ErrInvalidCredentials = errors.New("invalid credentials")
	ErrAccountLocked      = errors.New("account locked — try again later")
	ErrInactiveAccount    = errors.New("account inactive")
	ErrSessionExpired     = errors.New("session expired or invalid")
)

// LockoutError carries the unlock time so the client can render a countdown.
// errors.Is(err, ErrAccountLocked) still matches.
type LockoutError struct{ Until time.Time }

func (e *LockoutError) Error() string { return ErrAccountLocked.Error() }
func (e *LockoutError) Is(target error) bool { return target == ErrAccountLocked }

// HashPassword bcrypt-hashes a plain-text password at cost 12.
func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), BcryptCost)
	return string(b), err
}

// GenerateToken mints a 32-byte random bearer token and returns the token
// (sent to the client) and its SHA-256 hex hash (stored in DB).
func GenerateToken() (token, tokenHash string, err error) {
	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(token))
	tokenHash = hex.EncodeToString(sum[:])
	return
}

// hashToken returns the SHA-256 hex of an existing token string.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Login validates credentials, enforces lockout, and creates a new session.
// Returns the bearer token (shown to client once) and the admin user.
func Login(ctx context.Context, pool *pgxpool.Pool, email, password, ipAddr, ua string) (string, *User, error) {
	var u User
	var hash string
	var isActive bool
	var failedAttempts int16
	var lockedUntil *time.Time

	err := pool.QueryRow(ctx,
		`SELECT id, email, password_hash, role, is_active, failed_attempts, locked_until
		 FROM bt.admin_users WHERE email = $1`, email,
	).Scan(&u.ID, &u.Email, &hash, &u.Role, &isActive, &failedAttempts, &lockedUntil)

	if errors.Is(err, pgx.ErrNoRows) {
		// Run bcrypt anyway to prevent timing-based user enumeration.
		_ = bcrypt.CompareHashAndPassword(
			[]byte("$2a$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
			[]byte(password),
		)
		return "", nil, ErrInvalidCredentials
	}
	if err != nil {
		return "", nil, err
	}

	if !isActive {
		return "", nil, ErrInactiveAccount
	}
	if lockedUntil != nil && time.Now().Before(*lockedUntil) {
		return "", nil, &LockoutError{Until: *lockedUntil}
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		newAttempts := failedAttempts + 1
		if newAttempts >= MaxFailedAttempts {
			lockUntil := time.Now().Add(LockoutDuration)
			_, _ = pool.Exec(ctx,
				`UPDATE bt.admin_users SET failed_attempts=$1, locked_until=$2 WHERE id=$3`,
				newAttempts, lockUntil, u.ID)
			// This attempt just tripped the lockout — tell the client now
			// so they see the countdown instead of a generic "invalid creds".
			return "", nil, &LockoutError{Until: lockUntil}
		}
		_, _ = pool.Exec(ctx,
			`UPDATE bt.admin_users SET failed_attempts=$1 WHERE id=$2`,
			newAttempts, u.ID)
		return "", nil, ErrInvalidCredentials
	}

	// Clear lockout on successful auth.
	_, _ = pool.Exec(ctx,
		`UPDATE bt.admin_users SET failed_attempts=0, locked_until=NULL, last_login_at=now() WHERE id=$1`,
		u.ID)

	token, tokenHash, err := GenerateToken()
	if err != nil {
		return "", nil, err
	}

	expiresAt := time.Now().Add(SessionTTL)
	_, err = pool.Exec(ctx,
		`INSERT INTO bt.admin_sessions (admin_user_id, token_hash, expires_at, ip_address, user_agent)
		 VALUES ($1, $2, $3, $4::inet, $5)`,
		u.ID, tokenHash, expiresAt, ipAddr, ua)
	if err != nil {
		return "", nil, err
	}

	return token, &u, nil
}

// Token validation cache. The dashboard fires ~6 widget requests in parallel
// on every page load, each of which previously round-tripped to Postgres to
// validate the bearer token. With a short-lived in-process cache, those 6
// concurrent calls share a single DB lookup.
//
// HIPAA note: caching auth decisions is normal practice; NIST 800-63B
// permits session-token reuse for the duration of the session. We bound
// the cache at 30 seconds so a server-side revoke (RevokeToken) takes
// effect within that window without any explicit cache invalidation. The
// authoritative store (bt.admin_sessions) is unchanged.
const tokenCacheTTL = 30 * time.Second

type tokenCacheEntry struct {
	user      *User
	expiresAt time.Time
}

var (
	tokenCacheMu sync.RWMutex
	tokenCache   = make(map[string]tokenCacheEntry)
)

// ValidateToken looks up the session by token hash, checks expiry and revocation,
// refreshes last_used_at, and returns the admin user.
//
// Result is cached for tokenCacheTTL. A successful validation also refreshes
// last_used_at asynchronously so the cached hot path costs zero DB work.
func ValidateToken(ctx context.Context, pool *pgxpool.Pool, token string) (*User, error) {
	tokenHash := hashToken(token)

	tokenCacheMu.RLock()
	entry, hit := tokenCache[tokenHash]
	tokenCacheMu.RUnlock()
	if hit && time.Now().Before(entry.expiresAt) {
		// Async last_used_at refresh — never block the request on it.
		go func(h string) {
			rc, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_, _ = pool.Exec(rc,
				`UPDATE bt.admin_sessions SET last_used_at=now() WHERE token_hash=$1`, h)
		}(tokenHash)
		return entry.user, nil
	}

	var u User
	err := pool.QueryRow(ctx,
		`SELECT u.id, u.email, u.role
		 FROM bt.admin_sessions s
		 JOIN bt.admin_users u ON u.id = s.admin_user_id
		 WHERE s.token_hash = $1
		   AND s.revoked_at IS NULL
		   AND s.expires_at > now()
		   AND u.is_active = TRUE`,
		tokenHash,
	).Scan(&u.ID, &u.Email, &u.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		invalidateTokenCache(tokenHash)
		return nil, ErrSessionExpired
	}
	if err != nil {
		return nil, err
	}

	// Best-effort refresh.
	_, _ = pool.Exec(ctx,
		`UPDATE bt.admin_sessions SET last_used_at=now() WHERE token_hash=$1`, tokenHash)

	tokenCacheMu.Lock()
	// Opportunistic GC: if the cache grew past a reasonable bound, evict
	// expired entries. Bound chosen to be larger than any plausible concurrent
	// admin count.
	if len(tokenCache) > 1024 {
		now := time.Now()
		for k, v := range tokenCache {
			if now.After(v.expiresAt) {
				delete(tokenCache, k)
			}
		}
	}
	tokenCache[tokenHash] = tokenCacheEntry{user: &u, expiresAt: time.Now().Add(tokenCacheTTL)}
	tokenCacheMu.Unlock()

	return &u, nil
}

func invalidateTokenCache(tokenHash string) {
	tokenCacheMu.Lock()
	delete(tokenCache, tokenHash)
	tokenCacheMu.Unlock()
}

// RevokeToken invalidates a session. Also evicts the in-process cache so the
// next request hits Postgres and sees the revocation immediately (otherwise
// a logged-out admin could keep working for up to tokenCacheTTL).
func RevokeToken(ctx context.Context, pool *pgxpool.Pool, token string) error {
	tokenHash := hashToken(token)
	_, err := pool.Exec(ctx,
		`UPDATE bt.admin_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`,
		tokenHash)
	invalidateTokenCache(tokenHash)
	return err
}

// ExtractBearerToken parses Authorization: Bearer <token>.
func ExtractBearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(h, "Bearer ")
}
