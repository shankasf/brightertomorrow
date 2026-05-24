/**
 * Frontend logger — batched POST to /v1/frontend-logs.
 *
 * Logs go through the gateway, get tagged service="frontend", and land in
 * S3 alongside backend/AI logs (queryable from /admin/logs).
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('user clicked book', { therapistId, slot });
 *   logger.error('failed to load page', { url, status });
 *
 * Properties:
 *   - Each entry gets a UUID `log_id` (crypto.randomUUID).
 *   - Buffer flushes on: 5s interval, 25-entry threshold, page unload (sendBeacon).
 *   - Silently swallows errors — logging must NEVER break the user's flow.
 *   - SSR-safe (all browser-only globals are guarded).
 */
'use client';

type Level = 'debug' | 'info' | 'warn' | 'error';

type LogEntry = {
  log_id: string;
  ts: string; // RFC3339
  level: Level;
  message: string;
  logger?: string;
  session_id?: string;
  url?: string;
  user_agent?: string;
  attrs?: Record<string, unknown>;
};

const ENDPOINT = '/v1/frontend-logs';
const FLUSH_MS = 5000;
const FLUSH_THRESHOLD = 25;
const MAX_BUFFER = 200; // drop oldest if SPA forgets to flush

let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function uuid(): string {
  if (isBrowser() && typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for very old browsers — unlikely to trigger.
  return 'frontend-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_MS);
}

async function flush(): Promise<void> {
  if (buffer.length === 0 || !isBrowser()) return;
  const payload = buffer.slice();
  buffer = [];
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs: payload }),
      keepalive: true, // survives navigation if browser supports it
    });
  } catch {
    // Best-effort. Drop on failure rather than retry — retries amplify
    // problems during outages. The browser console still has the line if
    // the dev needs it.
  }
}

function flushBeacon(): void {
  if (buffer.length === 0 || !isBrowser()) return;
  const payload = buffer.slice();
  buffer = [];
  // sendBeacon is fire-and-forget; perfect for visibilitychange/pagehide.
  const ok = navigator.sendBeacon?.(
    ENDPOINT,
    new Blob([JSON.stringify({ logs: payload })], { type: 'application/json' }),
  );
  if (!ok) {
    // Fallback to fetch with keepalive — rarely needed.
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logs: payload }),
      keepalive: true,
    }).catch(() => undefined);
  }
}

function installHandlersOnce(): void {
  if (installed || !isBrowser()) return;
  installed = true;
  // Flush on tab hide / page unload so we don't lose the last 5s.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushBeacon();
  });
  window.addEventListener('pagehide', flushBeacon);

  // Auto-capture uncaught errors. Browsers fire 'error' for sync exceptions
  // and 'unhandledrejection' for promise rejections — both are user-facing
  // failures worth a log line.
  window.addEventListener('error', (ev) => {
    enqueue({
      level: 'error',
      message: ev.message || 'uncaught error',
      logger: 'window.onerror',
      attrs: {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
        stack: ev.error?.stack,
      },
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    enqueue({
      level: 'error',
      message:
        ev.reason instanceof Error ? ev.reason.message : String(ev.reason ?? 'unhandled rejection'),
      logger: 'unhandledrejection',
      attrs: {
        stack: ev.reason instanceof Error ? ev.reason.stack : undefined,
      },
    });
  });
}

function enqueue(input: {
  level: Level;
  message: string;
  logger?: string;
  attrs?: Record<string, unknown>;
}): void {
  if (!isBrowser()) return;
  installHandlersOnce();

  const entry: LogEntry = {
    log_id: uuid(),
    ts: new Date().toISOString(),
    level: input.level,
    message: input.message,
    logger: input.logger,
    url: window.location.href,
    user_agent: navigator.userAgent,
    attrs: input.attrs,
  };
  buffer.push(entry);
  if (buffer.length > MAX_BUFFER) {
    buffer.splice(0, buffer.length - MAX_BUFFER);
  }
  if (buffer.length >= FLUSH_THRESHOLD) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flush();
    return;
  }
  scheduleFlush();
}

/**
 * Install error/rejection listeners eagerly. Call from a top-level client
 * component so uncaught errors are captured even before any explicit
 * logger.info() call.
 */
export function initLogger(): void {
  installHandlersOnce();
}

export const logger = {
  debug(message: string, attrs?: Record<string, unknown>): void {
    enqueue({ level: 'debug', message, attrs });
  },
  info(message: string, attrs?: Record<string, unknown>): void {
    enqueue({ level: 'info', message, attrs });
  },
  warn(message: string, attrs?: Record<string, unknown>): void {
    enqueue({ level: 'warn', message, attrs });
  },
  error(message: string, attrs?: Record<string, unknown>): void {
    enqueue({ level: 'error', message, attrs });
  },
  /** Force-flush — useful in tests or before known navigation. */
  async flush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flush();
  },
};
