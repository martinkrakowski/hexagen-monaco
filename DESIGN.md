# DESIGN.md — Authoritative UI Contract

> **Version:** 1.1.1
> **Status:** Active
> **Changelog:**
> | Version | Date | Summary |
> |---------|------|---------|
> | 1.1.1 | 2026-04-25 | Phase 3 completion: All 75 arbitrary Tailwind violations resolved; 4 component tokens finalized (--card-width-sm/md, --nav-indent, --canvas-height-sm); full design system compliance achieved. ESLint rule deployed to prevent regressions. |
> | 1.1.0 | 2026-04-23 | P0: Next.js 16+, @hexagen/ui/types, arbitrary-value exceptions. P1: NoSemanticState enforcement, component inventory, Tailwind config. P2: CSS utilities, ProjectionToken system, color-scheme vars |
> | 1.0.0 | 2026-04-23 | Initial authoritative contract |

---

## 0. Document Scope & Boundaries

### In Scope

This document governs all decisions related to: design tokens, component engineering contracts, styling rules, interaction states, and UI audit procedures.

### Out of Scope

This document does **not** govern:

- Routing conventions or file-based routing structure
- Server action patterns and data mutation flows
- Testing strategy (unit, integration, e2e)
- Branching strategy, Git workflows, or deployment pipelines
- Authentication and authorization logic
- CI/CD configuration

For those concerns, refer to `AGENTS.md` and project documentation.

---

## 1. Core Directives for AI-Assisted Code Generation

This document is the **authoritative** contract for all AI-assisted code generation. On ingestion, the following behavioral rules are non-negotiable:

- **Role:** You are a deterministic execution engine. Do not invent architectural patterns, hallucinate CSS utilities, or guess data shapes.
- **Boundary Compliance:** Build strictly within the tokens, component contracts, and schemas defined in this document. If this document does not define it, do not create it.
- **Clarification Protocol:** If a requested component requires a token, interaction state, data schema, or architectural pattern not explicitly defined here, halt and ask for clarification. Do not infer or approximate a solution.
- **No Inline Styles:** Prohibited without exception.
- **No Arbitrary Values:** Tailwind arbitrary values (e.g., `w-[347px]`, `text-[13px]`) are prohibited unless a specific exception is documented in Section 4.
- **No `any`:** TypeScript strict mode is active. The `any` type is prohibited.
- **Versioning Awareness:** If provided a version header, treat this document as superseding all prior versions ingested in the current or previous sessions.

---

## 2. Technology Stack

| Concern         | Technology                     | Notes                                 |
| --------------- | ------------------------------ | ------------------------------------- |
| Framework       | Next.js 16+ (App Router)       | Server components by default          |
| Language        | TypeScript (strict)            | `any` prohibited                      |
| Styling         | Tailwind CSS + CSS Variables   | No inline styles, no CSS Modules      |
| UI Primitives   | `@hexagen/ui`                  | Custom component library              |
| Icons           | Lucide React                   | No other icon libraries               |
| Variants        | class-variance-authority (CVA) | Required for multi-variant components |
| UI Linting      | `@hexagen/eslint-plugin-ui`    | Enforces projection-layer boundaries  |
| Package Manager | Yarn                           | Turborepo monorepo                    |

---

## 3. Architecture & Boundary Enforcement

### 3.1 Layer Isolation

- Components in `@hexagen/ui` are **presentation-only**. They receive typed props and render UI. Nothing else.
- UI components must never directly import database clients, ORMs, Prisma, or raw server actions.
- Data fetching and mutation are the responsibility of route handlers, server components at the route boundary, or explicitly designated boundary components.

### 3.2 Semantic Naming Conventions

Component names must reflect domain intent and align with standard React mental models.

| Pattern         | Prohibited                            | Required                                          |
| --------------- | ------------------------------------- | ------------------------------------------------- |
| Layout wrappers | `HomeShell`, `MainLayout`, `PageWrap` | Domain-specific naming (e.g., `ProjectWorkspace`) |
| Data grids      | `Table`, `List`, `DataThing`          | Domain-specific (e.g., `EntityDataGrid`)          |
| Stat displays   | `Card`, `Box`, `InfoBlock`            | Domain-specific (e.g., `StatCard`)                |
| Navigation      | `Nav`, `SideBar`                      | `PrimaryNavigation`, `WorkspaceSidebar`           |

