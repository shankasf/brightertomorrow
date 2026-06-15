'use client';
import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import type { CognitoUser } from 'amazon-cognito-identity-js';
import { InlineSpinner, BTMark } from '@/components/admin/Spinner';

// Lazy-loaded heavy deps. `amazon-cognito-identity-js` (~50KB gz) is only
// needed once the user submits the email/password form; `qrcode` (~30KB
// gz) is only needed in the MFA-setup stage. Importing them at module
// scope put 80KB+ on the critical path of every /admin/login render.
type CognitoModule = typeof import('@/lib/admin-cognito');
let cognitoModulePromise: Promise<CognitoModule> | null = null;
function loadCognito(): Promise<CognitoModule> {
  if (!cognitoModulePromise) {
    cognitoModulePromise = import('@/lib/admin-cognito');
  }
  return cognitoModulePromise;
}

const TOKEN_KEY = 'bt_admin_token';

type Stage = 'email' | 'newPassword' | 'mfaSetup' | 'mfa' | 'forgot' | 'reset';

export default function AdminLoginPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetDestination, setResetDestination] = useState('');
  const [totp, setTotp] = useState('');
  const [pending, setPending] = useState<CognitoUser | null>(null);
  const [mfaQr, setMfaQr] = useState('');
  const [mfaQrImage, setMfaQrImage] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    // Load Cognito on idle so the configuration check is ready by the time
    // the user starts typing, without blocking initial paint.
    let cancelled = false;
    loadCognito()
      .then((m) => { if (!cancelled) setConfigured(m.isCognitoConfigured()); })
      .catch(() => { if (!cancelled) setConfigured(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!mfaQr) { setMfaQrImage(''); return; }
    let cancelled = false;
    import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(mfaQr, {
          width: 200,
          margin: 1,
          color: { dark: '#192735', light: '#ffffff' },
        }),
      )
      .then((url) => { if (!cancelled) setMfaQrImage(url); })
      .catch(() => { if (!cancelled) setMfaQrImage(''); });
    return () => { cancelled = true; };
  }, [mfaQr]);

  async function finishWithSession(idToken: string) {
    const m = await loadCognito();
    const { token } = await m.exchangeForGatewayToken(idToken);
    localStorage.setItem(TOKEN_KEY, token);
    router.replace('/admin');
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setError(''); setInfo('');
    setBusy(true);
    try {
      const m = await loadCognito();
      const result = await m.startLogin(email, password);
      if (result.kind === 'success') {
        await finishWithSession(result.session.getIdToken().getJwtToken());
      } else if (result.kind === 'newPassword') {
        setPending(result.user);
        setStage('newPassword');
      } else if (result.kind === 'mfaSetup') {
        setPending(result.user);
        setMfaQr(result.qr);
        setMfaSecret(result.secret);
        setStage('mfaSetup');
      } else if (result.kind === 'mfa') {
        setPending(result.user);
        setStage('mfa');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function onNewPassword(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setError('');
    setBusy(true);
    try {
      const m = await loadCognito();
      const session = await m.completeNewPassword(pending, newPassword);
      await finishWithSession(session.getIdToken().getJwtToken());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('TOTP')) {
        const m = await loadCognito();
        const r = await m.startLogin(email, newPassword);
        if (r.kind === 'mfaSetup') {
          setPending(r.user);
          setMfaQr(r.qr);
          setMfaSecret(r.secret);
          setStage('mfaSetup');
        } else if (r.kind === 'mfa') {
          // Admin already has a TOTP device enrolled — go straight to the code prompt.
          setPending(r.user);
          setStage('mfa');
        } else if (r.kind === 'success') {
          await finishWithSession(r.session.getIdToken().getJwtToken());
        } else {
          // newPassword again or any unexpected state — don't strand the user.
          setError('Could not continue sign-in. Please sign in again.');
          setStage('email');
        }
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyMfaSetup(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setError('');
    setBusy(true);
    try {
      const m = await loadCognito();
      const session = await m.verifyTotpSetup(pending, totp);
      await finishWithSession(session.getIdToken().getJwtToken());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  async function onMfa(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setError('');
    setBusy(true);
    try {
      const m = await loadCognito();
      const session = await m.submitTotp(pending, totp);
      await finishWithSession(session.getIdToken().getJwtToken());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  async function onForgot(e: FormEvent) {
    e.preventDefault();
    setError(''); setInfo('');
    setBusy(true);
    try {
      const m = await loadCognito();
      const { destination } = await m.requestPasswordReset(email);
      setResetDestination(destination ?? '');
      setStage('reset');
      setInfo(`We sent a verification code${destination ? ` to ${destination}` : ''}.`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send reset code');
    } finally {
      setBusy(false);
    }
  }

  async function onReset(e: FormEvent) {
    e.preventDefault();
    setError(''); setInfo('');
    setBusy(true);
    try {
      const m = await loadCognito();
      await m.confirmPasswordReset(email, resetCode, newPassword);
      setStage('email');
      setPassword('');
      setNewPassword('');
      setResetCode('');
      setInfo('Password updated. Sign in with your new password.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  const stageTitle: Record<Stage, string> = {
    email: 'Welcome back',
    newPassword: 'Set a new password',
    mfaSetup: 'Set up authenticator',
    mfa: 'Two-factor verification',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
  };
  const stageSub: Record<Stage, string> = {
    email: 'Sign in to manage the practice.',
    newPassword: 'At least 14 characters with upper, lower, digit, and a symbol.',
    mfaSetup: 'Scan the QR with Google Authenticator, then enter the 6-digit code.',
    mfa: 'Open Google Authenticator and enter the current code.',
    forgot: 'Enter your email and we\'ll send a verification code.',
    reset: 'Enter the code from your email and choose a new password.',
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-cream-alt text-ink">
      <div className="relative grid min-h-screen lg:grid-cols-2">
        {/* ────── Left: Brand showcase ────── */}
        <BrandPanel />

        {/* ────── Right: Form ────── */}
        <div className="relative flex min-h-screen items-center justify-center bg-cream-alt p-6 sm:p-10">
          {/* Subtle warm ambient on right too */}
          <div className="pointer-events-none absolute -top-40 right-0 h-[28rem] w-[28rem] rounded-full bg-brand/15 blur-[120px]" />
          <div className="pointer-events-none absolute -bottom-32 -left-10 h-[22rem] w-[22rem] rounded-full bg-[#FFBC7D]/15 blur-[120px]" />

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 w-full max-w-md"
          >
            {/* Mobile brand line (lg+ shows the panel instead) */}
            <div className="mb-7 flex items-center gap-2.5 lg:hidden">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-[#cf9e57] shadow-[0_6px_20px_rgba(225,184,120,0.45)]">
                <BTMark size={22} />
              </div>
              <div className="leading-tight">
                <div className="serif text-[15px] font-bold tracking-tight text-ink">Brighter Tomorrow</div>
                <div className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-brand-700">Admin Console</div>
              </div>
            </div>

            <div className="rounded-3xl border border-[#E5E5E5] bg-white p-7 sm:p-8 shadow-[0_30px_80px_-30px_rgba(25,39,53,0.18)]">
              {/* Header */}
              <div className="mb-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="serif text-2xl font-bold tracking-tight text-ink">{stageTitle[stage]}</h2>
                  <StageDots stage={stage} />
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{stageSub[stage]}</p>
              </div>

              {/* Config warning — shown to non-technical admins. The
                  reference code lets the developer grep this file to find
                  the exact failure (Cognito client config missing from the
                  web build). Don't surface env var names here. */}
              {!configured && (
                <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Sign-in is temporarily unavailable. Please contact your
                  developer and share this reference:{' '}
                  <code className="font-semibold">ADMIN-AUTH-001</code>.
                </div>
              )}

              <AnimatePresence mode="wait" initial={false}>
                {error && (
                  <motion.div
                    key="err"
                    initial={{ opacity: 0, height: 0, y: -4 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -4 }}
                    transition={{ duration: 0.22 }}
                    className="mb-4 overflow-hidden"
                  >
                    <div className="rounded-lg border border-[#e8c5cb] bg-[#fbe8eb] px-3 py-2 text-sm text-brand-700">
                      {error}
                    </div>
                  </motion.div>
                )}
                {info && !error && (
                  <motion.div
                    key="info"
                    initial={{ opacity: 0, height: 0, y: -4 }}
                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                    exit={{ opacity: 0, height: 0, y: -4 }}
                    transition={{ duration: 0.22 }}
                    className="mb-4 overflow-hidden"
                  >
                    <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700">
                      {info}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence mode="wait" initial={false}>
                {stage === 'email' && (
                  <motion.form
                    key="email"
                    onSubmit={onLogin}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-4"
                  >
                    <Field label="Email" type="email" value={email} onChange={setEmail} required autoComplete="username" placeholder="you@brightertomorrowtherapy.com" disabled={busy || !configured} />
                    <Field
                      label="Password"
                      type="password"
                      value={password}
                      onChange={setPassword}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                      disabled={busy || !configured}
                      rightLink={
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => { setError(''); setInfo(''); setStage('forgot'); }}
                          className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700 transition hover:text-brand"
                        >
                          Forgot?
                        </button>
                      }
                    />
                    <Submit busy={busy} disabled={!configured} label="Sign in" busyLabel="Signing in…" />
                  </motion.form>
                )}

                {stage === 'forgot' && (
                  <motion.form
                    key="forgot"
                    onSubmit={onForgot}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-4"
                  >
                    <Field label="Email" type="email" value={email} onChange={setEmail} required autoFocus autoComplete="username" placeholder="you@brightertomorrowtherapy.com" disabled={busy} />
                    <Submit busy={busy} label="Send code" busyLabel="Sending…" />
                    <button
                      type="button"
                      onClick={() => { setError(''); setInfo(''); setStage('email'); }}
                      className="block w-full text-center text-[12px] font-medium text-ink-soft hover:text-ink"
                    >
                      ← Back to sign in
                    </button>
                  </motion.form>
                )}

                {stage === 'reset' && (
                  <motion.form
                    key="reset"
                    onSubmit={onReset}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-4"
                  >
                    {resetDestination && (
                      <p className="text-[12.5px] leading-relaxed text-ink-soft">
                        Code sent to <span className="font-semibold text-ink">{resetDestination}</span>.
                      </p>
                    )}
                    <Field label="Verification code" value={resetCode} onChange={setResetCode} inputMode="numeric" maxLength={8} required autoFocus disabled={busy} placeholder="123456" />
                    <Field label="New password" type="password" value={newPassword} onChange={setNewPassword} required autoComplete="new-password" placeholder="••••••••" disabled={busy} />
                    <p className="text-[11.5px] leading-relaxed text-ink-soft">
                      At least 14 characters with upper, lower, digit, and a symbol.
                    </p>
                    <Submit busy={busy} label="Reset password" busyLabel="Saving…" />
                    <button
                      type="button"
                      onClick={() => { setError(''); setInfo(''); setStage('email'); }}
                      className="block w-full text-center text-[12px] font-medium text-ink-soft hover:text-ink"
                    >
                      ← Back to sign in
                    </button>
                  </motion.form>
                )}

                {stage === 'newPassword' && (
                  <motion.form
                    key="np"
                    onSubmit={onNewPassword}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-4"
                  >
                    <Field label="New password" type="password" value={newPassword} onChange={setNewPassword} required autoComplete="new-password" placeholder="••••••••" disabled={busy} />
                    <p className="text-[11.5px] leading-relaxed text-ink-soft">
                      At least 14 characters with upper, lower, digit, and a symbol.
                    </p>
                    <Submit busy={busy} label="Set password" busyLabel="Saving…" />
                  </motion.form>
                )}

                {stage === 'mfaSetup' && (
                  <motion.form
                    key="mfas"
                    onSubmit={onVerifyMfaSetup}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-4"
                  >
                    <div className="flex flex-col items-center gap-3 rounded-xl border border-[#E5E5E5] bg-cream/60 p-4">
                      {mfaQrImage ? (
                        <motion.img
                          alt="Authenticator QR code"
                          className="h-40 w-40 rounded-lg shadow-md"
                          src={mfaQrImage}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.3 }}
                        />
                      ) : (
                        <div className="grid h-40 w-40 place-items-center text-[11px] text-ink-soft">Generating QR…</div>
                      )}
                      <code className="break-all text-[10.5px] tracking-tight text-brand-700">{mfaSecret}</code>
                    </div>
                    <Field label="6-digit code" value={totp} onChange={setTotp} inputMode="numeric" maxLength={6} required disabled={busy} placeholder="000000" />
                    <Submit busy={busy} label="Verify" busyLabel="Verifying…" />
                  </motion.form>
                )}

                {stage === 'mfa' && (
                  <motion.form
                    key="mfa"
                    onSubmit={onMfa}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-4"
                  >
                    <Field label="6-digit code" value={totp} onChange={setTotp} inputMode="numeric" maxLength={6} required autoFocus disabled={busy} placeholder="000000" />
                    <Submit busy={busy} label="Verify" busyLabel="Verifying…" />
                  </motion.form>
                )}
              </AnimatePresence>
            </div>

            <p className="mt-5 text-center text-[11px] leading-relaxed text-ink-soft">
              Protected under <span className="text-ink/80 font-medium">HIPAA §164.312</span> · MFA required · unauthorized access is prohibited
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Left brand panel — big business name, logo, decorative warmth
   ───────────────────────────────────────────────────────────────── */
function BrandPanel() {
  // Hostname is resolved client-side so the label stays correct across the
  // .cloud → .com domain cutover without a rebuild.
  const [host, setHost] = useState('brightertomorrowtherapy.com');
  useEffect(() => {
    setHost(window.location.hostname);
  }, []);
  return (
    <div className="relative hidden overflow-hidden bg-gradient-to-br from-[#192735] via-[#1d2c3d] to-[#253A4D] lg:block">
      {/* Glows */}
      <div className="pointer-events-none absolute -left-32 -top-40 h-[34rem] w-[34rem] rounded-full bg-brand/25 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 h-[34rem] w-[34rem] rounded-full bg-[#66202A]/40 blur-[120px]" />
      {/* Grain grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(225,184,120,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(225,184,120,0.6) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      {/* Wine band at bottom */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
        style={{ background: 'linear-gradient(to top, rgba(102,32,42,0.55), rgba(102,32,42,0))' }}
      />

      <div className="relative flex h-full min-h-screen flex-col p-10 xl:p-14">
        {/* Logo lockup */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center gap-3"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-[#cf9e57] shadow-[0_10px_30px_rgba(225,184,120,0.55)]">
            <BTMark size={28} />
          </div>
          <div className="leading-tight">
            <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-brand">Admin Console</div>
            <div className="text-[12px] text-cream/70">{host}</div>
          </div>
        </motion.div>

        {/* Big wordmark */}
        <div className="mt-auto">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
            className="text-[11px] font-medium uppercase tracking-[0.22em] text-brand/85"
          >
            Mental Health · Las Vegas, Nevada
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
            className="serif mt-3 text-[58px] xl:text-[72px] font-bold leading-[0.98] tracking-tight text-white"
          >
            Brighter
            <br />
            <span className="bg-gradient-to-r from-brand via-[#FFBC7D] to-[#cf9e57] bg-clip-text text-transparent">
              Tomorrow
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.22 }}
            className="serif mt-4 text-2xl xl:text-3xl text-cream/70 italic"
          >
            Therapy that meets you where you are.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
            className="mt-7 max-w-lg text-[15px] leading-relaxed text-cream/65"
          >
            Welcome to the practice management workspace — secure access for the team to manage
            contacts, sessions, content, and HIPAA-compliant audit trails.
          </motion.p>

          {/* Trust strip */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.38 }}
            className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-[11px] uppercase tracking-[0.16em]"
          >
            <TrustChip>HIPAA §164.312</TrustChip>
            <TrustChip>MFA Required</TrustChip>
            <TrustChip>Encrypted at Rest</TrustChip>
            <TrustChip>Nevada NRS 629.051</TrustChip>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function TrustChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-cream/55">
      <span className="h-1 w-1 rounded-full bg-brand" />
      {children}
    </span>
  );
}

function StageDots({ stage }: { stage: Stage }) {
  // Map each stage to one of three buckets: credentials → verify → done
  const idx = stage === 'email' || stage === 'forgot' ? 0 : stage === 'reset' || stage === 'newPassword' ? 1 : 2;
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === idx ? 'w-6 bg-gradient-to-r from-brand to-[#66202A]' : 'w-1.5 bg-[#E5E5E5]'
          }`}
        />
      ))}
    </div>
  );
}

function Field({
  label,
  type = 'text',
  value,
  onChange,
  required,
  autoComplete,
  inputMode,
  maxLength,
  autoFocus,
  placeholder,
  disabled,
  rightLink,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
  inputMode?: 'numeric';
  maxLength?: number;
  autoFocus?: boolean;
  placeholder?: string;
  disabled?: boolean;
  rightLink?: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink/60">{label}</span>
        {rightLink}
      </div>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[#E5E5E5] bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint shadow-[0_1px_0_rgba(255,255,255,0.6)_inset] transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:opacity-50"
      />
    </label>
  );
}

function Submit({ busy, disabled, label, busyLabel }: { busy: boolean; disabled?: boolean; label: string; busyLabel: string }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-b from-[#cf9e57] to-[#b6843d] px-4 py-3 text-sm font-semibold tracking-tight text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_8px_24px_rgba(102,32,42,0.28)] transition-all hover:from-[#d8a868] hover:to-[#c08e44] hover:shadow-[0_10px_28px_rgba(102,32,42,0.36)] disabled:cursor-not-allowed disabled:opacity-50 disabled:saturate-50"
    >
      {busy && <InlineSpinner />}
      {busy ? busyLabel : label}
    </button>
  );
}
