# Template: Design System

**Branch:** `feature/generator-template-design-system`

## Purpose

Generates a structured, token-based design foundation: a fully populated `DESIGN.md` (which Claude Code reads as an immutable anchor), CSS custom properties, a TypeScript theme manifest, a Tailwind config, and a small set of base UI component stubs. Prevents visual inconsistency from the first commit.

---

## Install-Time Questions

| ID               | Prompt                                 | Type    | Options                                                | Default            |
| ---------------- | -------------------------------------- | ------- | ------------------------------------------------------ | ------------------ |
| `primary_color`  | Primary brand color (hex)?             | text    | —                                                      | `#6366f1`          |
| `color_scale`    | Colour scale strategy?                 | select  | `tailwind-default`, `custom-palette`, `oklch-adaptive` | `tailwind-default` |
| `typography`     | Base font stack?                       | select  | `system-ui`, `inter`, `geist`, `custom`                | `geist`            |
| `dark_mode`      | Dark mode support?                     | select  | `none`, `css-class`, `media-query`, `both`             | `css-class`        |
| `component_base` | UI component base?                     | select  | `shadcn-ui`, `radix-primitives`, `headlessui`, `none`  | `shadcn-ui`        |
| `icon_library`   | Icon library?                          | select  | `lucide-react`, `heroicons`, `phosphor`, `none`        | `lucide-react`     |
| `storybook`      | Set up Storybook?                      | boolean | —                                                      | `false`            |
| `animation`      | Include motion tokens (framer-motion)? | boolean | —                                                      | `false`            |

---

## Files Generated

```
DESIGN.md                          # Populated design contract (read by Claude Code)

src/
  styles/
    tokens.css                     # CSS custom properties (design tokens)
    globals.css                    # Global resets + token imports
    theme.ts                       # TypeScript token manifest (matches CSS vars)
  components/
    ui/
      button.tsx
      card.tsx
      input.tsx
      badge.tsx
      spinner.tsx
      index.ts
  lib/
    cn.ts                          # clsx + tailwind-merge utility

tailwind.config.ts                 # Extends Tailwind with token values
```

If `storybook=true`:

```
.storybook/
  main.ts
  preview.ts
src/
  components/
    ui/
      button.stories.tsx
```

---

## Key Design Decisions

**`DESIGN.md` is the contract, not the CSS:** The CSS tokens implement the contract. When a developer or AI agent modifies a component, they check `DESIGN.md` first. The file must describe intent (e.g., "Primary action buttons use the brand colour at 100% opacity; hover is 90%"), not just values.

**CSS custom properties are the single source:** TypeScript token manifest (`theme.ts`) reads the CSS variable names, not hardcoded hex values. This means if a token changes, it changes in one place (the CSS file) and propagates everywhere without a TypeScript recompile.

**Tailwind config extends, never replaces:** The generated `tailwind.config.ts` extends the default Tailwind palette with project tokens under a `brand` key. Existing Tailwind classes still work. This prevents the "nothing works after I changed the config" problem.

**Stubs, not full implementations:** Generated components are skeletal — they render correctly and are accessible, but they are not polished. The intent is to establish the pattern (props interface, `cn()` usage, variant pattern) that the developer extends.

---

## Phase 1 — DESIGN.md Population

**Goal:** A complete, opinionated `DESIGN.md` that is immediately useful as a Claude Code anchor.

Sections:

```markdown
# Design System

## Colour Tokens

| Token           | CSS Variable              | Value   | Usage                      |
| --------------- | ------------------------- | ------- | -------------------------- |
| Brand Primary   | `--color-brand-primary`   | #6366f1 | CTAs, active states, links |
| Brand Secondary | `--color-brand-secondary` | #8b5cf6 | Hover states, accents      |

...

## Typography Scale

| Token | CSS Variable | Size | Weight | Usage |
...

## Spacing Scale

Follows a 4px base unit. Use Tailwind spacing classes (p-4 = 16px).

## Component Constraints

- Buttons: border-radius = --radius-md. Never use square buttons.
- Cards: shadow = --shadow-sm. Elevation is not used for decorative purposes.
- Inputs: border = 1px solid --color-border. Focus ring = --color-brand-primary at 50% opacity.

## Prohibited Patterns

- Do not use arbitrary Tailwind values (e.g., w-[237px]) without a design reason.
- Do not hardcode hex values in components. Use CSS variables.
- Do not mix light/dark mode logic in component files — use CSS variables that adapt.
```

Validation: `DESIGN.md` exists and is non-empty; all referenced CSS variables exist in `tokens.css`.

---

