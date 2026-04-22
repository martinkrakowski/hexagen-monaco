# ADR-0023: Token Dialect Unification

**Date:** 2026-04-22
**Status:** Accepted

## Context

A comprehensive review of the styling pipeline revealed that the application was rendering almost entirely unstyled. The root cause was a combination of three independent, pre-existing defects:

1.  **Incomplete Tailwind Scanning:** The `apps/web/tailwind.config.ts` file's `content` array did not include paths to the `features/` directory or the `packages/ui` workspace, where the vast majority of components using Tailwind classes reside.
2.  **Dead Token Dialect:** The `@hexagen/ui` package components were built using a token system (e.g., `bg-bg-tertiary`, `text-text-primary`) defined in a `tailwind.preset.ts` file. This preset was never imported by the web app's Tailwind configuration, and the CSS variables it referenced (e.g., `--color-bg-tertiary`) were defined in CSS files that were never imported into the application.
3.  **Dead Infrastructure:** The aforementioned preset and its associated CSS token files were dead code, providing no value but creating confusion for future developers.

Only the canonical token system defined in `apps/web/app/globals.css` (the "shadcn dialect") was actually being loaded by the browser.

## Decision

To resolve the style outage and simplify the design system, we will standardize on a single source of truth for design tokens.

1.  **The shadcn dialect wins:** The token system defined in `apps/web/app/globals.css` (e.g., `--background`, `--foreground`, `--primary` as HSL tuples) is declared the canonical dialect for the entire monorepo.
2.  **Unify `@hexagen/ui`:** All components within the `packages/ui` workspace will be rewritten to use the canonical shadcn dialect utility classes.
3.  **Eliminate Dead Code:** The `packages/ui/tailwind.preset.ts` file and the four unused CSS token files in `packages/ui/src/tokens/` will be deleted.
4.  **Fix Content Scanning:** The `apps/web/tailwind.config.ts` file will be updated to correctly scan all relevant source directories for utility class usage.

## Consequences

- **Pro:** A single, coherent design token system simplifies development and reduces complexity.
- **Pro:** The application styling is restored to its intended state.
- **Pro:** Dead code and confusing, non-functional infrastructure are removed from the repository.
- **Con:** A minor visual distinction between "secondary" and "tertiary" text is lost, as shadcn's dialect does not have a tertiary token. This is deemed an acceptable trade-off for consistency.
- **Con:** If `@hexagen/ui` is ever to be published as a standalone, framework-agnostic package, its dependency on the web app's `globals.css` will need to be revisited. This is documented as a future concern if and when that goal is prioritized.
