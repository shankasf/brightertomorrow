'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export type AdminUser = { id: number; email: string; role: 'superadmin' | 'auditor' };

const TOKEN_KEY = 'bt_admin_token';

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

export function useAdminAuth() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      router.replace('/admin/login');
      return;
    }
    fetch('/admin/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('unauthorized');
        return r.json();
      })
      .then((u) => { setUser(u); setLoading(false); })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
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
    router.replace('/admin/login');
  }, [router]);

  return { user, loading, logout };
}
