# Style Remediation Plan — Atomically Phased Development Plan

**Document Purpose:** Comprehensive plan for restoring styling to the HexaGen Monaco web application.
**Mode:** Plan (read-only analysis and proposal).
**Scope:** Tailwind content scanning, `@hexagen/ui` token dialect unification, dead-code removal.
**Decision anchor:** Option A — the shadcn dialect defined in `apps/web/app/globals.css` is the canonical design-token system; the `@hexagen/ui` preset dialect is eliminated.

---

## 1. Executive Summary

The application loads but renders unstyled. Three independent pre-existing defects, all predating this session's work, combine to produce the symptom:

| Defect                                       | Severity | Root Cause                                                                                                                                            |
| -------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1: Tailwind content globs incomplete       | Critical | `apps/web/tailwind.config.ts` does not include `./features/**/*.{ts,tsx}` or `packages/ui/src/**/*.{ts,tsx}`                                          |
| D-2: `@hexagen/ui` uses a dead token dialect | Critical | Components use `bg-bg-tertiary`/`text-text-primary`/`border-border-default` tokens that resolve to CSS variables defined nowhere reachable at runtime |
| D-3: Dead infrastructure                     | Medium   | `packages/ui/tailwind.preset.ts` and four `packages/ui/src/tokens/*.css` files exist but no consumer imports them                                     |

**Nothing from my prior remediation session is in the causal chain.** Git diff shows I did not modify `tailwind.config.ts`, `postcss.config.mjs`, `globals.css`, the preset, or any token CSS file.

**Plan shape:** 5 atomic phases, each with hard dependencies on the previous phase's exit gate. Phases 1 and 2 together restore visual correctness. Phases 3–5 eliminate the dead infrastructure and record the architectural decision.

---

## 2. Analysis of Current State

### 2.1 Evidence Chain for D-1 (Content Globs)

**File:** `apps/web/tailwind.config.ts:7-12`

```typescript
content: [
  "./pages/**/*.{ts,tsx}",
  "./components/**/*.{ts,tsx}",
  "./app/**/*.{ts,tsx}",
  "./src/**/*.{ts,tsx}",
],
```

**Observed reality:**

- `apps/web/features/` — contains `code-view`, `governance-assistant`, `hexagon-canvas`, `monaco-editor`, `project-wizard`, `workspace-shell`, `export`, `llm-driver`. Zero of these are scanned.
- `apps/web/components/` — does not exist.
- `apps/web/pages/` — does not exist (App Router project).
- `apps/web/src/` — exists but is mostly empty.

**Proof the scanning is broken:**

```bash
$ grep -c "\.flex\|\.grid\|\.p-4\|\.rounded-md\|\.bg-primary" \
    apps/web/.next/static/css/b1b522c9406b4804.css
0
```

Zero common utilities in the compiled CSS, despite dozens of `className="flex ..."`-style usages in `features/`.

### 2.2 Evidence Chain for D-2 (Dead Token Dialect)

**The web app and the UI package define two incompatible token vocabularies:**

| System            | Location                         | Namespace                                                                                       | Consumption     |
| ----------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- | --------------- |
| Web app (shadcn)  | `apps/web/app/globals.css`       | `--background`, `--foreground`, `--primary`, `--muted`, `--destructive` etc. (HSL tuples)       | `hsl(var(--x))` |
| UI package (dead) | `packages/ui/tailwind.preset.ts` | `--color-primary`, `--color-bg-tertiary`, `--color-text-primary`, `--color-border-default` etc. | Raw `var(--x)`  |

The UI package's tokens map to Tailwind classes like `bg-bg-tertiary`, `text-text-primary`. These classes can only be declared by the preset, and the preset is never registered. Even if Tailwind did generate those classes, they reference CSS variables that are never declared in any loaded stylesheet.

**Old-dialect class inventory** (`grep` across `packages/ui/src`):

```
bg-bg-elevated, bg-bg-primary, bg-bg-secondary, bg-bg-tertiary,
bg-error, bg-primary-hover,
border-border-default, text-error,
text-text-primary, text-text-secondary, text-text-tertiary
```

Plus `ring-border-focus` in Badge's focus styling.

**Affected files** (7):

