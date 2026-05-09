import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      // Brand palette mirrors brightertomorrowtherapy.cloud (the public site)
      // so admin and public site feel like one product.
      colors: {
        wine: {
          50:  "#fbf3f4",
          100: "#f5e0e3",
          200: "#e8b9c0",
          400: "#a8424f",
          600: "#7a2832",
          700: "#66202A", // primary
          800: "#4d1820",
          900: "#3a1218",
        },
        gold: {
          50:  "#fdf8ef",
          100: "#fbeed7",
          200: "#f5d8a3",
          300: "#ecc382",
          400: "#E1B878", // accent
          500: "#c89958",
          600: "#a87b3e",
        },
        cream: "#FBF6EF",
        ink:   "#1A1A1A",
        "ink-soft": "#5b5757",
        // Keep the legacy `brand` alias so existing pages don't break.
        brand: {
          50: "#fbf6ef",
          100: "#f2e6d1",
          500: "#b98752",
          600: "#a6753f",
          700: "#8a5f34",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Fraunces", "ui-serif", "serif"],
        sans:    ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 20px 60px -20px rgba(102, 32, 42, 0.25), 0 8px 20px -10px rgba(102, 32, 42, 0.15)",
        glow: "0 0 0 1px rgba(225, 184, 120, 0.4), 0 12px 40px -8px rgba(225, 184, 120, 0.45)",
      },
      keyframes: {
        "float-slow": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%":      { transform: "translateY(-8px)" },
        },
      },
      animation: {
        "float-slow": "float-slow 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
