import type { Config } from "tailwindcss";

/**
 * Palette mirrored 1:1 from brightertomorrowtherapy.com (Elementor kit-17):
 *   primary navy   #192735   → ink
 *   secondary bg   #F2F2F2   → cream-alt
 *   accent (light) #F4F4F4   → cream
 *   text body      #858585   → ink-soft
 *   gold           #E1B878   → brand (CTA + eyebrow)
 *   teal           #75ACC0   → sage (decorative)
 *   navy-2         #253A4D   → plum
 *   wine           #66202A   → brand-700 (link hover)
 *   peach          #FFBC7D   → peach
 *   border         #D9D9D9   → surface.line
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Warm gold — Brighter Tomorrow primary CTA + accent
        brand: {
          DEFAULT: "#E1B878",
          50:  "#fdf8ef",
          100: "#faedd5",
          200: "#f3dab0",
          300: "#ebc78b",
          400: "#e6c082",
          500: "#E1B878",
          600: "#cf9e57",
          700: "#66202A",   // burgundy — used for link hover / active
          800: "#4a1820",
          900: "#2c0d12",
        },
        // Teal — kept under "sage" key for code compatibility
        sage: {
          DEFAULT: "#75ACC0",
          50:  "#f1f7fa",
          100: "#dcebf1",
          200: "#bdd9e3",
          300: "#9bc4d3",
          400: "#85b8c9",
          500: "#75ACC0",
          600: "#558ea4",
          700: "#3f6e82",
          800: "#2c4d5b",
          900: "#1a2e36",
        },
        // Secondary navy — kept under "plum" key for code compatibility
        plum: {
          DEFAULT: "#253A4D",
          50:  "#eef2f6",
          100: "#d6dee6",
          200: "#aabbc9",
          300: "#7a93a8",
          400: "#4d6a82",
          500: "#253A4D",
          600: "#1d2e3d",
          700: "#16232f",
          800: "#0f1922",
          900: "#080d12",
        },
        // Deep navy ink — primary text
        ink: {
          DEFAULT: "#192735",
          muted:   "#5a6878",
          soft:    "#858585",
          faint:   "#b6bcc4",
        },
        // Surfaces — light grays (kept "cream" keys for code compat)
        cream: {
          DEFAULT: "#F4F4F4",
          alt:     "#F2F2F2",
          deep:    "#E5E5E5",
          warm:    "#FAFAFA",
        },
        surface: {
          DEFAULT: "#F4F4F4",
          alt:     "#F2F2F2",
          line:    "#D9D9D9",
        },
      },
      fontFamily: {
        sans:    ["var(--font-mukta)", "var(--font-karla)", "system-ui", "sans-serif"],
        display: ["var(--font-karla)", "system-ui", "sans-serif"],
        serif:   ["var(--font-karla)", "system-ui", "sans-serif"],
        script:  ["var(--font-radley)", "Georgia", "serif"],
        mono:    ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      letterSpacing: {
        tightest: "-0.04em",
        eyebrow:  "0.2em",
      },
      boxShadow: {
        soft:    "0 8px 28px -16px rgba(25,39,53,0.16)",
        card:    "0 14px 50px -22px rgba(25,39,53,0.22)",
        ring:    "0 0 0 1px rgba(25,39,53,0.06)",
        glow:    "0 30px 80px -30px rgba(225,184,120,0.45)",
        "inner-soft": "inset 0 1px 0 0 rgba(255,255,255,0.6)",
      },
      borderRadius: {
        "4xl": "1.75rem",
        "5xl": "2.25rem",
        // Live-site signature: asymmetric pill (top-right square)
        "btn":  "20px 0 20px 20px",
      },
      keyframes: {
        floaty: {
          "0%,100%": { transform: "translateY(0px)" },
          "50%":     { transform: "translateY(-10px)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        rise: {
          "0%":   { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%,100%": { opacity: "0.5" },
          "50%":     { opacity: "1" },
        },
      },
      animation: {
        floaty:    "floaty 6s ease-in-out infinite",
        shimmer:   "shimmer 3s linear infinite",
        rise:      "rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
        pulseSoft: "pulseSoft 4s ease-in-out infinite",
      },
      backgroundImage: {
        "grain": "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.1 0 0 0 0 0.15 0 0 0 0 0.2 0 0 0 0.45 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E\")",
      },
    },
  },
  plugins: [],
};
export default config;