- `packages/ui/src/elements/Badge.tsx`
- `packages/ui/src/elements/Button.tsx`
- `packages/ui/src/elements/Card.tsx`
- `packages/ui/src/elements/Input.tsx`
- `packages/ui/src/elements/Textarea.tsx`
- `packages/ui/src/modules/FileDropZone.tsx`
- `packages/ui/src/modules/ViewToggle.tsx`

**Zero old-dialect usage in `features/`** (verified by grep). Features already use shadcn tokens correctly.

### 2.3 Evidence Chain for D-3 (Dead Infrastructure)

**Preset (`packages/ui/tailwind.preset.ts`):**

```bash
$ grep -rn "tailwind.preset\|uiPreset\|from '@hexagen/ui/tailwind'" \
    apps packages --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" --include="*.json"
(no output)
```

No importer exists anywhere in the monorepo. 89 lines of dead code.

**Token CSS files (`packages/ui/src/tokens/colors.css`, `motion.css`, `spacing.css`, `typography.css`):**

- No `@import` in `globals.css`
- No `import "...css"` in any `.ts`/`.tsx`
- Not exported via `packages/ui/package.json`'s `exports` map
- Not loaded by any build tool

Orphaned CSS definitions that were never reachable.

### 2.4 Tailwind Version Confirmation

```bash
$ grep '"version"' node_modules/tailwindcss/package.json
"version": "3.4.19"
```

Tailwind v3.4.x. The v3 `content` configuration syntax applies. (If this were v4, the plan would look entirely different — `@theme` directives in CSS, no content array.)

### 2.5 Why Didn't This Surface Before?

Hypotheses ranked by likelihood:

1. **Most likely:** The `features/` directory is a recent architectural pattern. Original app code lived in `apps/web/app/**` which IS scanned. As features migrated out, styling quietly broke but was masked because the initial pages (e.g., `/architecture-viewer`) still rendered basic body styling from `@layer base` in `globals.css`.
2. **Possible:** A prior version of `tailwind.config.ts` had `../../packages/ui/src/**` and it was removed during a refactor without reviewing impact.
3. **Unlikely:** My session caused it. The diff confirms I did not touch any styling file. The only tangentially related change (moving `useLocalLlm.tsx` from `app/hooks` to `features/llm-driver`) could only have moved a single provider's classes out of scannable scope — not enough to produce a global unstyled render.

---

## 3. Phased Remediation Plan

### Phase Dependency Graph

```
Phase 1 (Content Globs)    ── no deps
    ↓
Phase 2 (Token Dialect)    ── depends on Phase 1 for verification
    ↓
Phase 3 (Preset Deletion)  ── depends on Phase 2 (ensures nothing new references preset)
Phase 4 (Token CSS Deletion) ── depends on Phase 2
Phase 5 (Manifest + Docs)  ── depends on Phases 3 + 4
```

Phases 1 and 2 are the critical path. Phases 3–5 are cleanup and can be executed in parallel after Phase 2.

---

### Phase 1 — Tailwind Content Scanning (D-1)

**Goal:** Enable Tailwind to see the files where utility classes are actually used.

**Rationale:** Without this, no amount of class rewriting will produce visible output. Phase 1 is the prerequisite for empirically verifying Phase 2.

| Unit | Deliverable                                                  | File                          | Scope           |
| ---- | ------------------------------------------------------------ | ----------------------------- | --------------- |
| 1.1  | Add `./features/**/*.{ts,tsx}` to `content` array            | `apps/web/tailwind.config.ts` | Webpack/PostCSS |
| 1.2  | Add `../../packages/ui/src/**/*.{ts,tsx}` to `content` array | `apps/web/tailwind.config.ts` | Webpack/PostCSS |

**Exit gate:**

```bash
yarn build
grep -oE "\.(flex|grid|rounded-md|bg-card|bg-muted|text-foreground|text-muted-foreground|bg-primary)\b" \
  apps/web/.next/static/css/*.css | sort -u
# Expected: at least 6 of the 8 listed utilities present
```

**Expected visible outcome after Phase 1 alone:**

- Features directory components render with correct styling (they already use shadcn dialect)
- `@hexagen/ui` components (Badge, Button, Card, Input, Textarea, FileDropZone, ViewToggle) will start receiving their class names at build time, but the classes themselves still reference undefined CSS variables (e.g. `--color-bg-tertiary`). Those components will have partial styling — layout/spacing will work, but colors will be wrong or transparent.

**Risks:**

