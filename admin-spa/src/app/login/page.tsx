"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import type { CognitoUser } from "amazon-cognito-identity-js";
import QRCode from "qrcode";
import {
  completeNewPassword,
  currentSession,
  startLogin,
  submitTotp,
  verifyTotpSetup,
} from "@/lib/auth";

type Stage = "email" | "newPassword" | "mfaSetup" | "mfa";

export default function LoginPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [pending, setPending] = useState<CognitoUser | null>(null);
  const [mfaQr, setMfaQr] = useState("");
  const [mfaQrImage, setMfaQrImage] = useState("");
  const [mfaSecret, setMfaSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    currentSession()
      .then((s) => { if (s) router.replace("/"); })
      .finally(() => setCheckingSession(false));
  }, [router]);

  useEffect(() => {
    if (!mfaQr) { setMfaQrImage(""); return; }
    QRCode.toDataURL(mfaQr, { width: 200, margin: 1, color: { dark: "#66202A", light: "#FBF6EF" } })
      .then(setMfaQrImage)
      .catch(() => setMfaQrImage(""));
  }, [mfaQr]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await startLogin(email, password);
      if (result.kind === "success") {
        router.replace("/");
      } else if (result.kind === "newPassword") {
        setPending(result.user);
        setStage("newPassword");
      } else if (result.kind === "mfaSetup") {
        setPending(result.user);
        setMfaQr(result.qr);
        setMfaSecret(result.secret);
        setStage("mfaSetup");
      } else if (result.kind === "mfa") {
        setPending(result.user);
        setStage("mfa");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function onNewPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setError("");
    setBusy(true);
    try {
      await completeNewPassword(pending, newPassword);
      router.replace("/");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("TOTP")) {
        const r = await startLogin(email, newPassword);
        if (r.kind === "mfaSetup") {
          setPending(r.user);
          setMfaQr(r.qr);
          setMfaSecret(r.secret);
          setStage("mfaSetup");
        }
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyMfaSetup(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setError("");
    setBusy(true);
    try {
      await verifyTotpSetup(pending, totp);
      router.replace("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  async function onMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setError("");
    setBusy(true);
    try {
      await submitTotp(pending, totp);
      router.replace("/");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-cream">
      <BackgroundDecor />

      <AnimatePresence>
        {checkingSession && (
          <motion.div
            key="boot"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 z-20 grid place-items-center bg-cream"
          >
            <BTMark spin />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 grid min-h-screen place-items-center px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[420px]"
        >
          {/* Brand block */}
          <div className="mb-7 flex flex-col items-center text-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <BTMark />
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="font-display mt-5 text-[28px] leading-tight font-semibold tracking-[-0.01em] text-wine-700"
            >
              Brighter Tomorrow
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.32, duration: 0.5 }}
              className="mt-1 text-[13px] uppercase tracking-[0.18em] text-gold-600"
            >
              Admin Console
            </motion.p>
          </div>

          {/* Card */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-2xl border border-wine-100 bg-white p-7 shadow-card"
          >
            <div className="mb-5 flex items-center justify-between">
              <span className="font-display text-[15px] font-semibold text-ink">
                {stage === "email" && "Sign in"}
                {stage === "newPassword" && "Set a new password"}
                {stage === "mfaSetup" && "Set up authenticator"}
                {stage === "mfa" && "Enter your code"}
              </span>
              <StageDots stage={stage} />
            </div>

            <AnimatePresence mode="wait" initial={false}>
              {error && (
                <motion.div
                  key="err"
                  initial={{ opacity: 0, height: 0, y: -4 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -4 }}
                  transition={{ duration: 0.25 }}
                  className="mb-4 overflow-hidden"
                >
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait" initial={false}>
              {stage === "email" && (
                <motion.form
                  key="email"
                  onSubmit={onLogin}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-4"
                >
                  <Field label="Email" type="email" value={email} onChange={setEmail} required autoComplete="username" />
                  <Field label="Password" type="password" value={password} onChange={setPassword} required autoComplete="current-password" />
                  <SubmitButton busy={busy} label="Sign in" busyLabel="Signing in…" />
                </motion.form>
              )}

              {stage === "newPassword" && (
                <motion.form
                  key="np"
                  onSubmit={onNewPassword}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-4"
                >
                  <Field label="New password" type="password" value={newPassword} onChange={setNewPassword} required autoComplete="new-password" />
                  <p className="text-[11.5px] text-ink-soft">
                    At least 14 characters with upper, lower, digit, and a symbol.
                  </p>
                  <SubmitButton busy={busy} label="Set password" busyLabel="Saving…" />
                </motion.form>
              )}

              {stage === "mfaSetup" && (
                <motion.form
                  key="mfas"
                  onSubmit={onVerifyMfaSetup}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-4"
                >
                  <p className="text-[12.5px] text-ink-soft">
                    Scan this QR in your authenticator app, then enter the 6-digit code below.
                  </p>
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-wine-100 bg-cream p-4">
                    {mfaQrImage ? (
                      <motion.img
                        alt="Authenticator QR code"
                        className="h-40 w-40 rounded-lg shadow-sm"
                        src={mfaQrImage}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3 }}
                      />
                    ) : (
                      <div className="grid h-40 w-40 place-items-center text-[11px] text-ink-soft">
                        Generating QR…
                      </div>
                    )}
                    <code className="break-all text-[10.5px] tracking-tight text-wine-700">
                      {mfaSecret}
                    </code>
                  </div>
                  <Field
                    label="6-digit code"
                    value={totp}
                    onChange={setTotp}
                    inputMode="numeric"
                    maxLength={6}
                    required
                  />
                  <SubmitButton busy={busy} label="Verify" busyLabel="Verifying…" />
                </motion.form>
              )}

              {stage === "mfa" && (
                <motion.form
                  key="mfa"
                  onSubmit={onMfa}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-4"
                >
                  <Field
                    label="6-digit code"
                    value={totp}
                    onChange={setTotp}
                    inputMode="numeric"
                    maxLength={6}
                    required
                    autoFocus
                  />
                  <SubmitButton busy={busy} label="Verify" busyLabel="Verifying…" />
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Footer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="mt-6 flex items-center justify-center gap-2 text-[11.5px] text-ink-soft"
          >
            <LockIcon />
            <span>Protected under HIPAA §164.312 — unauthorized access is prohibited</span>
          </motion.div>
        </motion.div>
      </div>
    </main>
  );
}

/* ─────────────────── Pieces ─────────────────── */

/** Inline BT brand mark — sunrise rays cradled by a wine arc. Animated when `spin`. */
function BTMark({ spin = false }: { spin?: boolean }) {
  return (
    <motion.div
      animate={spin ? { rotate: 360 } : { y: [0, -3, 0] }}
      transition={
        spin
          ? { repeat: Infinity, duration: 1.4, ease: "linear" }
          : { repeat: Infinity, duration: 5, ease: "easeInOut" }
      }
      className="relative"
    >
      {/* Soft gold halo */}
      <motion.span
        aria-hidden
        className="absolute inset-[-14px] rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(225,184,120,0.38), rgba(225,184,120,0) 70%)",
        }}
        animate={{ opacity: [0.6, 1, 0.6], scale: [1, 1.08, 1] }}
        transition={{ repeat: Infinity, duration: 3.5, ease: "easeInOut" }}
      />
      <svg width="72" height="72" viewBox="0 0 72 72" className="relative">
        <defs>
          <linearGradient id="btSky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#FBF6EF" />
            <stop offset="100%" stopColor="#F5D8A3" />
          </linearGradient>
          <linearGradient id="btSun" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#E1B878" />
            <stop offset="100%" stopColor="#c89958" />
          </linearGradient>
        </defs>
        {/* Wine arc (cradle) */}
        <path
          d="M6 50 a30 30 0 0 1 60 0"
          fill="none"
          stroke="#66202A"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        {/* Sky fill above the horizon */}
        <path
          d="M9.5 49 a26.5 26.5 0 0 1 53 0 z"
          fill="url(#btSky)"
        />
        {/* Sun rays */}
        {[-30, -15, 0, 15, 30].map((deg) => (
          <line
            key={deg}
            x1="36"
            y1="49"
            x2={36 + Math.sin((deg * Math.PI) / 180) * 24}
            y2={49 - Math.cos((deg * Math.PI) / 180) * 24}
            stroke="#E1B878"
            strokeWidth="1.6"
            strokeLinecap="round"
            opacity="0.75"
          />
        ))}
        {/* Sun */}
        <circle cx="36" cy="49" r="9.5" fill="url(#btSun)" />
        {/* Horizon line */}
        <line x1="9" y1="49" x2="63" y2="49" stroke="#66202A" strokeWidth="1.6" strokeLinecap="round" />
        {/* BT initials beneath */}
        <text
          x="36"
          y="68"
          textAnchor="middle"
          fontFamily="'Fraunces', serif"
          fontWeight="700"
          fontSize="9"
          fill="#66202A"
          letterSpacing="2"
        >
          BT
        </text>
      </svg>
    </motion.div>
  );
}

/** Background: cream wash, soft wine corner glow, slow-drifting gold particles. */
function BackgroundDecor() {
  // Deterministic but visually random particle positions.
  const particles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        x: ((i * 73) % 100),
        y: ((i * 41 + 17) % 100),
        s: 6 + ((i * 13) % 18),
        d: 4 + ((i * 7) % 6),
        o: 0.18 + ((i * 11) % 35) / 200,
      })),
    [],
  );

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Top-right wine glow */}
      <div
        className="absolute -top-40 -right-32 h-[460px] w-[460px] rounded-full blur-3xl opacity-25"
        style={{
          background:
            "radial-gradient(closest-side, #66202A, transparent 70%)",
        }}
      />
      {/* Bottom-left gold glow */}
      <div
        className="absolute -bottom-40 -left-32 h-[460px] w-[460px] rounded-full blur-3xl opacity-30"
        style={{
          background:
            "radial-gradient(closest-side, #E1B878, transparent 70%)",
        }}
      />
      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #66202A 1px, transparent 1px), linear-gradient(to bottom, #66202A 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* Drifting gold particles */}
      {particles.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-gold-300"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.s}px`,
            height: `${p.s}px`,
            opacity: p.o,
            filter: "blur(0.5px)",
            animation: `drift ${p.d}s ease-in-out ${(i % 5) * 0.4}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function StageDots({ stage }: { stage: Stage }) {
  const order: Stage[] = ["email", "newPassword", "mfaSetup", "mfa"];
  const idx = Math.max(0, order.indexOf(stage));
  // Collapse newPassword + mfaSetup + mfa into "after email" so the dots
  // read as "credentials → verify".
  const active = stage === "email" ? 0 : 1;
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1].map((i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === active ? "w-6 bg-gold-400" : "w-1.5 bg-wine-100"
          }`}
          aria-hidden
        />
      ))}
      <span className="sr-only">Step {idx + 1}</span>
    </div>
  );
}

function Field({
  label,
  type = "text",
  value,
  onChange,
  required,
  autoComplete,
  inputMode,
  maxLength,
  autoFocus,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
  inputMode?: "numeric";
  maxLength?: number;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-medium uppercase tracking-[0.1em] text-ink-soft">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-lg border border-wine-100 bg-cream/40 px-3.5 py-2.5 text-[14px] text-ink outline-none transition focus:border-gold-400 focus:bg-white focus:ring-4 focus:ring-gold-200/60"
      />
    </label>
  );
}

function SubmitButton({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return (
    <motion.button
      type="submit"
      disabled={busy}
      whileHover={{ scale: busy ? 1 : 1.01 }}
      whileTap={{ scale: busy ? 1 : 0.99 }}
      className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-wine-700 px-4 py-2.5 text-[14px] font-medium text-white transition disabled:opacity-60 hover:bg-wine-800"
    >
      {busy && (
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(225,184,120,0.35), transparent)",
            backgroundSize: "200% 100%",
            animation: "drift 2.2s linear infinite",
          }}
        />
      )}
      <span className="relative">{busy ? busyLabel : label}</span>
      {!busy && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="relative">
          <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </motion.button>
  );
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
