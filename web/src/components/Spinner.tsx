'use client';
/**
 * Brand loading marks — used across the public site AND the admin console.
 *
 *   <BTSpinner />        — branded loading dial with BT sunrise in the center
 *   <InlineSpinner />    — compact BT-mark spinner for inline / button use
 *   <BTMark />           — static brand glyph (sun, arc, rays)
 *   <LoadingScreen />    — full-card loading state (drop into <Card>)
 *   <FullScreenSpinner /> — fixed-position route boot state
 *
 * The mark itself is the BT sunrise — same gold-to-burgundy gesture used in
 * the navbar logo and favicon — so every wait state reinforces the brand.
 */
import { motion } from 'framer-motion';

type Size = 'xs' | 'sm' | 'md' | 'lg';

const sizeMap: Record<Size, { box: number; ring: number; offset: number }> = {
  xs: { box: 24, ring: 1.5, offset: 9 },
  sm: { box: 32, ring: 2, offset: 12 },
  md: { box: 48, ring: 2.5, offset: 18 },
  lg: { box: 72, ring: 3, offset: 28 },
};

export function BTSpinner({ size = 'md', label }: { size?: Size; label?: string }) {
  const s = sizeMap[size];
  const r = s.box / 2 - s.ring;
  const c = s.box / 2;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * 0.28;

  return (
    <span className="inline-flex flex-col items-center gap-2" role="status" aria-live="polite">
      <span className="relative inline-flex" style={{ width: s.box, height: s.box }}>
        {/* Soft gradient halo */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full blur-md"
          style={{
            background:
              'radial-gradient(closest-side, rgba(225,184,120,0.45), rgba(102,32,42,0) 70%)',
          }}
        />

        {/* Spinning gradient arc */}
        <motion.svg
          viewBox={`0 0 ${s.box} ${s.box}`}
          width={s.box}
          height={s.box}
          className="relative"
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}
          aria-hidden
        >
          <defs>
            <linearGradient id={`btSpinnerGrad-${size}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#E1B878" />
              <stop offset="100%" stopColor="#66202A" />
            </linearGradient>
          </defs>
          <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(25,39,53,0.08)" strokeWidth={s.ring} />
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={`url(#btSpinnerGrad-${size})`}
            strokeWidth={s.ring}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference}`}
            transform={`rotate(-90 ${c} ${c})`}
          />
        </motion.svg>

        {/* Static BT sunrise mark, gently breathing */}
        <motion.span
          className="absolute inset-0 grid place-items-center"
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ repeat: Infinity, duration: 2.8, ease: 'easeInOut' }}
        >
          <BTMark size={Math.round(s.box * 0.55)} />
        </motion.span>
      </span>
      {label && (
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink/50">
          {label}
        </span>
      )}
    </span>
  );
}

/** Compact inline spinner — uses the BT mark on a slow spin. */
export function InlineSpinner({
  className = '',
  size = 16,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <motion.span
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: size, height: size }}
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 1.6, ease: 'linear' }}
      aria-hidden
    >
      <BTMark size={size} />
    </motion.span>
  );
}

/** Branded BT sunrise mark — sun + rays cradled by an arc. */
export function BTMark({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id={`btSunGrad-${size}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFBC7D" />
          <stop offset="100%" stopColor="#E1B878" />
        </linearGradient>
        <linearGradient id={`btArcGrad-${size}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#66202A" />
          <stop offset="100%" stopColor="#E1B878" />
        </linearGradient>
      </defs>
      {/* Cradle arc */}
      <path
        d="M5 22 a11 11 0 0 1 22 0"
        fill="none"
        stroke={`url(#btArcGrad-${size})`}
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Sun */}
      <circle cx="16" cy="22" r="4.2" fill={`url(#btSunGrad-${size})`} />
      {/* Rays */}
      {[-50, -25, 0, 25, 50].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        return (
          <line
            key={deg}
            x1={16 + Math.sin(rad) * 6.5}
            y1={22 - Math.cos(rad) * 6.5}
            x2={16 + Math.sin(rad) * 9}
            y2={22 - Math.cos(rad) * 9}
            stroke="#E1B878"
            strokeOpacity="0.85"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        );
      })}
      {/* Horizon */}
      <line
        x1="6"
        y1="22"
        x2="26"
        y2="22"
        stroke="rgba(102,32,42,0.5)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LoadingScreen({
  label = 'Loading',
  className = '',
  height = 280,
}: {
  label?: string;
  className?: string;
  height?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25, delay: 0.1 }}
      className={`flex flex-col items-center justify-center rounded-2xl border border-[#D9D9D9] bg-white/70 backdrop-blur-sm ${className}`}
      style={{ minHeight: height }}
    >
      <BTSpinner size="md" label={label} />
    </motion.div>
  );
}

export function FullScreenSpinner({ label }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-cream-alt/85 backdrop-blur">
      <BTSpinner size="lg" label={label} />
    </div>
  );
}
