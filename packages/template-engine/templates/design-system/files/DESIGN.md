# Design System

> **This file is the design contract.** It describes *intent*, not just values.
> Before changing any component or style, read this first; when you change a
> token, update the relevant row here in the same commit. AI agents treat this
> as an immutable anchor — deviations require an explicit, justified edit.

The CSS custom properties in `src/styles/tokens.css` implement this contract and
are the single source of truth. `src/styles/theme.ts` mirrors them as
`var(--token)` references for TypeScript. Tailwind (`tailwind.config.ts`)
*extends* the default palette with these tokens — it never replaces it.

---

## Colour Tokens

| Token            | CSS Variable                  | Value     | Usage                          |
| ---------------- | ----------------------------- | --------- | ------------------------------ |
| Brand Primary    | `--color-brand-primary`       | {primary_color} | CTAs, active states, links     |
| Brand Hover      | `--color-brand-primary-hover` | derived   | Hover/pressed on brand surfaces |
| Brand Secondary  | `--color-brand-secondary`     | #8b5cf6   | Accents, secondary emphasis    |
| Background       | `--color-background`          | #ffffff   | Page background                |
| Surface          | `--color-surface`             | #f8fafc   | Cards, raised panels           |
| Border           | `--color-border`              | #e2e8f0   | Dividers, input borders        |
| Text Primary     | `--color-text-primary`        | #0f172a   | Body copy, headings            |
| Text Secondary   | `--color-text-secondary`      | #64748b   | Supporting copy                |
| Success / Warning / Error / Info | `--color-success` … | semantic  | Status only — never decorative |

Brand Hover is derived from Brand Primary via `color-mix`, so it tracks the
primary automatically. Adjust Brand Secondary and the neutrals to taste.

## Typography

Base font family: **{typography}**. Load the actual font (e.g. `next/font`) and
keep the `--font-sans` stack in `tokens.css` as the fallback chain. Use Tailwind
`font-sans` / `font-mono`; do not hardcode `font-family` in components.

## Spacing & Radius

Spacing follows a 4px base unit — use Tailwind spacing classes (`p-4` = 16px).
Radius tokens: `--radius-sm` (4px), `--radius-md` (8px, the default for
buttons/inputs), `--radius-lg` (12px, cards), `--radius-full` (pills/avatars).

## Dark Mode

Strategy selected: **{dark_mode}**. Shipped implementation is the **class**
strategy — toggling a `dark` class on `<html>` activates the `.dark` overrides in
`tokens.css`, and `tailwind.config.ts` sets `darkMode: "class"`. If you selected
`media-query` (or `both`), change `darkMode` to `"media"` and move the `.dark`
overrides under `@media (prefers-color-scheme: dark)`. If you selected `none`,
delete the `.dark` block.

## Component Base

Components are built on: **{component_base}**. The generated stubs in
`src/components/ui/` are framework-agnostic React (props + `cn()` + a11y) so they
work regardless; install the matching library if you chose one (e.g. shadcn-ui /
Radix primitives / Headless UI) and grow the stubs toward its patterns.

---

## Component Constraints

- **Buttons:** `border-radius = --radius-md`. Never square. Disabled and loading
  states reduce opacity and block pointer events; loading sets `aria-busy`.
- **Cards:** `shadow = --shadow-sm`. Elevation conveys hierarchy, not decoration.
- **Inputs:** `1px solid --color-border`; focus ring is `--color-brand-primary`.
  Error state sets `aria-invalid` *and* the red border together — never one alone.

## Prohibited Patterns

- Do not use arbitrary Tailwind values (e.g. `w-[237px]`) without a design reason.
- Do not hardcode hex values in components — reference tokens via Tailwind or
  `var(--token)`.
- Do not branch light/dark logic inside component files — rely on tokens that
  adapt.
