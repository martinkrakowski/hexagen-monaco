# env-setup — Optional Follow-Ups

> **Status:** Planned. `env-setup` shipped in PR #120 (merge `254abb0c`). These are
> deferred enhancements surfaced during review, not gaps in the merged template.
> Decisions below are settled: ship **A2** and **B2**, **skip C**.

The base `env-setup` template (`.env.example`, Zod `env.server.ts`/`env.client.ts`,
type-only `env.ts` barrel, `check-env.ts`, `SETUP.md`) is complete and merged. Two
review findings were intentionally deferred rather than bundled into that PR:

1. No `.gitignore` is emitted (finding #4).
2. The planning spec's `dotenv_tool` (and `cloud_or_local`) questions were dropped
   as inert (finding #3).

This doc plans how to land them given the template engine's constraints.

## Engine constraints that shape these

- **Single-pass scalar interpolation** (`{var}` → `String(answer)`); no loops, no
  conditionals inside a file.
- **Whole-file emission**; there is no append/patch step. Existing files are never
  clobbered — a user-modified target gets a `.hexagen-update.<ext>` conflict copy.
- **Output gating** supports only `when: { answer, equals | includes }` (a single
  value; no negation). Multiple output entries may point at the **same source
  path** with different gates — exactly one fires for a `select` answer.

---

## A2 — Emit a git-ignore sidecar ✅ (implemented in this PR)

**Goal:** Guarantee `.env.local` and secrets are git-ignored from day one without
relying solely on a checklist item.

**Why not own `.gitignore` directly:** most scaffolds already ship one, so a
`.gitignore` output would hit the conflict path on nearly every real install
(`.gitignore.hexagen-update` copy) — safe but noisy. A complete generated
`.gitignore` is also wrong as a _replacement_ if it cleanly lands on a project
that had none.

**Approach (sidecar + append):**

- New always-on output `.gitignore.hexagen` containing only the env/secret block:
  ```
  # --- env-setup: secrets (append to your .gitignore) ---
  .env
  .env.*
  !.env.example
  !.env.*.example
  ```
- Checklist gains: ``Append the secret-ignore rules: `cat .gitignore.hexagen >> .gitignore` (then delete the sidecar)``.
- `SETUP.md` references the same step.

**Touches:** `manifest.json` (1 output + 1 checklist item), `files/.gitignore.hexagen`,
`SETUP.md`, one emit-shape assertion. **No question change → no generator regen.**

**Risk:** none (additive, conflict-free). **Est:** ~30 min.

---

## B2 — Wire `dotenv_tool` to a gated loader ✅ (implemented)

> Shipped: `dotenv_tool` question + gated `src/config/load-env.ts` (emitted only
> for `dotenv`/`dotenv-expand`). Implemented with an **indirected** dynamic import
> (`const moduleName: string = "dotenv-expand"; import(moduleName)`) rather than a
> static import + `@ts-expect-error`/`@ts-ignore`: the indirection means TS never
> resolves the optional dep, so it neither breaks `typecheck` when missing nor
> leaves an "unused directive" once installed — and it stays lint-clean
> (`ban-ts-comment`). The `useDotenvExpand` constant avoids `no-constant-condition`.

**Goal:** Make the `dotenv_tool` select (`next.js-built-in` | `dotenv` |
`dotenv-expand`) drive real output instead of being inert.

**Approach (gated loader file):**

- Add the `dotenv_tool` question (default `next.js-built-in`). The engine has no
  conditional question rendering, so the prompt is shown even for frameworks with
  a native loader (Next.js, Nitro). Make the prompt/options self-documenting, e.g.
  prompt: "Env loader? (use next.js-built-in for Next.js/Nitro — they parse .env
  natively; pick dotenv/dotenv-expand only for plain Node entrypoints)".
- Add `src/config/load-env.ts` as a **gated** output, registered twice at the same
  path:
  - `when: { answer: "dotenv_tool", equals: "dotenv" }`
  - `when: { answer: "dotenv_tool", equals: "dotenv-expand" }`
    Exactly one fires; `next.js-built-in` emits nothing (Next loads `.env` itself).
- One source file, gated to dotenv/dotenv-expand. **Use a guarded dynamic import
  for `dotenv-expand`, never a static one** — a static `import { expand } from
"dotenv-expand"` would fail `tsc`/`yarn typecheck` (`Cannot find module
'dotenv-expand'`) for users who chose plain `dotenv` and never installed it.
  Pattern:

  ```ts
  import { config } from "dotenv";
  const result = config();
  if ("{dotenv_tool}" === "dotenv-expand") {
    // @ts-expect-error optional dep, installed only when selected in the wizard
    import("dotenv-expand")
      .then(({ expand }) => expand(result))
      .catch(() => {});
  }
  ```

  The `"{dotenv_tool}" === "..."` string-encoding mirrors the `strict_validation`
  trick (valid TS pre-interpolation, lint-safe). Confirm `@ts-expect-error` vs
  `@ts-ignore` against the repo's tsconfig at build time (`@ts-expect-error`
  errors if the suppression becomes unnecessary, which is preferable).

- `SETUP.md` + checklist note which package to `npm install` for the chosen tool.

**Touches:** `manifest.json` (1 question + 2 gated outputs), `files/src/config/load-env.ts`,
`SETUP.md`/checklist, gated-emit test (present for dotenv/dotenv-expand, absent for
built-in). **Question added → regenerate `template-questions.generated.ts`.**

**Risk:** low; main care is (a) the guarded dynamic import so an unselected
optional dep never breaks `yarn typecheck`, (b) the brace/`${}` discipline in the
loader file, and (c) the two-entry-same-path gate. **Est:** ~1–1.5 hr.

---

## C — `cloud_or_local` (skipped)

`local` | `cloud-dev` | `both` has no clean file effect under the engine; at best a
`SETUP.md` paragraph. Adding it standalone reintroduces the "collected-but-unused
answer" smell the reviews flagged. **Decision: skip.** If desired later, fold a
one-line `{cloud_or_local}` note into `SETUP.md` alongside B2 — not on its own.

---

## Sequencing

1. **A2** — independent, no regen, highest safety value. One PR.
2. **B2** — second; regenerate the questions file. One PR.

Both branch off `main`, carry an emit-shape test, and leave `JOB-INDEX.md`
unchanged (`env-setup` already marked landed). Each follows the established
review loop (qodo + CodeRabbit + CI green before merge).
