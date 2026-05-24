"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FiActivity,
  FiEyeOff,
  FiDroplet,
  FiBookOpen,
  FiEye,
  FiCpu,
  FiZap,
  FiTarget,
  FiRotateCcw,
  FiX,
} from "react-icons/fi";

/**
 * AccessibilityWidget
 * --------------------
 * Self-hosted accessibility menu pinned to the bottom-left of every
 * customer-facing page. Mirrors the layout of the .com plugin (Profiles
 * + Features) but renders entirely client-side without shipping visitor
 * data to a third-party vendor — important on a HIPAA-leaning surface.
 *
 * Preferences are stored in localStorage and applied by toggling
 * `a11y-*` classes on <html>. Matching styles live in globals.css.
 */

type ColorMode = "default" | "contrast" | "light" | "mono" | "saturate-low";

type Prefs = {
  fontStep: 0 | 1 | 2 | 3;
  lineStep: 0 | 1 | 2;
  trackStep: 0 | 1 | 2;
  color: ColorMode;
  links: boolean;
  readable: boolean;
  reduceMotion: boolean;
  bigCursor: boolean;
  hideImages: boolean;
};

const DEFAULTS: Prefs = {
  fontStep: 0,
  lineStep: 0,
  trackStep: 0,
  color: "default",
  links: false,
  readable: false,
  reduceMotion: false,
  bigCursor: false,
  hideImages: false,
};

const STORAGE_KEY = "bt:a11y:v2";

type ProfileId =
  | "motor"
  | "blind"
  | "color-blind"
  | "dyslexia"
  | "low-vision"
  | "cognitive"
  | "seizure"
  | "adhd";

type Profile = {
  id: ProfileId;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  prefs: Partial<Prefs>;
};

const PROFILES: Profile[] = [
  {
    id: "motor",
    label: "Motor impaired",
    hint: "Larger pointer, slower motion",
    icon: FiActivity,
    prefs: { bigCursor: true, reduceMotion: true },
  },
  {
    id: "blind",
    label: "Blind users",
    hint: "Readable font, strong links",
    icon: FiEyeOff,
    prefs: { readable: true, links: true, reduceMotion: true },
  },
  {
    id: "color-blind",
    label: "Color blind",
    hint: "Full grayscale",
    icon: FiDroplet,
    prefs: { color: "mono" },
  },
  {
    id: "dyslexia",
    label: "Dyslexia",
    hint: "Plain font, wider spacing",
    icon: FiBookOpen,
    prefs: { fontStep: 1, lineStep: 1, trackStep: 1, readable: true },
  },
  {
    id: "low-vision",
    label: "Low vision",
    hint: "Bigger text, high contrast",
    icon: FiEye,
    prefs: { fontStep: 2, color: "contrast", links: true },
  },
  {
    id: "cognitive",
    label: "Cognitive",
    hint: "Calm layout, fewer images",
    icon: FiCpu,
    prefs: {
      readable: true,
      reduceMotion: true,
      bigCursor: true,
      hideImages: true,
    },
  },
  {
    id: "seizure",
    label: "Seizure safe",
    hint: "No motion, lower saturation",
    icon: FiZap,
    prefs: { reduceMotion: true, color: "saturate-low" },
  },
  {
    id: "adhd",
    label: "ADHD friendly",
    hint: "Calmer motion, stronger links",
    icon: FiTarget,
    prefs: { reduceMotion: true, lineStep: 1, links: true },
  },
];

const COLOR_OPTIONS: { value: ColorMode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "contrast", label: "High contrast" },
  { value: "light", label: "Light" },
  { value: "mono", label: "Monochrome" },
  { value: "saturate-low", label: "Low saturation" },
];

function applyPrefs(p: Prefs) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.classList.toggle("a11y-font-1", p.fontStep === 1);
  el.classList.toggle("a11y-font-2", p.fontStep === 2);
  el.classList.toggle("a11y-font-3", p.fontStep === 3);
  el.classList.toggle("a11y-line-1", p.lineStep === 1);
  el.classList.toggle("a11y-line-2", p.lineStep === 2);
  el.classList.toggle("a11y-track-1", p.trackStep === 1);
  el.classList.toggle("a11y-track-2", p.trackStep === 2);
  el.classList.toggle("a11y-contrast", p.color === "contrast");
  el.classList.toggle("a11y-contrast-light", p.color === "light");
  el.classList.toggle("a11y-monochrome", p.color === "mono");
  el.classList.toggle("a11y-saturate-low", p.color === "saturate-low");
  el.classList.toggle("a11y-links", p.links);
  el.classList.toggle("a11y-readable", p.readable);
  el.classList.toggle("a11y-reduce-motion", p.reduceMotion);
  el.classList.toggle("a11y-big-cursor", p.bigCursor);
  el.classList.toggle("a11y-hide-images", p.hideImages);
}

