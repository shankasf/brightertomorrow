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
		return "", nil, ErrAccountLocked
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		newAttempts := failedAttempts + 1
		if newAttempts >= MaxFailedAttempts {
			lockUntil := time.Now().Add(LockoutDuration)
			_, _ = pool.Exec(ctx,
				`UPDATE bt.admin_users SET failed_attempts=$1, locked_until=$2 WHERE id=$3`,
				newAttempts, lockUntil, u.ID)
		} else {
			_, _ = pool.Exec(ctx,
				`UPDATE bt.admin_users SET failed_attempts=$1 WHERE id=$2`,
				newAttempts, u.ID)
		}
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

// ValidateToken looks up the session by token hash, checks expiry and revocation,
// refreshes last_used_at, and returns the admin user.
func ValidateToken(ctx context.Context, pool *pgxpool.Pool, token string) (*User, error) {
	tokenHash := hashToken(token)

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
		return nil, ErrSessionExpired
	}
	if err != nil {
		return nil, err
	}

	// Best-effort refresh.
	_, _ = pool.Exec(ctx,
		`UPDATE bt.admin_sessions SET last_used_at=now() WHERE token_hash=$1`, tokenHash)

	return &u, nil
}

// RevokeToken invalidates a session.
func RevokeToken(ctx context.Context, pool *pgxpool.Pool, token string) error {
	tokenHash := hashToken(token)
	_, err := pool.Exec(ctx,
		`UPDATE bt.admin_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`,
		tokenHash)
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
