/**
 * TypeScript token manifest.
 *
 * Each value is a `var(--token)` reference, NOT a hardcoded hex/size — so the
 * CSS custom properties in tokens.css remain the single source of truth. Use
 * this when JS/TS needs a token (inline styles, charting libs, canvas, etc.):
 *
 *   <div style={{ color: theme.colors.brand.primary }} />
 */
export const theme = {
  colors: {
    brand: {
      primary: "var(--color-brand-primary)",
      primaryHover: "var(--color-brand-primary-hover)",
      secondary: "var(--color-brand-secondary)",
    },
    surface: {
      background: "var(--color-background)",
      surface: "var(--color-surface)",
      border: "var(--color-border)",
    },
    text: {
      primary: "var(--color-text-primary)",
      secondary: "var(--color-text-secondary)",
      muted: "var(--color-text-muted)",
    },
    semantic: {
      success: "var(--color-success)",
      warning: "var(--color-warning)",
      error: "var(--color-error)",
      info: "var(--color-info)",
    },
  },
  font: {
    sans: "var(--font-sans)",
    mono: "var(--font-mono)",
  },
  radius: {
    sm: "var(--radius-sm)",
    md: "var(--radius-md)",
    lg: "var(--radius-lg)",
    full: "var(--radius-full)",
  },
  shadow: {
    sm: "var(--shadow-sm)",
    md: "var(--shadow-md)",
    lg: "var(--shadow-lg)",
  },
  duration: {
    fast: "var(--duration-fast)",
    normal: "var(--duration-normal)",
  },
} as const;

export type Theme = typeof theme;
export type ThemeColorGroup = keyof Theme["colors"];