### 3.3 Cross-Layer Import Rule

```
@hexagen/ui → can import from: internal types, internal lib, utils
apps/web → can import from: @hexagen/ui, domain packages, utils
domain/ → can import from: types, utils

No reverse imports. No circular dependencies.
```

### 3.4 Presentation-Only Enforcement

The "presentation-only" rule in §3.1 is enforced at compile time via the `NoSemanticState<T>` branded type from `@hexagen/ui/types`. All `@hexagen/ui` component props **must** extend `NoSemanticState<T>`.

This wrapper strips information-state props at the type level. The following props are **forbidden** in any `@hexagen/ui` component:

| Forbidden Prop | Reason                                        |
| -------------- | --------------------------------------------- |
| `data`         | Data belongs in domain/boundary layers        |
| `loading`      | UI components render, they do not fetch       |
| `error`        | Error handling belongs in boundary components |
| `result`       | Result state is domain concern                |
| `isFetching`   | Async state is not a presentation concern     |
| `status`       | Status tracking is domain concern             |
| `governance`   | Governance state is domain concern            |
| `llm`          | LLM state is domain concern                   |
| `isPending`    | Async state is not a presentation concern     |
| `isSuccess`    | Async state is not a presentation concern     |
| `isError`      | Error handling belongs in boundary components |

**Usage pattern:**

```typescript
import type { NoSemanticState } from "@hexagen/ui/types";

export interface ButtonProps extends NoSemanticState<
  ButtonHTMLAttributes<HTMLButtonElement>
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}
```

Attempting to pass a forbidden prop (e.g., `<Button loading={true} />`) will produce a compile-time type error.

---

## 4. Design Tokens

All styling must use these resolved tokens. Tailwind classes map to CSS variables defined in `globals.css` and registered in `tailwind.config.ts`.

### 4.1 Color Tokens — Light Mode

#### `globals.css` Variable Definitions (Light)

```css
:root {
  /* Mono font — system stack, no external dependency */
  --app-font-mono: "Menlo", "Monaco", "Cascadia Code", "Courier New", monospace;

  /* Light mode */
  color-scheme: light;

  /* Background and foreground */
  --background: 35 20% 96%;
  --foreground: 35 10% 15%;

  /* Card surfaces */
  --card: 35 10% 98%;
  --card-foreground: 35 10% 15%;
  --card-border: 35 10% 90%;

  /* Sidebar surfaces */
  --sidebar: 35 15% 14%;
  --sidebar-foreground: 35 10% 90%;
  --sidebar-border: 35 10% 20%;
  --sidebar-primary: 235 40% 45%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 35 10% 22%;
  --sidebar-accent-foreground: 35 10% 85%;
  --sidebar-ring: 235 40% 45%;

  /* Primary brand - muted indigo-blue */
  --primary: 235 40% 45%;
  --primary-foreground: 0 0% 100%;

  /* Secondary - warm neutral */
  --secondary: 35 10% 92%;
  --secondary-foreground: 35 10% 20%;

  /* Muted - warm gray */
  --muted: 35 8% 90%;
  --muted-foreground: 35 5% 45%;

  /* Accent - warm highlight */
  --accent: 35 15% 88%;
  --accent-foreground: 35 10% 20%;

  /* Borders and inputs */
  --border: 35 10% 85%;
  --input: 35 8% 80%;
  --ring: 235 40% 45%;

  /* Semantic status colors */
  --destructive: 25 70% 50%;
  --destructive-foreground: 0 0% 100%;

  --warning: 38 70% 50%;
  --warning-foreground: 35 10% 15%;

  --success: 140 30% 40%;
  --success-foreground: 0 0% 100%;

  --info: 210 40% 45%;
  --info-foreground: 0 0% 100%;

  /* Popover */
  --popover: 0 0% 100%;
  --popover-foreground: 35 10% 15%;

  /* Overlay */
  --overlay: 35 10% 15%;

  /* Radius */
  --radius: 0.375rem;
}
```

### 4.2 Color Tokens — Dark Mode

#### `globals.css` Variable Definitions (Dark)

