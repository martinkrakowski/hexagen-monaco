import type { Config } from "tailwindcss";

/**
 * Tailwind config that *extends* the default palette with project tokens rather
 * than replacing it — every stock Tailwind class keeps working, and the `brand`
 * / token scales below resolve to the CSS custom properties in
 * src/styles/tokens.css, so Tailwind and raw CSS stay in sync.
 *
 * darkMode is "class" (toggle by adding `dark` to <html>). Switch to "media" if
 * you chose the media-query dark_mode strategy — see DESIGN.md.
 */
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--color-brand-primary)",
          primary: "var(--color-brand-primary)",
          "primary-hover": "var(--color-brand-primary-hover)",
          secondary: "var(--color-brand-secondary)",
        },
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        border: "var(--color-border)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-muted": "var(--color-text-muted)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        error: "var(--color-error)",
        info: "var(--color-info)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
      },
    },
  },
  plugins: [],
};

export default config;