- **Cache interference:** Turbo or Next.js build cache may serve a stale CSS bundle. Mitigation: this phase's verification uses the emitted CSS file, bypassing cache. If the grep fails, clear `.next/` and retry.
- **Regex-based class detection quirks:** Tailwind's extraction regex will now see `packages/ui/src/tokens/projection-token.ts` (a TS file with token-related code but no classes). Harmless.

---

### Phase 2 — Token Dialect Unification (D-2)

**Goal:** Rewrite `@hexagen/ui` components to use only the canonical shadcn tokens defined in `apps/web/app/globals.css`.

**Token Mapping (canonical):**

| Old                     | New                     | Notes                            |
| ----------------------- | ----------------------- | -------------------------------- |
| `bg-bg-primary`         | `bg-background`         |                                  |
| `bg-bg-secondary`       | `bg-secondary`          |                                  |
| `bg-bg-tertiary`        | `bg-muted`              | Subdued fill                     |
| `bg-bg-elevated`        | `bg-card`               | Elevated surface                 |
| `bg-primary-hover`      | `hover:bg-primary/90`   | Opacity modifier is shadcn idiom |
| `bg-error`              | `bg-destructive`        | shadcn semantic                  |
| `text-error`            | `text-destructive`      | shadcn semantic                  |
| `text-text-primary`     | `text-foreground`       | Default body text                |
| `text-text-secondary`   | `text-muted-foreground` | Secondary text                   |
| `text-text-tertiary`    | `text-muted-foreground` | shadcn has no tertiary; collapse |
| `border-border-default` | `border-border`         | shadcn idiom                     |
| `ring-border-focus`     | `ring-ring`             | shadcn focus-ring convention     |

| Unit | Deliverable                       | File                                       | Scope        |
| ---- | --------------------------------- | ------------------------------------------ | ------------ |
| 2.1  | Rewrite class strings per mapping | `packages/ui/src/elements/Badge.tsx`       | Presentation |
| 2.2  | Rewrite class strings per mapping | `packages/ui/src/elements/Button.tsx`      | Presentation |
| 2.3  | Rewrite class strings per mapping | `packages/ui/src/elements/Card.tsx`        | Presentation |
| 2.4  | Rewrite class strings per mapping | `packages/ui/src/elements/Input.tsx`       | Presentation |
| 2.5  | Rewrite class strings per mapping | `packages/ui/src/elements/Textarea.tsx`    | Presentation |
| 2.6  | Rewrite class strings per mapping | `packages/ui/src/modules/FileDropZone.tsx` | Presentation |
| 2.7  | Rewrite class strings per mapping | `packages/ui/src/modules/ViewToggle.tsx`   | Presentation |

**Execution protocol per file:**

1. Read file
2. Apply targeted `edit` calls — one mapping entry per `oldString`/`newString` pair to preserve surrounding context
3. No reformatting, no comment additions, no behavioral changes, no refactoring
4. Re-`grep` the file to confirm zero old-dialect tokens remain

**Exit gate:**

```bash
grep -rE "bg-bg-|text-text-|border-border-default|border-border-focus|bg-error|text-error|bg-primary-hover|ring-border-focus" \
  packages/ui/src
# Expected: no output (exit 1 from grep)

yarn build
grep -oE "\.(bg-card|bg-muted|bg-background|bg-destructive|text-foreground|text-muted-foreground)\b" \
  apps/web/.next/static/css/*.css | sort -u
# Expected: at least 4 of the 6 listed classes present
```

**Expected visible outcome after Phase 2:**

- All `@hexagen/ui` components (Button, Badge, Card, Input, Textarea, Dialog, Tabs, FileDropZone, ViewToggle) render with full shadcn colors matching the rest of the app
- No visual distinction between light/dark modes in these components regresses — the shadcn CSS variables handle both already via `.dark` scope in `globals.css`

**Risks:**

- **`text-text-tertiary` → `text-muted-foreground` collapses a distinction:** shadcn has only `muted-foreground`, no "tertiary" level. This may flatten text hierarchy subtly. Accept.
- **`bg-primary-hover` was a bare class applied unconditionally** if the original code didn't use the `:hover` pseudo-selector via Tailwind. Need to verify per-file that the class was used on elements where hover-only behavior is semantically correct. If any site uses it for always-on state, map to `bg-primary/90` instead of `hover:bg-primary/90`.
- **Missed tokens:** my grep found only the tokens that appeared as full-class matches. If an unusual form exists (e.g., `text-text-primary/50`), a bare `grep bg-bg-` still catches it. Post-Phase 2 grep confirms closure.