```css
.dark {
  color-scheme: dark;

  /* Background and foreground */
  --background: 35 10% 8%;
  --foreground: 35 10% 92%;

  /* Card surfaces */
  --card: 35 12% 12%;
  --card-foreground: 35 10% 92%;
  --card-border: 35 10% 22%;

  /* Sidebar surfaces */
  --sidebar: 35 10% 6%;
  --sidebar-foreground: 35 10% 75%;
  --sidebar-border: 35 10% 18%;
  --sidebar-primary: 235 40% 55%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 35 10% 15%;
  --sidebar-accent-foreground: 35 10% 75%;
  --sidebar-ring: 235 40% 55%;

  /* Primary brand */
  --primary: 235 40% 55%;
  --primary-foreground: 0 0% 100%;

  /* Secondary */
  --secondary: 35 10% 18%;
  --secondary-foreground: 35 10% 80%;

  /* Muted */
  --muted: 35 8% 15%;
  --muted-foreground: 35 5% 60%;

  /* Accent */
  --accent: 35 10% 20%;
  --accent-foreground: 35 10% 85%;

  /* Borders and inputs */
  --border: 35 10% 22%;
  --input: 35 8% 28%;
  --ring: 235 40% 55%;

  /* Semantic status colors */
  --destructive: 25 70% 45%;
  --destructive-foreground: 0 0% 100%;

  --warning: 38 70% 50%;
  --warning-foreground: 35 10% 15%;

  --success: 140 30% 45%;
  --success-foreground: 0 0% 100%;

  --info: 210 40% 50%;
  --info-foreground: 0 0% 100%;

  /* Popover */
  --popover: 35 12% 12%;
  --popover-foreground: 35 10% 92%;

  /* Overlay */
  --overlay: 35 10% 8%;
}
```

### 4.3 Tailwind Configuration

#### Color Mapping

```typescript
colors: {
  background: "hsl(var(--background))",
  foreground: "hsl(var(--foreground))",
  card: {
    DEFAULT: "hsl(var(--card))",
    foreground: "hsl(var(--card-foreground))",
    border: "hsl(var(--card-border))",
  },
  primary: {
    DEFAULT: "hsl(var(--primary))",
    foreground: "hsl(var(--primary-foreground))",
  },
  secondary: {
    DEFAULT: "hsl(var(--secondary))",
    foreground: "hsl(var(--secondary-foreground))",
  },
  muted: {
    DEFAULT: "hsl(var(--muted))",
    foreground: "hsl(var(--muted-foreground))",
  },
  accent: {
    DEFAULT: "hsl(var(--accent))",
    foreground: "hsl(var(--accent-foreground))",
  },
  destructive: {
    DEFAULT: "hsl(var(--destructive))",
    foreground: "hsl(var(--destructive-foreground))",
  },
  warning: {
    DEFAULT: "hsl(var(--warning))",
    foreground: "hsl(var(--warning-foreground))",
  },
  success: {
    DEFAULT: "hsl(var(--success))",
    foreground: "hsl(var(--success-foreground))",
  },
  info: {
    DEFAULT: "hsl(var(--info))",
    foreground: "hsl(var(--info-foreground))",
  },
  popover: {
    DEFAULT: "hsl(var(--popover))",
    foreground: "hsl(var(--popover-foreground))",
  },
  sidebar: {
    DEFAULT: "hsl(var(--sidebar))",
    foreground: "hsl(var(--sidebar-foreground))",
    primary: "hsl(var(--sidebar-primary))",
    "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
    accent: "hsl(var(--sidebar-accent))",
    "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
    border: "hsl(var(--sidebar-border))",
    ring: "hsl(var(--sidebar-ring))",
  },
  border: "hsl(var(--border))",
  input: "hsl(var(--input))",
  ring: "hsl(var(--ring))",
}
```

#### Border Radius

Derived from `--radius` (0.375rem / 6px):

| Tailwind Class | Computed Value                    | Use Case                |
| -------------- | --------------------------------- | ----------------------- |
| `rounded-lg`   | `var(--radius)` = 6px             | Cards, panels, modals   |
| `rounded-md`   | `calc(var(--radius) - 2px)` = 4px | Buttons, inputs, badges |
| `rounded-sm`   | `calc(var(--radius) - 4px)` = 2px | Small elements, chips   |