function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function loadActiveProfile(): ProfileId | null {
  if (typeof window === "undefined") return null;
  try {
    return (window.localStorage.getItem(`${STORAGE_KEY}:profile`) as ProfileId) || null;
  } catch {
    return null;
  }
}

export default function AccessibilityWidget() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"profiles" | "features">("profiles");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [activeProfile, setActiveProfile] = useState<ProfileId | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const initial = loadPrefs();
    setPrefs(initial);
    applyPrefs(initial);
    setActiveProfile(loadActiveProfile());
  }, []);

  const persist = useCallback((next: Prefs, profile: ProfileId | null) => {
    setPrefs(next);
    applyPrefs(next);
    setActiveProfile(profile);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      if (profile) {
        window.localStorage.setItem(`${STORAGE_KEY}:profile`, profile);
      } else {
        window.localStorage.removeItem(`${STORAGE_KEY}:profile`);
      }
    } catch {
      // private-mode localStorage failures fall back to in-memory state
    }
  }, []);

  // Individual feature change → wipes any active profile (user is customizing).
  const setFeature = useCallback(
    <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
      persist({ ...prefs, [key]: value }, null);
    },
    [prefs, persist],
  );

  const applyProfile = useCallback(
    (p: Profile) => {
      if (activeProfile === p.id) {
        persist(DEFAULTS, null);
        return;
      }
      persist({ ...DEFAULTS, ...p.prefs }, p.id);
    },
    [activeProfile, persist],
  );

  const reset = useCallback(() => persist(DEFAULTS, null), [persist]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const anyOn = useMemo(
    () => JSON.stringify(prefs) !== JSON.stringify(DEFAULTS),
    [prefs],
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Accessibility menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 sm:bottom-10 sm:left-10 z-50 bg-[#66202a] text-white rounded-full w-14 h-14 shadow-glow ring-1 ring-black/20 flex items-center justify-center hover:bg-[#7a2734] transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-[#66202a]/40"
      >
        <AccessibilityIcon className="w-7 h-7" />
        {anyOn && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-amber-400 ring-2 ring-white"
          />
        )}
        <span className="sr-only">Accessibility menu</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="a11y-panel"
            ref={panelRef}
            role="dialog"
            aria-label="Accessibility options"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed z-50 bg-white border border-surface-line rounded-2xl shadow-card overflow-hidden
                       bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 right-4 sm:right-auto sm:left-10 sm:bottom-28
                       w-auto sm:w-[420px] max-w-[calc(100vw-2rem)]"
          >
            {/* Header */}
            <div className="px-5 py-3.5 bg-[#66202a] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <AccessibilityIcon className="w-5 h-5" />
                <span className="font-semibold tracking-tight">Accessibility</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close accessibility menu"
                className="text-white/80 hover:text-white"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div role="tablist" className="flex border-b border-surface-line bg-[var(--cream)]">
              {(["profiles", "features"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`flex-1 px-4 py-2.5 text-sm font-semibold uppercase tracking-wider transition-colors ${
                    tab === t
                      ? "text-[#66202a] bg-white border-b-2 border-[#66202a] -mb-px"
                      : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {t === "profiles" ? "Profiles" : "Features"}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="p-4 max-h-[70vh] overflow-y-auto">
              {tab === "profiles" ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {PROFILES.map((p) => {
                    const Icon = p.icon;
                    const active = activeProfile === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyProfile(p)}
                        aria-pressed={active}
                        className={`flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition-colors ${
                          active
                            ? "border-[#66202a] bg-[#66202a]/5 ring-1 ring-[#66202a]/30"
                            : "border-surface-line bg-white hover:border-[#66202a]/50 hover:bg-[var(--cream)]"
                        }`}
                      >
                        <Icon
                          className={`w-5 h-5 ${active ? "text-[#66202a]" : "text-[var(--ink-muted)]"}`}
                        />
                        <span className="text-sm font-medium text-[var(--ink)] leading-tight">
                          {p.label}
                        </span>
                        <span className="text-[11px] text-[var(--ink-muted)] leading-snug">
                          {p.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-4">
                  <SegmentedControl
                    label="Text size"
                    options={[
                      { label: "Default", value: 0 },
                      { label: "A+", value: 1 },
                      { label: "A++", value: 2 },
                      { label: "A+++", value: 3 },
                    ]}
                    value={prefs.fontStep}
                    onChange={(v) => setFeature("fontStep", v as Prefs["fontStep"])}
                  />

                  <SegmentedControl
                    label="Line height"
                    options={[
                      { label: "Default", value: 0 },
                      { label: "+", value: 1 },
                      { label: "++", value: 2 },
                    ]}
                    value={prefs.lineStep}
                    onChange={(v) => setFeature("lineStep", v as Prefs["lineStep"])}
                  />

                  <SegmentedControl
                    label="Letter spacing"
                    options={[
                      { label: "Default", value: 0 },
                      { label: "+", value: 1 },
                      { label: "++", value: 2 },
                    ]}
                    value={prefs.trackStep}
                    onChange={(v) => setFeature("trackStep", v as Prefs["trackStep"])}
                  />

                  <SegmentedControl
                    label="Color mode"
                    options={COLOR_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                    value={prefs.color}
                    onChange={(v) => setFeature("color", v as ColorMode)}
                  />

                  <div className="pt-2 border-t border-surface-line space-y-3">
                    <Toggle
                      label="Highlight links"
                      description="Bold + underline every link"
                      checked={prefs.links}
                      onChange={(v) => setFeature("links", v)}
                    />
                    <Toggle
                      label="Readable font"
                      description="Plain sans-serif with extra spacing"
                      checked={prefs.readable}
                      onChange={(v) => setFeature("readable", v)}
                    />
                    <Toggle
                      label="Pause animations"
                      description="Reduce motion across the site"
                      checked={prefs.reduceMotion}
                      onChange={(v) => setFeature("reduceMotion", v)}
                    />
                    <Toggle
                      label="Bigger cursor"
                      description="Enlarged pointer for easier tracking"
                      checked={prefs.bigCursor}
                      onChange={(v) => setFeature("bigCursor", v)}
                    />
                    <Toggle
                      label="Hide images"
                      description="Reduce visual clutter"
                      checked={prefs.hideImages}
                      onChange={(v) => setFeature("hideImages", v)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-surface-line flex items-center justify-between gap-3 bg-[var(--cream)]">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                <FiRotateCcw className="w-3.5 h-3.5" /> Reset
              </button>
              <a
                href="/contact"
                className="text-sm font-medium text-[#66202a] hover:underline"
              >
                Need more help?
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-[var(--ink-muted)] mb-1.5">
        {label}
      </div>
      <div className={`grid gap-1.5`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              className={`py-2 px-1 rounded-lg border text-xs font-medium transition-colors ${
                active
                  ? "bg-[#66202a] text-white border-[#66202a]"
                  : "bg-white text-[var(--ink)] border-surface-line hover:bg-[var(--cream)]"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer select-none">
      <span className="flex-1">
        <span className="block text-sm font-medium text-[var(--ink)]">{label}</span>
        <span className="block text-xs text-[var(--ink-muted)] leading-snug">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#66202a]/40 ${
          checked ? "bg-[#66202a]" : "bg-[var(--cream-deep)]"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}

function AccessibilityIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-a11y-keep
    >
      <circle cx="12" cy="3.75" r="1.75" />
      <path d="M5.5 8.25a1 1 0 0 1 .9-1.09c1.7-.18 3.6-.28 5.6-.28s3.9.1 5.6.28a1 1 0 1 1-.2 1.99c-1.3-.13-2.74-.22-4.15-.26v3.3l2.6 6.6a1 1 0 1 1-1.86.74l-2.49-6.3-2.49 6.3a1 1 0 1 1-1.86-.74l2.6-6.6V8.89c-1.4.04-2.84.13-4.15.26a1 1 0 0 1-1.1-.9Z" />
    </svg>
  );
}