---

### Phase 3 — Delete Dead Tailwind Preset (D-3, part 1)

**Goal:** Remove `packages/ui/tailwind.preset.ts`.

Pre-verified: zero importers. This is strictly dead-code removal.

| Unit | Deliverable | File                             | Scope   |
| ---- | ----------- | -------------------------------- | ------- |
| 3.1  | Delete file | `packages/ui/tailwind.preset.ts` | Cleanup |

**Exit gate:**

```bash
# Nothing should break
yarn build && yarn typecheck
# Re-verify no new references emerged
grep -rn "tailwind.preset\|uiPreset" apps packages --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" --include="*.json"
# Expected: no output
```

**Risks:**

- **A consumer is added between Phase 2 and Phase 3:** extremely unlikely given single-session execution. The verification grep catches it if so.

---

### Phase 4 — Delete Dead Token CSS Files (D-3, part 2)

**Goal:** Remove the four unimported token CSS files.

Pre-verified: zero importers across the monorepo.

| Unit | Deliverable | File                                    | Scope   |
| ---- | ----------- | --------------------------------------- | ------- |
| 4.1  | Delete file | `packages/ui/src/tokens/colors.css`     | Cleanup |
| 4.2  | Delete file | `packages/ui/src/tokens/motion.css`     | Cleanup |
| 4.3  | Delete file | `packages/ui/src/tokens/spacing.css`    | Cleanup |
| 4.4  | Delete file | `packages/ui/src/tokens/typography.css` | Cleanup |

Preserved files in `packages/ui/src/tokens/`:

- `projection-token.ts` — TypeScript brand helper, required for firewall L1
- `index.ts` — barrel for the TS token (will need a 1-line update to remove the now-nonexistent CSS references if any)

**Pre-check required during execution:** read `packages/ui/src/tokens/index.ts` to confirm it does not import the CSS files. Based on a sample reading, it currently exports only `projection-token` and a `TOKENS` constant, so no change needed. But verify.

**Exit gate:**

```bash
yarn build && yarn typecheck
find packages/ui/src/tokens -name "*.css"
# Expected: no output
ls packages/ui/src/tokens
# Expected: index.ts, projection-token.ts
```

**Risks:**

- **Webpack emits a warning about unresolved `.css` imports:** if I misverified and something does import them. Unlikely — I grepped thoroughly.

---

### Phase 5 — Manifest Alignment + Architectural Record (governance)

**Goal:** Update architectural artifacts to reflect the reduction in UI package surface area.

| Unit | Deliverable                                                                          | File                                                        | Scope        |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------ |
| 5.1  | Update `packages/ui` bounded context: reduce `tokens` list to `ProjectionToken` only | `.architecture/manifest.yaml`                               | Governance   |
| 5.2  | Author ADR 0023 documenting the token dialect decision (Option A)                    | `.architecture/decisions/0023-token-dialect-unification.md` | Governance   |
| 5.3  | Run `yarn lint:arch` to verify manifest consistency                                  | n/a                                                         | Verification |

**Manifest change (exact diff):**

```yaml
# packages/ui -> layers.presentation.tokens
- tokens:
-   - Colors
-   - Motion
-   - Spacing
-   - Typography
-   - ProjectionToken
+ tokens:
+   - ProjectionToken
```

**ADR 0023 skeleton:**