#### Container

```typescript
container: {
  center: true,
  padding: "2rem",
  screens: { "2xl": "1400px" },
}
```

#### Dark Mode

```typescript
darkMode: ["class"];
```

Theme toggling is controlled by the `.dark` class on the root element.

#### Font Family

```typescript
fontFamily: {
  sans: ["var(--app-font-sans)", "system-ui", "sans-serif"],
  mono: ["var(--app-font-mono)", "monospace"],
}
```

`--app-font-sans` is injected at runtime by `next/font`. `--app-font-mono` is a system-font stack defined in `globals.css`.

#### Plugins

| Plugin                    | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| `tailwindcss-animate`     | Animation utilities for component transitions |
| `@tailwindcss/typography` | Prose styling for rendered markdown content   |

### 4.4 Semantic Usage Rules

| Token Class             | Use For                            | Never Use For       |
| ----------------------- | ---------------------------------- | ------------------- |
| `bg-background`         | Page root, full-bleed areas        | Cards, panels       |
| `bg-card`               | Cards, sidebars, secondary panels  | Page root           |
| `bg-popover`            | Dropdowns, modals, popovers        | Flat layouts        |
| `text-foreground`       | Primary body text, headings        | Placeholders        |
| `text-muted-foreground` | Labels, helper text, metadata      | Primary headings    |
| `border`                | Dividers, card outlines            | Focus rings         |
| `ring`                  | Focus rings, active outlines       | Decorative dividers |
| `bg-primary`            | Primary CTA buttons, active states | Destructive actions |
| `bg-destructive`        | Delete, remove, danger actions     | Primary CTAs        |

### 4.5 Typography

| Token     | Tailwind Class                       | Use Case               |
| --------- | ------------------------------------ | ---------------------- |
| Font Sans | `font-sans` (injected via next/font) | All UI text            |
| Font Mono | `font-mono` (system stack)           | Code, IDs, timestamps  |
| XS        | `text-xs`                            | Badges, chip labels    |
| SM        | `text-sm`                            | Body copy, table cells |
| Base      | `text-base`                          | Default paragraph      |
| LG        | `text-lg`                            | Subheadings            |
| 2XL       | `text-2xl`                           | Section headings       |
| 4XL       | `text-4xl`                           | Page-level headings    |
| Normal    | `font-normal`                        | Body text              |
| Medium    | `font-medium`                        | Labels, nav items      |
| Bold      | `font-bold`                          | Headings, emphasis     |

### 4.6 Component Token Definitions

Components use derived tokens for consistent sizing and spacing. These tokens are defined in `globals.css` and inherit CSS variable delegation in dark mode:

| Token                    | Value  | Usage                                         |
| ------------------------ | ------ | --------------------------------------------- |
| `--button-height`        | 40px   | Button height (h-10)                          |
| `--button-padding-x`     | 12px   | Horizontal button padding                     |
| `--button-padding-y`     | 8px    | Vertical button padding                       |
| `--button-border-radius` | 4px    | Button corner radius (rounded-md)             |
| `--input-height`         | 40px   | Input field height                            |
| `--input-padding-x`      | 12px   | Input horizontal padding                      |
| `--input-padding-y`      | 8px    | Input vertical padding                        |
| `--input-border-radius`  | 4px    | Input corner radius                           |
| `--card-padding`         | 16px   | Default card padding (p-4)                    |
| `--card-padding-lg`      | 24px   | Large card padding (p-6)                      |
| `--card-gap`             | 16px   | Internal card spacing (gap-4)                 |
| `--card-border-radius`   | 6px    | Card corner radius (rounded-lg)               |
| `--card-width-sm`        | 256px  | Small card width (w-64) — Phase 3             |
| `--card-width-md`        | 280px  | Medium card width — Phase 3                   |
| `--badge-height`         | 20px   | Badge element height                          |
| `--badge-padding-x`      | 8px    | Badge horizontal padding                      |
| `--badge-border-radius`  | 9999px | Pill-shaped badge (rounded-full)              |
| `--nav-indent`           | 40px   | Navigation item left indent (pl-10) — Phase 3 |
| `--canvas-height-sm`     | 400px  | React Flow canvas fixed height — Phase 3      |
| `--page-section-gap`     | 24px   | Vertical gap between page sections            |
| `--form-field-gap`       | 8px    | Vertical gap between form fields              |

