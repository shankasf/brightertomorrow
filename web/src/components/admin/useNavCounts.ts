'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from './useAdminAuth';

export type NavCounts = Record<string, number>;

// Poll cadence for the sidebar badges. The gateway caches counts for 20s and
// the endpoint is excluded from the audit log, so a 60s client poll is cheap.
const POLL_MS = 60_000;

/**
 * Fetches per-section unread counts for the admin sidebar badges and keeps them
 * fresh (timer + on tab-refocus). `markSeen(section)` optimistically clears a
 * badge and tells the gateway the admin opened that section.
 */
export function useNavCounts(enabled: boolean) {
  const [counts, setCounts] = useState<NavCounts>({});
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const r = await adminFetch('/admin/notifications/counts');
      if (!r.ok) return;
      const data = await r.json();
      if (mounted.current && data && typeof data.counts === 'object') {
        setCounts(data.counts as NavCounts);
      }
    } catch {
      /* transient — keep the last good counts */
    }
  }, []);

  const markSeen = useCallback(async (section: string) => {
    // Optimistically clear so the badge disappears the instant you open the
    // section, without waiting for the round-trip.
    setCounts((c) => (c[section] ? { ...c, [section]: 0 } : c));
    try {
      await adminFetch('/admin/notifications/seen', {
        method: 'POST',
        body: JSON.stringify({ section }),
      });
    } catch {
      /* best-effort — the next poll will reconcile */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) return undefined;
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, refresh]);

  return { counts, refresh, markSeen };
}
