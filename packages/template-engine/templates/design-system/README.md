# Design System (`design-system`)

> A populated `DESIGN.md` contract, CSS custom-property tokens, a Tailwind config extension, and
> base component stubs.

|               |                                            |
| ------------- | ------------------------------------------ |
| **ID**        | `design-system`                            |
| **Category**  | UI / frontend                              |
| **Requires**  | —                                          |
| **Conflicts** | none                                       |
| **Branch**    | `feature/generator-template-design-system` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Establishes the visual contract: `DESIGN.md` (treated as the source of truth by agents and
reviewers), CSS-variable tokens derived from your brand colour, a Tailwind extension wired to
those tokens, and framework-agnostic component stubs to grow toward your chosen UI base.

## What it scaffolds

- `DESIGN.md`, `src/styles/{tokens.css,globals.css,theme.ts}`, `tailwind.config.ts`, `src/lib/cn.ts`.
- `src/components/ui/{button,card,input,index}.tsx` stubs.
- Optional Storybook (`.storybook/*`, `button.stories.tsx`).

## Install

`hexagen add design-system`. Questions: `primary_color` (hex, validated), `typography`
(`system-ui`/`inter`/`geist`/`custom`), `dark_mode` (`none`/`css-class`/`media-query`/`both`),
`component_base` (`shadcn-ui`/`radix-primitives`/`headlessui`/`none`), `storybook` (bool).

## Usage

```ts
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
```

```tsx
// token classes resolve from tokens.css:
<div className="bg-surface text-brand-primary">…</div>
```

## Notes for agents

- **`DESIGN.md` is the design contract** — agents/reviewers treat it as source of truth.
- `npm install clsx tailwind-merge` (+ Tailwind and your `component_base` library).
- Import `src/styles/globals.css` once at the app root; set `--color-brand-primary` in `tokens.css`
  (the hover shade derives automatically).

## Checklist (post-install)

Install peer deps; review `DESIGN.md`; import `globals.css`; set the brand token; verify token
classes resolve; set up Storybook if enabled.

## Related

Standalone (no dependencies).