These tokens derive from Primitive tokens (e.g., `--spacing-*`, `--radius-*`) defined in Sections 4.1–4.3 and ensure consistency across components.

**Phase 3 Additions (2026-04-25):**

- `--card-width-sm`, `--card-width-md`: Standardize card dimensions across governance and dialog features
- `--nav-indent`: Account for navigation indent alignment (40px = 10 × 4px grid units)
- `--canvas-height-sm`: Centralize React Flow canvas height constraints (fixed 400px = 25 × 16px grid units)

### 4.7 Spacing & Layout

The 4px baseline grid is absolute. All spacing must resolve to a multiple of 4px.

| Scale Step | Tailwind Class           | px Value |
| ---------- | ------------------------ | -------- |
| 1          | `p-1`, `m-1`, `gap-1`    | 4px      |
| 2          | `p-2`, `m-2`, `gap-2`    | 8px      |
| 3          | `p-3`, `m-3`, `gap-3`    | 12px     |
| 4          | `p-4`, `m-4`, `gap-4`    | 16px     |
| 6          | `p-6`, `m-6`, `gap-6`    | 24px     |
| 8          | `p-8`, `m-8`, `gap-8`    | 32px     |
| 12         | `p-12`, `m-12`, `gap-12` | 48px     |
| 16         | `p-16`, `m-16`, `gap-16` | 64px     |

**Border Radii:**
| Context | Class |
|---------|-------|
| Buttons, inputs, badges | `rounded-md` |
| Cards, panels, modals | `rounded-lg` |
| Full circular avatars | `rounded-full` |

### 4.8 Interaction States

#### Focus (Accessibility — Required on All Interactive Elements)

```css
.focus-visible:outline-none.focus-visible:ring-2.focus-visible:ring-ring
```

In Tailwind:

```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
```

#### Hover

```
hover:bg-accent/80          /* surface shift for containers */
hover:text-foreground      /* text brightening from muted state */
hover:bg-primary/90         /* CTA darkening */
hover:bg-destructive/90   /* danger darkening */
```

#### Active / Pressed

```
active:scale-[0.98] active:opacity-90
```

#### Arbitrary Value Exceptions

The following arbitrary Tailwind values are the **only** permitted exceptions to the "No Arbitrary Values" rule in §1. Any other arbitrary value requires a DESIGN.md update before implementation.

| Pattern                    | Value                 | Justification                              |
| -------------------------- | --------------------- | ------------------------------------------ |
| Interactive press feedback | `active:scale-[0.98]` | Micro-animation for tactile press response |

#### Disabled

```
disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none
```

#### Transitions (Applied Globally to Interactive Elements)

```
transition-colors
```

#### CSS Utility Classes

The following custom CSS utility classes are defined in `globals.css` and are approved for use alongside Tailwind classes:

| Class                  | Purpose                                                                       | Source        |
| ---------------------- | ----------------------------------------------------------------------------- | ------------- |
| `.focus-ring`          | Accessible focus ring using `--ring` token (2px background offset + 4px ring) | `globals.css` |
| `.custom-scrollbar`    | Thin scrollbar styled with `--muted-foreground` token                         | `globals.css` |
| `.animate-slide`       | Horizontal slide animation (2s infinite)                                      | `globals.css` |
| `.animate-soft-pulse`  | Gentle opacity pulse (2.5s infinite)                                          | `globals.css` |
| `.animate-spin-border` | Conic-gradient border rotation (6s infinite)                                  | `globals.css` |
| `.animate-shimmer`     | Horizontal shimmer effect (1.4s infinite)                                     | `globals.css` |
| `.animate-dot-pulse`   | Dot pulse with primary-color box-shadow (1.6s infinite)                       | `globals.css` |
| `.bg-cinematic-border` | Conic-gradient border background for ModelProgressCard                        | `globals.css` |

**Motion preference compliance:** All animation utilities respect `prefers-reduced-motion: reduce` — animations are disabled automatically when the user has reduced motion enabled.