## Phase 2 — CSS Token File

**Goal:** Complete CSS custom property definitions for all design tokens.

`src/styles/tokens.css`:

```css
:root {
  /* Brand */
  --color-brand-primary: #6366f1;
  --color-brand-secondary: #8b5cf6;
  --color-brand-primary-hover: #4f46e5;

  /* Neutral */
  --color-background: #ffffff;
  --color-surface: #f8fafc;
  --color-border: #e2e8f0;
  --color-text-primary: #0f172a;
  --color-text-secondary: #64748b;
  --color-text-muted: #94a3b8;

  /* Semantic */
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-info: #3b82f6;

  /* Typography */
  --font-sans: 'Geist', system-ui, sans-serif;
  --font-mono: 'Geist Mono', monospace;

  /* Spacing (base: 4px) */
  --space-1: 0.25rem; /* 4px */
  --space-2: 0.5rem;  /* 8px */
  ...

  /* Radius */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);

  /* Animation */
  --duration-fast: 150ms;
  --duration-normal: 250ms;
  --easing-default: cubic-bezier(0.4, 0, 0.2, 1);
}

.dark {
  --color-background: #0f172a;
  --color-surface: #1e293b;
  --color-border: #334155;
  --color-text-primary: #f8fafc;
  --color-text-secondary: #94a3b8;
}
```

Validation: CSS parses without errors; dark mode variables override root variables correctly.

---

## Phase 3 — TypeScript Token Manifest

**Goal:** Type-safe token access for cases where JavaScript needs the values.

```typescript
// src/styles/theme.ts
export const theme = {
  colors: {
    brand: {
      primary: "var(--color-brand-primary)",
      secondary: "var(--color-brand-secondary)",
    },
    text: {
      primary: "var(--color-text-primary)",
      secondary: "var(--color-text-secondary)",
    },
    // ...
  },
  radius: {
    sm: "var(--radius-sm)",
    md: "var(--radius-md)",
    lg: "var(--radius-lg)",
  },
  duration: { fast: "var(--duration-fast)", normal: "var(--duration-normal)" },
} as const;

export type ThemeColor = keyof typeof theme.colors;
```

Validation: `theme.colors.brand.primary` resolves to `'var(--color-brand-primary)'` at TypeScript compile time.

---

## Phase 4 — Tailwind Config Extension

**Goal:** Tailwind config that references CSS custom properties so both systems stay in sync.

```typescript
// tailwind.config.ts
export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "var(--color-brand-primary)",
          secondary: "var(--color-brand-secondary)",
          "primary-hover": "var(--color-brand-primary-hover)",
        },
        border: "var(--color-border)",
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        // ...
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
    },
  },
};
```

Validation: `yarn build` compiles; Tailwind class `text-brand-primary` resolves to the CSS variable.

---

## Phase 5 — Base Component Stubs

**Goal:** Four foundational components that establish the pattern (variants, `cn()`, accessibility).

`lib/cn.ts`:

```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

`components/ui/button.tsx`:

```typescript
import { cn } from "@/lib/cn";
type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}
```

Components follow:

- Named props with explicit TypeScript types
- `cn()` for conditional class composition
- `aria-*` attributes where relevant
- `data-testid` prop (optional) for testing

Validation: `yarn typecheck` passes; components render in a basic React test.

---

## Phase 6 — Storybook (opt-in)

**Goal:** Working Storybook configuration with a Button story as the reference.

Install: `@storybook/nextjs`, `@storybook/addon-essentials`

`.storybook/preview.ts`:

```typescript
import "../src/styles/tokens.css";
import "../src/styles/globals.css";
export const parameters = { backgrounds: { disable: true } };
```

`button.stories.tsx`:

```typescript
export default { title: "UI/Button", component: Button };
export const Primary = { args: { variant: "primary", children: "Click me" } };
export const Loading = { args: { isLoading: true, children: "Loading..." } };
```

Validation: `yarn storybook` starts; Button story renders all variants.

---

## Post-Install Checklist

```
✅ design-system installed

Next steps:
  1. Review DESIGN.md — it is now an immutable design contract for Claude Code
  2. Update --color-brand-primary in src/styles/tokens.css with your brand colour
  3. Run: yarn dev and verify token-based classes resolve correctly in browser DevTools
  4. Import globals.css in app/layout.tsx if not already present
  5. Extend components/ui/ with project-specific components following the established pattern
  6. If storybook: run yarn storybook to verify all base components render
```

---

## Template Dependencies

- No required dependencies
- Soft dependency: `agents-md` (DESIGN.md is referenced in the generated AGENTS.md anchor rule)
