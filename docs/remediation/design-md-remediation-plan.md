# Remediation Plan — DESIGN.md Updates

> **Date:** 2026-04-23
> **Status:** Pending Approval
> **Scope:** DESIGN.md document-only changes (no code changes)
> **Version:** 1.0.0

---

## Summary

10 gaps identified between `DESIGN.md` v1.0.0 and the actual codebase. This plan addresses all document-level inaccuracies, missing enforcement mechanisms, and internal contradictions. No source code is modified.

---

## P0 — Critical (Contract Integrity)

### 1. Fix Next.js version

| Field       | Value                                    |
| ----------- | ---------------------------------------- |
| **Section** | §2 Technology Stack                      |
| **Current** | `Next.js 14+ (App Router)`               |
| **Actual**  | `^16.1.6` per `apps/web/package.json:45` |
| **Change**  | Update to `Next.js 16+ (App Router)`     |
| **Lines**   | 1                                        |

### 2. Remove phantom `@hexagen/types` package reference

| Field       | Value                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| **Section** | §3.3 Cross-Layer Import Rule                                                                                |
| **Current** | `@hexagen/ui → can import from: @hexagen/types, utils`                                                      |
| **Actual**  | No `@hexagen/types` package exists. Types live in `packages/ui/src/types/` and domain packages.             |
| **Change**  | Replace `@hexagen/types` with `@hexagen/ui/types` and add a note that types are co-located in `@hexagen/ui` |
| **Lines**   | 2–3                                                                                                         |

| Field       | Value                                             |
| ----------- | ------------------------------------------------- |
| **Section** | §6.1 Type Definition Standards                    |
| **Current** | `e.g., @hexagen/types or domain packages`         |
| **Change**  | Replace `@hexagen/types` with `@hexagen/ui/types` |
| **Lines**   | 1                                                 |

### 3. Resolve arbitrary value contradiction

| Field       | Value                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Section** | §1 Core Directives + §4.7 Interaction States                                                                                                                                                                                                     |
| **Problem** | §1 prohibits arbitrary values unless documented in §4. §4.7 prescribes `active:scale-[0.98]` — an arbitrary value — with no exception listed.                                                                                                    |
| **Change**  | Add an **Arbitrary Value Exceptions** table to §4.7 (or a new §4.8) documenting: `active:scale-[0.98]` — micro-press feedback on interactive elements; `active:opacity-90` — press state opacity. These are the only permitted arbitrary values. |
| **Lines**   | ~5                                                                                                                                                                                                                                               |

---

## P1 — High (Missing Enforcement Mechanisms)

### 4. Document `NoSemanticState<T>` and `FORBIDDEN_TOKENS`

| Field       | Value                                                                                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Section** | New §3.4 "Presentation-Only Enforcement"                                                                                                                                                                                                                                                           |
| **Problem** | The `NoSemanticState<T>` branded type from `forbidden-brand.ts` is the compile-time mechanism enforcing §3.1 "presentation-only" rule. It prohibits information-state props in `@hexagen/ui` components. Without documenting it, AI will attempt to add `loading`, `error`, `data`, etc. as props. |
| **Change**  | Add §3.4 containing:                                                                                                                                                                                                                                                                               |
|             | a. Description of `NoSemanticState<T>` wrapper type                                                                                                                                                                                                                                                |
|             | b. The `FORBIDDEN_TOKENS` list: `data`, `loading`, `error`, `result`, `isFetching`, `governance`, `llm`, `status`, `isPending`, `isSuccess`, `isError`                                                                                                                                             |
|             | c. Rule: All `@hexagen/ui` component props must extend `NoSemanticState<T>` — these props are stripped at the type level                                                                                                                                                                           |
|             | d. Example: `ButtonProps extends NoSemanticState<ButtonHTMLAttributes<HTMLButtonElement>>`                                                                                                                                                                                                         |
| **Lines**   | ~20                                                                                                                                                                                                                                                                                                |

### 5. Update component inventory in §5.1

| Field       | Value                                                       |
| ----------- | ----------------------------------------------------------- |
| **Section** | §5.1 Component Structure                                    |
| **Current** | Elements: Button, Card, Input, Badge, Label                 |
| **Actual**  | Elements: Badge, Button, Card, Icon, Input, Label, Textarea |
| **Change**  | Add `Icon`, `Textarea` to elements examples                 |

| **Current** | Controllers: (future expansion) |
| **Actual** | Controllers: useDialog, useDisclosure, useFocusTrap, usePress, useRovingTabIndex |
| **Change** | Update controllers row with actual inventory |

| **Current** | Tokens: (future expansion) |
| **Actual** | Tokens: projection-token.ts (branded type system) |
| **Change** | Update tokens row with actual inventory |

| **Missing** | `lib/` directory (contains `utils.ts`) |
| **Change** | Add `lib/` row: Shared utilities (e.g., `cn()` class merge helper) |

