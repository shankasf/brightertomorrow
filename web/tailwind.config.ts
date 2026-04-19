import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#b98752",
          50: "#fbf5ef",
          100: "#f4e8d8",
          200: "#ead4b4",
          300: "#e1b878",
          400: "#cf9b61",
          500: "#b98752",
          600: "#9e7345",
          700: "#7c5636",
          800: "#5b3c29",
          900: "#3b2419",
        },
        ink: {
          DEFAULT: "#2f231a",
          muted: "#6d5848",
          soft: "#8a7566",
        },
        surface: {
          DEFAULT: "#F5EFE8",
          alt: "#FCF8F3",
          line: "#DFCFBF",
        },
      },
      fontFamily: {
        sans: ["var(--font-karla)", "system-ui", "sans-serif"],
        display: ["var(--font-mukta)", "system-ui", "sans-serif"],
        serif: ["var(--font-radley)", "Georgia", "serif"],
      },
      boxShadow: {
        soft: "0 10px 30px -12px rgba(102, 32, 42, 0.16)",
        card: "0 12px 40px -16px rgba(0,0,0,0.18)",
      },
      keyframes: {
        floaty: {
          "0%,100%": { transform: "translateY(0px)" },
          "50%":      { transform: "translateY(-10px)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        floaty: "floaty 6s ease-in-out infinite",
        shimmer: "shimmer 3s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
