'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export type AdminUser = { id: number; email: string; role: 'superadmin' | 'auditor' };

const TOKEN_KEY = 'bt_admin_token';
const USER_CACHE_KEY = 'bt_admin_user_v1';
const REVALIDATE_TS_KEY = 'bt_admin_revalidate_ts';
// Only re-fetch /auth/me at most once per minute per tab.
const REVALIDATE_INTERVAL_MS = 60_000;

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

// Gateway exposes admin endpoints under /admin/api/*. Existing call sites
// pass /admin/<thing>; rewrite to /admin/api/<thing> here so we don't have
// to touch every caller. (Only rewrites if /api/ isn't already there.)
function withAdminApi(path: string): string {
  if (path.startsWith('/admin/api/')) return path;
  if (path.startsWith('/admin/')) return '/admin/api/' + path.slice('/admin/'.length);
  return path;
}

export function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getStoredToken();
  return fetch(withAdminApi(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

function readCachedUser(): AdminUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as AdminUser) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(u: AdminUser): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(u)); } catch { /* quota */ }
}

function clearCachedUser(): void {
  if (typeof window === 'undefined') return;
  try { sessionStorage.removeItem(USER_CACHE_KEY); } catch { /* ignore */ }
}

export function useAdminAuth() {
  // Initial render MUST match SSR output (no sessionStorage / window access),
  // otherwise React throws a hydration mismatch. Start with user=null,
  // loading=true; hydrate from sessionStorage inside useEffect (client-only).
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      clearCachedUser();
      router.replace('/admin/login');
      return;
    }
    // Hydrate immediately from sessionStorage so the shell paints without
    // waiting for /auth/me. We revalidate in the background below — a stale
    // cache will be corrected, and a revoked token redirects to /login.
    const cached = readCachedUser();
    if (cached) {
      setUser(cached);
      setLoading(false);
    }
    // Skip the /auth/me revalidation if we already revalidated within the last
    // minute in this tab — avoids a redundant round-trip on every navigation
    // when the shell remounts (or on rapid back/forward).
    const lastTs = Number(sessionStorage.getItem(REVALIDATE_TS_KEY) ?? 0);
    if (cached && Date.now() - lastTs < REVALIDATE_INTERVAL_MS) {
      return;
    }
    fetch('/admin/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('unauthorized');
        return r.json();
      })
      .then((u: AdminUser) => {
        setUser(u);
        writeCachedUser(u);
        try { sessionStorage.setItem(REVALIDATE_TS_KEY, String(Date.now())); } catch { /* quota */ }
        setLoading(false);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        clearCachedUser();
        try { sessionStorage.removeItem(REVALIDATE_TS_KEY); } catch { /* ignore */ }
        setLoading(false);
        router.replace('/admin/login');
      });
  }, [router]);

  const logout = useCallback(async () => {
    const token = getStoredToken();
    if (token) {
      await fetch('/admin/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      localStorage.removeItem(TOKEN_KEY);
    }
    clearCachedUser();
    router.replace('/admin/login');
  }, [router]);

  return { user, loading, logout };
}