**React Flow overrides:** The following `.react-flow__*` overrides are defined in `globals.css` to integrate React Flow with the design system. Do not override these without updating this section:

- `.react-flow__node-group` — transparent background/border
- `.react-flow__pane` — transparent background
- `.react-flow__background` — uses `--card` token

### 4.9 Exception: Canvas Component Styling

The canvas components (e.g., `BoundedContext.tsx`, `PeerContextNode.tsx` in `/apps/web/features/hexagon-canvas/`) use inline styles for React Flow integration. This is a **documented exception** because React Flow requires dynamic node positioning that cannot be expressed via CSS classes.

**Permitted inline styles for canvas components:**

- `width`, `height` — for node dimensions
- `transform` — for node positioning (x, y coordinates)
- `opacity` — for visual states

**Why this exception exists:**

- React Flow calculates positions at runtime; CSS classes cannot express arbitrary pixel coordinates
- CSS-in-JS solutions are not available due to build constraints
- This is a presentation-only concern (interaction state, not information state)

**Implementation:**
All inline styles for positioning are isolated in `/apps/web/features/hexagon-canvas/adapters/CanvasNodeStyleAdapter.tsx`. This adapter component is the **only** permitted location for inline styles in the codebase.

**Future migration:**
If React Flow adds CSS variable support for positioning (e.g., `--node-x`, `--node-y`), these inline styles can be migrated to CSS variables, eliminating this exception.

---

## 5. Component Engineering Contracts

### 5.1 `@hexagen/ui` Component Structure

The UI library is organized with semantic categories:

| Directory      | Purpose                  | Examples                                                            |
| -------------- | ------------------------ | ------------------------------------------------------------------- |
| `elements/`    | Primitive UI bricks      | Button, Card, Input, Badge, Label, Textarea, Icon                   |
| `modules/`     | Composite interactive    | Tabs, ViewToggle, FileDropZone                                      |
| `sections/`    | Layout containers        | Dialog                                                              |
| `controllers/` | Interaction hooks        | useDialog, useDisclosure, useFocusTrap, usePress, useRovingTabIndex |
| `tokens/`      | Branded token system     | projection-token (compile-time token validation)                    |
| `types/`       | Branded type enforcement | forbidden-brand (NoSemanticState, FORBIDDEN_TOKENS)                 |
| `lib/`         | Shared utilities         | cn() class merge helper                                             |

### 5.2 Composition Priority

1. Use an existing **`@hexagen/ui` primitive** as-is.
2. **Compose** multiple primitives together.
3. Write **custom Tailwind markup** only if no primitive exists or can be composed.
4. Document any custom component explaining why a primitive was insufficient.

### 5.3 Anti-Prop-Bloat Rules

Components must not accumulate highly specific boolean flags.

**Prohibited pattern:**

```tsx
// ❌ Do not do this
<StatCard isCompact isBorderless hideShadowOnMobile showTrendArrow />
```

**Required pattern — use CVA variants:**

```tsx
// ✅ Correct approach
const statCardVariants = cva("base-classes", {
  variants: {
    size: { default: "...", compact: "..." },
    appearance: { default: "...", borderless: "..." },
  },
  defaultVariants: { size: "default", appearance: "default" },
});
```

### 5.4 Data Hydration Contract

Pass complete, typed data objects rather than decomposed primitive props.

```tsx
// ❌ Prohibited — 10+ primitive props
<UserRow id={u.id} name={u.name} email={u.email} role={u.role} avatarUrl={u.avatarUrl} ... />

// ✅ Required — typed object
<UserRow user={user} />
```

### 5.5 Server vs. Client Component Rules

- Default to **Server Components**.
- Add `'use client'` only when the component requires: browser APIs, event handlers, React hooks (`useState`, `useEffect`), or third-party client-only libraries.
- Never add `'use client'` preemptively.

### 5.6 Projection Token System

Token identifiers in the projection layer must use the `ProjectionToken` branded type from `@hexagen/ui/tokens`. This prevents forbidden tokens from entering the projection layer at compile time and runtime.

**Core types:**

