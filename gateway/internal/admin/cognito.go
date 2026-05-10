package admin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CognitoVerifier verifies Cognito-issued ID tokens against the user pool's JWKS.
//
// HIPAA §164.312(d): "Implement procedures to verify that a person or entity
// seeking access to electronic protected health information is the one claimed."
// Cognito enforces password policy + MFA; this code is the trust anchor that
// confirms the JWT we receive was actually minted by our pool.
type CognitoVerifier struct {
	UserPoolID string
	ClientID   string
	Region     string

	once  sync.Once
	jwks  keyfunc.Keyfunc
	jwErr error

	issuer string
}

func NewCognitoVerifier(region, userPoolID, clientID string) *CognitoVerifier {
	return &CognitoVerifier{
		Region:     region,
		UserPoolID: userPoolID,
		ClientID:   clientID,
		issuer:     fmt.Sprintf("https://cognito-idp.%s.amazonaws.com/%s", region, userPoolID),
	}
}

func (v *CognitoVerifier) jwksURL() string {
	return v.issuer + "/.well-known/jwks.json"
}

func (v *CognitoVerifier) keyfunc(ctx context.Context) (keyfunc.Keyfunc, error) {
	v.once.Do(func() {
		k, err := keyfunc.NewDefaultCtx(ctx, []string{v.jwksURL()})
		if err != nil {
			v.jwErr = fmt.Errorf("init jwks: %w", err)
			return
		}
		v.jwks = k
	})
	return v.jwks, v.jwErr
}

// CognitoClaims is the subset of Cognito ID-token claims we trust.
type CognitoClaims struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	TokenUse      string `json:"token_use"`
	jwt.RegisteredClaims
}

// Verify parses + validates the ID token. Returns the claims if everything checks out.
//
// Validation:
//   - signature against pool JWKS
//   - exp not past, iat reasonable
//   - iss == https://cognito-idp.<region>.amazonaws.com/<poolID>
//   - aud == app client ID
//   - token_use == "id"  (we only accept ID tokens, not access tokens)
//   - email_verified == true
func (v *CognitoVerifier) Verify(ctx context.Context, idToken string) (*CognitoClaims, error) {
	kf, err := v.keyfunc(ctx)
	if err != nil {
		return nil, err
	}
	claims := &CognitoClaims{}
	tok, err := jwt.ParseWithClaims(idToken, claims, kf.Keyfunc,
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(v.issuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, fmt.Errorf("verify token: %w", err)
	}
	if !tok.Valid {
		return nil, errors.New("token invalid")
	}
	if claims.TokenUse != "id" {
		return nil, fmt.Errorf("expected token_use=id, got %q", claims.TokenUse)
	}
	if claims.Audience == nil || len(claims.Audience) == 0 {
		return nil, errors.New("no audience")
	}
	audOK := false
	for _, a := range claims.Audience {
		if a == v.ClientID {
			audOK = true
			break
		}
	}
	if !audOK {
		return nil, fmt.Errorf("audience mismatch: %v", claims.Audience)
	}
	if !claims.EmailVerified {
		return nil, errors.New("email not verified")
	}
	if claims.Email == "" {
		return nil, errors.New("no email claim")
	}
	return claims, nil
}

// LookupOrRejectAdmin finds an admin record by email. Cognito-verified users
// must already exist in bt.admin_users (with `is_active=true`); we deliberately
// do NOT auto-provision so that role assignment is an explicit operator action.
func LookupAdminByEmail(ctx context.Context, pool *pgxpool.Pool, email string) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var u User
	var isActive bool
	err := pool.QueryRow(ctx,
		`SELECT id, email, role, is_active FROM bt.admin_users WHERE lower(email) = $1`,
		email,
	).Scan(&u.ID, &u.Email, &u.Role, &isActive)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if !isActive {
		return nil, ErrInactiveAccount
	}
	return &u, nil
}

// IssueSession mints a gateway session token for an already-authenticated user.
// Called from the Cognito exchange handler after JWT verification.
func IssueSession(ctx context.Context, pool *pgxpool.Pool, u *User, ipAddr, ua string) (string, error) {
	token, tokenHash, err := GenerateToken()
	if err != nil {
		return "", err
	}
	expiresAt := time.Now().Add(SessionTTL)
	if _, err := pool.Exec(ctx,
		`INSERT INTO bt.admin_sessions (admin_user_id, token_hash, expires_at, ip_address, user_agent)
		 VALUES ($1, $2, $3, $4::inet, $5)`,
		u.ID, tokenHash, expiresAt, ipAddr, ua); err != nil {
		return "", err
	}
	// Update last_login_at to keep session signal sources consistent with bcrypt path.
	_, _ = pool.Exec(ctx, `UPDATE bt.admin_users SET last_login_at = now() WHERE id = $1`, u.ID)
	return token, nil
}

// ExtractBearerFromHeader is a small helper used by the exchange handler.
func ExtractBearerFromHeader(r *http.Request) string {
	return ExtractBearerToken(r)
}
