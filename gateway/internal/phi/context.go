// context.go — actor propagation via context for PHI audit attribution.
//
// WithActor embeds the actor identity (admin email, service name, etc.) into
// the context so every PHI mutation in the call stack can attribute the audit
// row without passing the actor as an explicit parameter everywhere.
//
// The default when no actor is set is "system", which covers automated paths
// (cron jobs, internal service calls, AI agent writes).
package phi

import "context"

type actorCtxKey struct{}

// WithActor returns a child context carrying the given actor string.
// Middleware (RequireAdmin) calls this with the admin's email so every
// downstream Store mutation inherits it.
func WithActor(ctx context.Context, actor string) context.Context {
	return context.WithValue(ctx, actorCtxKey{}, actor)
}

// actorFromContext retrieves the actor from ctx. Returns "system" when no
// actor has been set — covers automated / non-admin call paths.
func actorFromContext(ctx context.Context) string {
	if a, ok := ctx.Value(actorCtxKey{}).(string); ok && a != "" {
		return a
	}
	return "system"
}