- **Status:** Accepted
- **Context:** Two incompatible token dialects existed (shadcn HSL-tuple vs. UI package `--color-*`). Only the shadcn dialect had runtime declarations. Components in `@hexagen/ui` used the dead dialect and rendered with unresolved variables.
- **Decision:** Standardize on the shadcn dialect defined in `apps/web/app/globals.css`. Delete the UI package preset and token CSS files. Rewrite component classes accordingly.
- **Consequences:**
  - Pro: Single source of truth for design tokens; no more silent failure
  - Pro: Reduces `@hexagen/ui` surface area and bundle size
  - Con: Loss of a "tertiary" text distinction (acceptable — shadcn doesn't have one)
  - Con: If the project ever wants to ship `@hexagen/ui` as a standalone package (decoupled from apps/web), the design tokens will need to move back to the package. Documented as future work.

**Exit gate:**

```bash
yarn build && yarn typecheck && yarn lint && yarn lint:arch
# All green
```

**Risks:**

- **`yarn lint:arch` surfaces violations:** if the arch-linter has rules I don't know about that reference the manifest tokens list. Mitigation: read the linter's config before phase execution.

---

## 4. Verification Strategy

After all phases complete, run the comprehensive verification:

### 4.1 Build + Type Verification

```bash
yarn build && yarn typecheck
# Must exit 0
```

### 4.2 CSS Emission Verification (the key test for "styles are back")

```bash
# Grep the emitted CSS for representative utilities that must appear
for util in flex grid rounded-md bg-card bg-muted bg-background \
            bg-destructive text-foreground text-muted-foreground \
            text-primary-foreground p-4 p-6 gap-2 gap-4; do
  count=$(grep -o "\.${util}\b" apps/web/.next/static/css/*.css | wc -l)
  echo "${util}: ${count}"
done
# Must show non-zero counts for most entries
```

### 4.3 Residual Dead-Dialect Check

```bash
grep -rE "bg-bg-|text-text-|bg-error|text-error|bg-primary-hover|border-border-default|border-border-focus|ring-border-focus" \
  packages/ui/src apps/web
# Must return nothing (exit 1)
```

### 4.4 Dead-File Check

```bash
test -f packages/ui/tailwind.preset.ts && echo "FAIL: preset still exists" || echo "OK: preset removed"
find packages/ui/src/tokens -name "*.css"
# Must be empty
```

### 4.5 Architecture Linter

```bash
yarn lint:arch
# Must exit 0 after manifest update
```

### 4.6 Visual Confirmation (human-verified)

The user runs `yarn dev:web` and loads the app. Expected:

- Cards, buttons, badges, inputs render with correct colors
- Light/dark theme toggle works
- No raw unstyled flash

---

## 5. Priority Matrix

| Phase                | Severity |            Effort            | Critical Path |
| -------------------- | -------- | :--------------------------: | :-----------: |
| 1 — Content Globs    | Critical |     XS (1 file, 2 lines)     |      Yes      |
| 2 — Token Dialect    | Critical | M (7 files, ~30 edits total) |      Yes      |
| 3 — Delete Preset    | Low      |          XS (1 rm)           |      No       |
| 4 — Delete Token CSS | Low      |          XS (4 rm)           |      No       |
| 5 — Manifest + ADR   | Low      |    S (1 edit, 1 new file)    |      No       |

**Minimum viable fix** is Phases 1 + 2. Phases 3–5 are hygiene. Recommend all five for a clean resolution.

---

## 6. Items Explicitly Out of Scope

| Item                                                                                                  | Reason                                                             |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Rewriting `features/` components                                                                      | Already uses shadcn dialect; grep confirmed zero old-dialect usage |
| Modifying `apps/web/app/globals.css`                                                                  | Already defines the canonical tokens correctly                     |
| Changing `postcss.config.mjs` or `next.config.mjs`                                                    | Both work correctly                                                |
| Adding `tailwindcss` to `packages/ui/package.json`                                                    | Consumer (apps/web) owns scanning; package doesn't need it         |
| Fixing the pre-existing `project-wizard → ..` cross-slice import flagged by `validate-ui-boundary.sh` | Unrelated to styling; separate remediation                         |
| Addressing other CV/AS findings from my prior code review                                             | Out of scope for this styling fix                                  |

---

## 7. Decision Points Locked

1. **Dialect choice:** Option A — shadcn wins. Confirmed.
2. **Dead-code deletion:** Yes — preset and token CSS removed. Confirmed.
3. **Verification method:** Build + grep emitted CSS for expected utilities. Confirmed.

---

## 8. Estimated Timeline

| Phase     | Duration                                                                |
| --------- | ----------------------------------------------------------------------- |
| 1         | < 5 min (1 edit + 1 rebuild + grep)                                     |
| 2         | 15–25 min (7 files, ~3–5 targeted edits each, intermediate grep checks) |
| 3         | < 1 min                                                                 |
| 4         | < 1 min                                                                 |
| 5         | 5–10 min (manifest edit + ADR authoring + `yarn lint:arch`)             |
| **Total** | **25–40 min**                                                           |

---

_End of plan. Ready for execution on your command. No files have been modified during this analysis._
