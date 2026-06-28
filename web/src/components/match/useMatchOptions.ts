"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_MATCH_CONFIG, fetchMatchOptions } from "./api";
import type { MatchConfig } from "./types";

/**
 * Loads the quiz definition from /v1/match/options once and shares it across
 * the /get-scheduled stepper and the chat-widget inline quiz (DRY). On failure
 * it falls back to the built-in DEFAULT_MATCH_CONFIG so the quiz still renders.
 */
export function useMatchOptions(): {
  config: MatchConfig;
  loading: boolean;
  /** True when we're serving the built-in fallback (the fetch failed). */
  usingFallback: boolean;
  reload: () => void;
} {
  const [config, setConfig] = useState<MatchConfig>(DEFAULT_MATCH_CONFIG);
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;
    setLoading(true);
    fetchMatchOptions(ctrl.signal)
      .then((cfg) => {
        if (!alive) return;
        setConfig(cfg);
        setUsingFallback(false);
      })
      .catch(() => {
        if (!alive) return;
        // Keep the default config so the quiz still works.
        setConfig(DEFAULT_MATCH_CONFIG);
        setUsingFallback(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [nonce]);

  return { config, loading, usingFallback, reload };
}