| **Missing** | `types/` directory |
| **Change** | Add `types/` row: Branded type enforcement (e.g., `forbidden-brand.ts`) |

| **Lines** | ~8 |

### 6. Document Tailwind configuration beyond colors

| Field       | Value                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| **Section** | §4.3 (expand) or new §4.3.1                                                                                         |
| **Problem** | Only `colors` mapping is documented. Four other config features are missing.                                        |
| **Change**  | Add subsections for:                                                                                                |
|             | a. `borderRadius` derivation: `lg: var(--radius)`, `md: calc(var(--radius) - 2px)`, `sm: calc(var(--radius) - 4px)` |
|             | b. `container`: `center: true`, `padding: 2rem`, `max-width: 1400px` at 2xl                                         |
|             | c. `darkMode: ["class"]` — `.dark` class toggles theme                                                              |
|             | d. `plugins`: `tailwindcss-animate`, `@tailwindcss/typography`                                                      |
|             | e. `fontFamily`: `sans` and `mono` with CSS variable fallbacks                                                      |
| **Lines**   | ~25                                                                                                                 |

---

## P2 — Medium (Completeness)

### 7. Document CSS utility classes from `globals.css`

| Field       | Value                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Section** | New §4.8 "CSS Utility Classes"                                                                                                  |
| **Problem** | `globals.css` defines custom utility classes not in DESIGN.md. AI may recreate or ignore them.                                  |
| **Change**  | Document the following approved utilities:                                                                                      |
|             | a. `.focus-ring` — Accessible focus ring using `--ring` token (lines 230–235)                                                   |
|             | b. `.custom-scrollbar` — Thin scrollbar using `--muted-foreground` (lines 206–227)                                              |
|             | c. Animation classes: `.animate-slide`, `.animate-soft-pulse`, `.animate-spin-border`, `.animate-shimmer`, `.animate-dot-pulse` |
|             | d. `.bg-cinematic-border` — Conic gradient border animation for ModelProgressCard                                               |
|             | e. React Flow overrides: `.react-flow__*`                                                                                       |
|             | f. Motion preference: `prefers-reduced-motion: reduce` disables all animations (lines 176–185, 328–334)                         |
| **Lines**   | ~35                                                                                                                             |

### 8. Document `ProjectionToken` branded type system

| Field       | Value                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Section** | §5.1 (tokens row) or new §5.6                                                                                            |
| **Problem** | `tokens/projection-token.ts` creates a branded type preventing forbidden tokens at the projection layer. Not documented. |
| **Change**  | Add documentation for:                                                                                                   |
|             | a. `ProjectionToken<T>` — branded string type for token identifiers                                                      |
|             | b. `SafeProjectionToken<T>` — strips forbidden tokens at type level                                                      |
|             | c. `createProjectionToken()` — runtime validation factory                                                                |
|             | d. `validateProjectionToken()` / `getAllowedTokens()` — validation utilities                                             |
|             | e. Rule: Token identifiers in the projection layer must use `ProjectionToken`, not raw strings                           |
| **Lines**   | ~15                                                                                                                      |

### 9. Document `color-scheme` and `--app-font-mono` variables

| Field       | Value                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Section** | §4.1 / §4.2                                                                                                                                                       |
| **Problem** | `globals.css` includes `color-scheme: light` / `color-scheme: dark` and `--app-font-mono` in `:root`. These affect rendering but aren't in the token definitions. |
| **Change**  | Add `color-scheme` and `--app-font-mono` to the CSS variable blocks                                                                                               |
| **Lines**   | ~4                                                                                                                                                                |

### 10. Add `@hexagen/eslint-plugin-ui` to Technology Stack

| Field       | Value                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------- |
| **Section** | §2 Technology Stack                                                                                                                                |
| **Problem** | The codebase includes `@hexagen/eslint-plugin-ui` (`packages/eslint-plugin-ui/`) — a custom ESLint plugin for UI boundary enforcement. Not listed. |
| **Change**  | Add row: `UI Linting                                                                                                                               | @hexagen/eslint-plugin-ui | Enforces projection-layer boundaries` |
| **Lines**   | 1                                                                                                                                                  |

---

## Execution Order

| Step | Item                       | Depends On |
| ---- | -------------------------- | ---------- |
| 1    | P0 items (#1, #2, #3)      | None       |
| 2    | P1 items (#4, #5, #6)      | Step 1     |
| 3    | P2 items (#7, #8, #9, #10) | Step 2     |
| 4    | Version bump header        | Steps 1–3  |

---

## Version Bump

After all changes, update the header:

```
> **Version:** 1.1.0
> | 1.1.0 | 2026-04-23 | Remediation: accurate stack, enforcement docs, inventory, utilities |
```

---

## Estimated Effort

| Priority  | Items  | Lines Changed |
| --------- | ------ | ------------- |
| P0        | 3      | ~6            |
| P1        | 3      | ~53           |
| P2        | 4      | ~55           |
| **Total** | **10** | **~114**      |
