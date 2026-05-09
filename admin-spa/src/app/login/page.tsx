"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

  useEffect(() => {
    currentSession().then((s) => {
      if (s) router.replace("/");
    });
  }, [router]);

  useEffect(() => {
    if (!mfaQr) {
      setMfaQrImage("");
      return;
    }
    QRCode.toDataURL(mfaQr, { width: 200, margin: 1 })
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
      setError(err instanceof Error ? err.message : "Login failed");
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
        // Re-run the login so Cognito enters the mfaSetup branch.
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
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-50 via-white to-brand-50/30 px-6">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-xl">
        <h1 className="font-display text-2xl font-semibold text-stone-900">BT Admin</h1>
        <p className="mt-1 text-sm text-stone-500">
          {stage === "email" && "Sign in with your email and password."}
          {stage === "newPassword" && "Set a new password."}
          {stage === "mfaSetup" && "Scan this QR in your authenticator app, then enter the 6-digit code."}
          {stage === "mfa" && "Enter your 6-digit authenticator code."}
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {stage === "email" && (
          <form onSubmit={onLogin} className="mt-6 space-y-4">
            <Input label="Email" type="email" value={email} onChange={setEmail} required />
            <Input label="Password" type="password" value={password} onChange={setPassword} required />
            <Button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          </form>
        )}
        {stage === "newPassword" && (
          <form onSubmit={onNewPassword} className="mt-6 space-y-4">
            <Input label="New password" type="password" value={newPassword} onChange={setNewPassword} required />
            <p className="text-xs text-stone-500">≥14 chars with upper, lower, digit, symbol.</p>
            <Button disabled={busy}>{busy ? "Saving…" : "Set password"}</Button>
          </form>
        )}
        {stage === "mfaSetup" && (
          <form onSubmit={onVerifyMfaSetup} className="mt-6 space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4">
              {mfaQrImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="TOTP QR" className="h-40 w-40" src={mfaQrImage} />
              ) : (
                <div className="flex h-40 w-40 items-center justify-center text-xs text-stone-400">
                  Generating QR…
                </div>
              )}
              <code className="break-all text-[11px] text-stone-600">{mfaSecret}</code>
            </div>
            <Input label="6-digit code" value={totp} onChange={setTotp} inputMode="numeric" maxLength={6} required />
            <Button disabled={busy}>{busy ? "Verifying…" : "Verify"}</Button>
          </form>
        )}
        {stage === "mfa" && (
          <form onSubmit={onMfa} className="mt-6 space-y-4">
            <Input label="6-digit code" value={totp} onChange={setTotp} inputMode="numeric" maxLength={6} required />
            <Button disabled={busy}>{busy ? "Verifying…" : "Verify"}</Button>
          </form>
        )}
      </div>
    </main>
  );
}

function Input({
  label,
  type = "text",
  value,
  onChange,
  required,
  inputMode,
  maxLength,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  inputMode?: "numeric";
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-stone-600">{label}</span>
      <input
        type={type}
        value={value}
        inputMode={inputMode}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );
}

function Button({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
    >
      {children}
    </button>
  );
}
