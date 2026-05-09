'use client';
import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const TOKEN_KEY = 'bt_admin_token';

type Lockout = { until: number; reason: string };

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockout, setLockout] = useState<Lockout | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const router = useRouter();

  // Tick once a second while a lockout is active so the countdown updates.
  useEffect(() => {
    if (!lockout) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockout]);

  // Auto-clear the lockout state when the timer expires.
  useEffect(() => {
    if (lockout && now >= lockout.until) setLockout(null);
  }, [lockout, now]);

  const remainingMs = lockout ? Math.max(0, lockout.until - now) : 0;
  const isLocked = remainingMs > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isLocked) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/admin/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      // The IP rate limiter (httprate) returns 429 with plain-text body, so
      // res.json() can throw. Read text first and try to parse.
      const raw = await res.text();
      let data: Record<string, unknown> = {};
      try { data = raw ? JSON.parse(raw) : {}; } catch { /* non-JSON */ }

      if (!res.ok) {
        if (data.error === 'account_locked' && typeof data.locked_until === 'string') {
          const until = Date.parse(data.locked_until);
          setLockout({
            until,
            reason: typeof data.reason === 'string'
              ? data.reason
              : 'Account temporarily locked. Try again later.',
          });
          setError('');
        } else if (res.status === 429) {
          setError('Too many sign-in attempts from your network. Please wait about a minute and try again.');
        } else {
          setError(typeof data.error === 'string' ? data.error : 'Sign-in failed');
        }
        return;
      }

      localStorage.setItem(TOKEN_KEY, data.token as string);
      router.replace('/admin');
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-xl font-bold text-white">Brighter Tomorrow</h1>
          <p className="text-gray-400 text-sm mt-1">Admin Dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              disabled={isLocked}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={isLocked}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {isLocked && lockout && (
            <div className="bg-amber-950/60 border border-amber-700/60 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 text-amber-300 text-sm font-semibold">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Account temporarily locked
              </div>
              <p className="text-amber-200/85 text-[12.5px] leading-relaxed">
                {lockout.reason}
              </p>
              <div className="flex items-center justify-between pt-1">
                <span className="text-amber-300/80 text-xs">Try again in</span>
                <span className="font-mono tabular-nums text-amber-100 text-base font-semibold">
                  {formatRemaining(remainingMs)}
                </span>
              </div>
              <p className="text-amber-300/60 text-[11px]">
                Unlocks at {new Date(lockout.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
              </p>
            </div>
          )}

          {!isLocked && error && (
            <div className="text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || isLocked}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            {isLocked
              ? `Locked — ${formatRemaining(remainingMs)}`
              : loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-600 mt-4">
          Protected under HIPAA §164.312 — unauthorized access is prohibited
        </p>
      </div>
    </div>
  );
}