| Type                     | Purpose                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `ProjectionToken<T>`     | Branded string type for token identifiers                                            |
| `SafeProjectionToken<T>` | Strips forbidden tokens at the type level (resolves to `never` for forbidden tokens) |

**Core functions:**

| Function                         | Purpose                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `createProjectionToken(token)`   | Runtime-validated factory — throws if token is forbidden |
| `validateProjectionToken(token)` | Type guard for ProjectionToken                           |
| `getAllowedTokens(tokens[])`     | Filters an array, keeping only valid ProjectionTokens    |

**Rule:** Never use raw strings as token identifiers in the projection layer. Always create them via `createProjectionToken()` or validate via `validateProjectionToken()`.

---

## 6. Data Contracts & Type Safety

### 6.1 Type Definition Standards

- All types must be defined in appropriate packages (e.g., `@hexagen/ui/types` or domain packages).
- Use TypeScript interfaces for structured data shapes.
- TypeScript strict mode is enforced — `any` is prohibited.

### 6.2 Mocked Execution Protocol

When scaffolding a new view, static data matching the type definition will be provided. The AI must:

1. Build the UI exclusively against the provided mock and its inferred type.
2. Never fabricate mock data structures.
3. Never assume a field exists that is not in the type.

---

## 7. Prompting Protocol & Execution Loop

### 7.1 Session Priming (Required for Every New Session)

Feed the model the following context before any component request:

1. This `DESIGN.md` (current version).
2. The relevant type definition for the target view.
3. The static data mock for the target view.
4. The specific atomic task.

### 7.2 Bottom-Up Construction Sequence

Do not request composite views in a single prompt. Scaffold atomically:

```
Level 1: Primitive component    → "Build Button accepting type ButtonProps"
Level 2: Composition component → "Build Card composing primitive elements"
Level 3: Layout assembly      → "Build ProjectWorkspace composing Card and Sidebar"
Level 4: Route page         → "Build the /dashboard page with mocked data"
```

### 7.3 Correction Protocol

When the AI produces a violation, reference the specific contract:

```
// ❌ Vague correction
"The padding looks wrong, fix it."

// ✅ Contract-referenced correction
"This component uses p-5 (20px), which is not on the 4px baseline spacing scale
defined in DESIGN.md Section 4.6. Replace with p-4 (16px) or p-6 (24px)."
```

---

## 8. Reconciliation & Audit Protocol

Periodic reconciliation audits realign the codebase with this document.

### 8.1 Token Audit

- Diff `globals.css` and `tailwind.config.ts` against Section 4.
- Flag any CSS variable or color value not defined in this document.
- Flag any Tailwind arbitrary value not listed as an exception.

### 8.2 Component Contract Audit

- Review all components in `@hexagen/ui` for prop bloat.
- Identify any component with more than 2 boolean flag props.
- Flag components using inline styles.
- Identify components that should be consuming `@hexagen/ui` primitives but are reimplementing them.

### 8.3 Type Safety Audit

- Identify any manual type definitions that could be centralized.
- Flag any use of `any`, `unknown` without explicit narrowing, or unvalidated `as` casts.

### 8.4 Visual Validation Hook

The auditing session may include screenshot or rendered output inputs. On receipt, check for:

- Spacing deviations from the 4px grid.
- Color values that do not match Section 4 tokens.
- Typography scale violations.
- Interaction states missing focus rings.
- Alignment inconsistencies in grid or flex layouts.

### 8.5 Audit Output Format

Report findings in the following structure:

```
## Reconciliation Audit — [Date] — v[N]

### Token Violations
- [ ] `components/StatCard.tsx:34` — uses arbitrary `p-[18px]`, not on standard scale.

### Prop Bloat
- [ ] `components/UserRow.tsx` — has 4 boolean flags. Refactor to CVA variants.

### Type Safety
- [ ] `types/invoice.ts` — manually defined interface. Consider centralized typing.

### Visual Deviations (from screenshot)
- [ ] Dashboard grid gap appears to be 20px, not matching gap-6 (24px) specification.
```

---

## 9. Document Maintenance

- This document is **authoritative but not immutable**. It evolves with the project.
- Any change to a token value, component contract, or stack decision requires a version bump and a changelog entry at the top of this file.
- All AI sessions must ingest the current version header to prevent stale-contract conflicts.
