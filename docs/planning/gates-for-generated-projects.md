# Gates for Generated Projects — Implementation Plan

**Date:** 2026-09-17
**Author:** orchestrator (from campaign-foundry, the second downstream feed after the findings store)
**Status:** draft — for the owner's review. Nothing built.
**Verified against:** `main` at `5fc27a50`, and campaign-foundry `main` after its 2026-09-16 wave (19 merges)
**Scope:** what a generated project gets _to defend itself with_ — the gate, the formatter, the
coverage floor, the reviewers, and the layer rules over `apps/`. Not the generator's own CI.

---

## 0. What this plan answers

campaign-foundry shipped 19 PRs on 2026-09-16 under a rule that every lane pushes and lets CI be the
gate. That produced an unusually clean record of **which check caught which defect**, and the answer
is uncomfortable for a generator: almost nothing that caught a defect is something hexagen emits.

| Defect                                                                                 | What caught it                                   | Does hexagen emit that?                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `window is not defined` — a `"use client"` `useState` seed running in Next's prerender | the production **build**                         | partly (`ci-github-actions` runs `build`)        |
| Linux golden cells differing from the runner's in **all 16**                           | a **byte-identity golden suite**                 | no                                               |
| An untested arm of a conditional spread                                                | **100 % branch coverage**                        | **no** — no thresholds anywhere                  |
| A premise that had silently closed                                                     | **`plan:verify`** (premise fences)               | no                                               |
| A raw domain value reaching a label                                                    | a **jargon test** over the message catalogue     | no                                               |
| A per-keystroke render commit added by a memo                                          | a **commit-budget test**                         | no                                               |
| A reformat that could have hidden a real change                                        | **`format:check`** + a 400-file mechanical split | **no** — a `format` script is emitted, no config |
| A memo upstream of a guard, making the guard unreachable                               | **Qodo**, then **CodeRabbit** independently      | no reviewer config is emitted                    |
| Layer violations in `apps/`                                                            | **nothing**                                      | **no — and this is a known open finding**        |

The last row is the one that should decide the priority order.
`tools/arch-linter/findings/0001-layer-rules-skip-apps.md` already records it, `class: coverage-gap`,
`severity: medium`, `status: open`:

> "The linter skips a module whose root does not exist, so those contexts get no layer evaluation at
> all: whatever the manifest claims about their files (ownership, ports, adapters) is backed by
> nothing the linter actually runs."

Every defect campaign-foundry found on 2026-09-16 lived in `apps/`. The severity on that finding is
`medium` because it was written from the generator's side. From the downstream side it is **critical**,
and §1 restates it as such.

### 0.1 Proposed decisions

| id       | Decision                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G-D0** | **Gates ship as add-ons, not as core generation.**                                     | Core emits the conformance gate because architectural integrity is hexagen's own claim. A coverage floor is a _project's_ policy. `packages/template-engine/templates/` is the existing, reversible, question-driven mechanism, and 49 templates already prove the shape.                                                                                                                            |
| **G-D1** | **Two add-ons, not one: `quality-gate` and `pr-reviewers`.**                           | They have different costs. `quality-gate` is free and deterministic. `pr-reviewers` needs API keys and spends money per PR, and campaign-foundry's measured yield for one reviewer family was **≈1 real finding in 10**. Bundling them would force a paid choice on a free one.                                                                                                                      |
| **G-D2** | **The coverage floor is a _question_, defaulting to `80`, with `100` offered.**        | campaign-foundry runs 100 % on four counters and it caught a real defect this session. But 100 % on a greenfield scaffold with generated stubs is a trap: it makes the first honest test-free commit red. Ask, default low, document what 100 buys.                                                                                                                                                  |
| **G-D3** | **Fix the `apps/` scope gap in the linter itself, not in an add-on.**                  | A generated `.architecture/layout.yaml` that maps `apps/`-rooted contexts is core output, and the existing finding already names that fix. An add-on cannot repair a linter that silently skips.                                                                                                                                                                                                     |
| **G-D4** | **Emit a Prettier config whenever a `format` script is emitted.**                      | `root-file-templates.ts:28` emits `format: prettier --write "**/*.{ts,tsx,md}"` and **no config**. That is precisely campaign-foundry's pre-X1 state: every invocation reformatted to Prettier's 80-column default, three PRs had real changes buried under churn, and every brief carried a "do not run Prettier" rule as a workaround. A script without a config is a loaded gun in the toolchain. |
| **G-D5** | **The `.md` glob comes out of the emitted `format` script.**                           | campaign-foundry's `format` glob included `md`; running it would have rewrapped 97 hand-wrapped planning documents. Emit `"**/*.{ts,tsx}"` and let a project opt prose back in deliberately.                                                                                                                                                                                                         |
| **G-D6** | **Every gate the add-on emits must be shown to fail before it is considered shipped.** | hexagen's own rule, `2026-08-23-enforcement-remediation-plan.md:35`: _"a gate that has not been shown to fail has not been shown to exist."_ The DoD in §4 names the fault that must turn each one red.                                                                                                                                                                                              |
| **G-D7** | **No mutation automation is proposed.**                                                | It is doctrine in this repo (`findings-store.md:238`) with no enforcing gate, and campaign-foundry's manifests are hand-authored per lane. Generating a mutation harness nobody feeds produces a green check that means nothing — the exact failure `abortIfVacuous` exists to prevent.                                                                                                              |

---

## 1. Findings about the ground this is built on

#### **F1 · C · The arch-linter silently skips every `apps/`-rooted context, and the skip is invisible.**

`tools/arch-linter/src/cli.ts:281-288` derives `PKG_ROOT_PATH` from the first workspace glob that is
**not** `apps/*`:

```ts
(w: string) => w.includes("/*") && !w.includes("apps/");
```

`contextRootAbs(name)` (`:585-589`) then falls back to `packages/<name>` for any context not mapped in
`.architecture/layout.yaml`, and a module whose root does not exist is **skipped without a diagnostic**
(`:678-683`). The only global guard is `abortIfVacuous` (`:1313`), which fires only when _nothing at all_
was scanned — so a run that scans `packages/` and silently ignores four `apps/` contexts is reported
as a pass.

hexagen-monaco itself has **no `.architecture/layout.yaml`**, so its own `apps/` are unscanned; it
compensates with a bespoke shell gate, `scripts/validate-ui-boundary.sh`, whose scope is declared by
hand at `:9,:18-27`. A generated project inherits the gap and not the compensation.

**Downstream consequence, measured:** in campaign-foundry, `lint:arch` was green through every defect
of 2026-09-16 — a memo that made a guard unreachable, a prerender crash, a raw domain value in a
label, a per-keystroke commit regression. All in `apps/`. A green arch check there is green _by
construction_, not by inspection, and a reader cannot tell the difference.

#### **F2 · C · Generated projects get an integrity gate, not a quality gate — and the two are easy to confuse.**

Core generation auto-injects `.github/workflows/sync-integrity.yml` plus the
`hexagen-conformance` action (`packages/project-generation/src/application/generate-project-use-case.ts:177-185`,
bytes in `domain/conformance-gate-files.ts:41-47`), gated on the package manager
(`domain/sync-integrity-workflow.ts:38-43`). That gate runs `hexagen-lint --ratchet` and `sync --check`.
It is a good gate and it is **not** a quality gate: it asserts the project still matches its own
architecture, and says nothing about whether the code works.

The `ci-github-actions` add-on adds build / typecheck / lint / test with Turbo caching
(`templates/ci-github-actions/files/.github/workflows/ci.yml:93-109`). Between them there is still
**no** coverage floor, **no** format check, and no project-level invariant of any kind.

#### **F3 · H · A `format` script is emitted with no Prettier config, which is worse than emitting neither.**

`packages/sync/src/generators/root-file-templates.ts:28` emits
`"format": "prettier --write \"**/*.{ts,tsx,md}\""`, and `:30-37` adds `prettier` to devDependencies.
A grep for `prettierrc` across `packages/sync/src`, `packages/template-engine/templates` and
`packages/project-generation/src` returns **nothing**.

So the first person to run `yarn format` reformats the entire repository to Prettier's 80-column
default, against code the generator emitted at whatever width it emitted. campaign-foundry lived in
exactly that state: **400 of 679 files** were unformatted at width 100 and **613** at the 80 default,
three PRs had real changes buried under hundreds of reformatted lines, and every lane brief carried a
"do not run Prettier" rule — a standing workaround for a missing config file.

#### **F4 · H · No coverage threshold is emitted, and the emitted test script passes on an empty suite.**

`packages/sync/src/generators/package-json.ts:83` emits `test: "vitest run --passWithNoTests"`, and the
write-once per-package `vitest.config.ts` (`:194-206`) contains only `environment` and `exclude` — no
`coverage` block. A generated project's `test` step is therefore green before a single test exists,
and stays green if every test is deleted.

This is not hypothetical: campaign-foundry's 100 % branch threshold is what caught an untested arm of a
conditional spread on 2026-09-16 — a field the code _did_ handle but nothing proved it reached.

**hexagen-monaco has the same gap in its own suite:** `vitest.shared.ts` sets environment, timeouts,
includes and reporters, and has **no `coverage` block at all**. The only CI "coverage" reference is
`scripts/check-lint-coverage.mjs`, which is lint coverage, not test coverage.

#### **F5 · M · Three reviewer configs exist in this repo and none of them ship.**

`.coderabbit.yaml`, `.pr_agent.toml` and `.greptile/` are all present in hexagen-monaco, and
`.github/workflows/pr-agent.yml` even guards against the reviewer silently not running (`:350-360`).
No template emits any of them — a grep across all 49 manifests and `packages/sync/src/generators/`
hits only `dependabot`.

campaign-foundry independently rebuilt four PR-Agent reviewers, and the operational scaffolding it had
to rediscover is substantial and non-obvious: concurrency keyed by _what the run produces_ and by
sender type (so a bot comment cannot cancel a running review), an exact-match command allowlist
(because PR-Agent exits 0 on an unknown command and the check goes green having done nothing), a
digest-pinned image, and a did-it-actually-run guard that greps the PR's own comments for the tool's
failure string. Each of those encodes a failure that actually happened.

**But the yield data argues against shipping them on by default.** Measured over one wave:

| Reviewer               | Findings | Real                                                                      |
| ---------------------- | -------- | ------------------------------------------------------------------------- |
| Qodo                   | 4        | 4 — including a High the lane's own gate passed                           |
| CodeRabbit             | 3        | 3 — found the same defect as Qodo independently, _and_ the gap in its fix |
| PR-Agent (4 workflows) | ~10      | **1** — a D4 violation in a file that cited D4                            |

#### **F6 · M · The add-on mechanism can emit workflows and config, but cannot touch `package.json`.**

Verified from real manifests: an add-on's `outputs[]` may contain any contained-relative path
(`domain/output-path-safety.ts:16-26`), may be conditional on an answer
(`domain/output-gating.ts:22-50`), and `ci-github-actions` already emits `.github/workflows/ci.yml`
and `.github/dependabot.yml`. **No template lists `package.json`, `tsconfig.json` or
`.architecture/**`in its outputs**, and collisions with structured files are avoided by sidecar
naming —`env-setup`emits`.gitignore.hexagen`, `eslint-no-console`emits`eslint.no-console.mjs`.
The generic conflict path is `<name>.hexagen-update.<ext>` (`domain/conflict-path.ts:27-32`).

**This is the binding constraint on every lane below.** A `format:check` script and a `coverage`
threshold both want to live in `package.json` / a vitest config — files an add-on may not write. §3
says how each lane gets around it, and the answer is different per lane.

#### **F7 · M · There is no premise mechanism, and the nearest equivalent is doctrine.**

campaign-foundry's `plan:verify` failed the PR on 2026-09-16 three separate times — twice because a
fence could not answer within its 10-second budget, once because a fence had silently closed. That is
a real gate with a real yield.

hexagen has no such mechanism in code; a grep for `premise|fence` across `scripts/`, `.github/`,
`tools/` and `packages/sync/src` matches one arch-linter test file. The nearest relative is the
anti-vacuity doctrine — `abortIfVacuous` / `NOTHING WAS CHECKED` (`tools/arch-linter/src/cli.ts:704,:1313`)
— which is the same instinct applied to the linter rather than to plans.

**No lane below proposes generating a premise system.** It is named here because it is the one
high-yield gate that is genuinely _not_ portable: it depends on a planning convention, not on code.

#### **F8 · ~~H~~ → M · A quoted source fragment is coupled to that source's formatting.**

Downgraded on measurement. campaign-foundry's mutation manifests store `before`/`after` **source
fragments**, and a 400-file reformat landed without invalidating any of them — but only because those
fragments happened to fall on lines the formatter left alone. The coupling is real and latent; the
blast radius turned out to be smaller than feared.

Relevant here only as an argument for **G-D7**: a generated mutation harness would inherit this
coupling without the hand-authored discipline that makes it survivable.

---

## 2. The shape of the two add-ons

Both follow the existing directory contract exactly — `manifest.json` + `files/**` + `README.md`, with
`findings/` reserved for author-facing notes that never ship (F-D3).

```
packages/template-engine/templates/quality-gate/
├── manifest.json
├── README.md
└── files/
    ├── .prettierrc.json
    ├── .github/workflows/quality.yml
    └── vitest.coverage.mjs          # sidecar, merged by hand — see §3 L2
```

```json
{
  "id": "quality-gate",
  "name": "Quality gate",
  "provides": "platform.quality",
  "scope": "project",
  "version": "0.1.0",
  "requires": [],
  "conflicts": [],
  "questions": [
    {
      "id": "coverageFloor",
      "type": "select",
      "default": "80",
      "choices": ["off", "60", "80", "100"]
    },
    { "id": "formatCheck", "type": "boolean", "default": true },
    { "id": "formatProse", "type": "boolean", "default": false }
  ],
  "outputs": [
    ".github/workflows/quality.yml",
    {
      "path": ".prettierrc.json",
      "when": { "answer": "formatCheck", "equals": true }
    },
    {
      "path": "vitest.coverage.mjs",
      "when": { "answer": "coverageFloor", "in": ["60", "80", "100"] }
    }
  ]
}
```

`pr-reviewers` is the same shape, `provides: "platform.review"`, with one question per reviewer and
**every reviewer defaulting to `false`** (G-D1: nothing that costs money is on by default).

---

## 3. Lanes

| Lane   | Task                                                                                                                                                                                                                                        | Owns                                                                                                                        | Buys                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **G1** | **`apps/` gets layer rules.** Emit `.architecture/layout.yaml` mapping every `apps/`-rooted context to its real root, and make the linter **report** a skipped module instead of silently passing it.                                       | `packages/sync/src/generators/architecture-files.ts`, `tools/arch-linter/src/cli.ts:585-589,:678-683`, the existing finding | The gap that let every downstream defect through                       |
| **G2** | **`quality-gate` add-on.** The template, its manifest, `quality.yml` (format check + coverage), and the sidecar coverage config.                                                                                                            | `packages/template-engine/templates/quality-gate/**`                                                                        | A project that can fail for its own quality, not just its architecture |
| **G3** | **A Prettier config wherever a `format` script is emitted**, and `.md` out of the glob. Core, not add-on — it repairs an existing emission.                                                                                                 | `packages/sync/src/generators/root-file-templates.ts:28`                                                                    | The 400-file churn event, prevented rather than survived               |
| **G4** | **`pr-reviewers` add-on**, every reviewer off by default, carrying the scaffolding campaign-foundry had to rediscover: concurrency keyed on what the run produces, a command allowlist, a digest-pinned image, a did-it-actually-run guard. | `packages/template-engine/templates/pr-reviewers/**`                                                                        | The two reviewers that actually paid, without the two that did not     |
| **G5** | **Findings for both add-ons**, seeded from this document, under each template's `findings/`.                                                                                                                                                | `templates/*/findings/`                                                                                                     | The store's second real feed                                           |

**Order.** **G1 → G3 ‖ G2 → G4 → G5.** G1 first because it is a live hole in a shipped claim. G3 is
independent of the add-ons and can run beside G2. G4 last because it is the only lane with a
recurring cost, and G-D1 wants it separable. G5 closes.

**Where it splits.** G2 and G4 touch only new directories under `templates/` and cannot collide.
G1 and G3 touch `packages/sync/src/generators/` but different files (`architecture-files.ts` vs
`root-file-templates.ts`).

---

## 4. Definition of Done

Shared gate, per this repo's own convention: `yarn build && yarn typecheck && yarn lint && yarn test`,
plus `yarn workspace <package> typecheck:test`. No coverage assertion is claimed for hexagen's own
suite, because it has none (F4) — this plan does not pretend otherwise.

Per **G-D6**, each lane names the fault that must turn it **red**:

- **G1** — a fixture project with an `apps/`-rooted context containing a deliberate layer violation
  (`domain` importing `infrastructure`) **fails** `arch validate`. Today it passes. Additionally, a
  context whose root does not exist must produce a **diagnostic**, and a test asserts the run is not
  silently green.
- **G2** — with `coverageFloor: "80"`, a generated project whose suite covers 79 % **fails** the
  quality workflow; at 81 % it passes. With `formatCheck: true`, a file reformatted to a different
  width **fails**. Both demonstrated on a real generated fixture, not asserted.
- **G3** — a project generated after this lane, then `yarn format`, produces **no diff**. Today the
  same sequence rewrites the tree. A test pins the emitted glob to the emitted config's scope so the
  writer and the checker cannot disagree — the failure campaign-foundry hit when `.md` was in one and
  not the other.
- **G4** — with every reviewer answered `false`, **no** workflow file is emitted (the conditional
  output is proven absent, not merely untested). With one answered `true`, `actionlint` passes on the
  emitted workflow — reusing the capstone fixtures' existing `actionlint` step.
- **G5** — a finding whose front-matter carries an unknown key is **rejected** by
  `validate-finding.ts`; each new finding parses and is reachable from its template directory.

---

## 5. Risks

**The coverage floor becomes a lie people route around.** A generated project with stub packages will
sit below any floor until it has real tests. G-D2's default of `80` with an `off` choice is the
mitigation; a floor nobody can meet gets disabled in week one and then means nothing.

**`pr-reviewers` ages badly.** Reviewer products change their configuration surface, and a pinned
image digest is correct for reproducibility and wrong for staying current. G4 should emit the guard
(_did the review actually run_) even for reviewers it does not pin, because that guard is what makes
a silent no-op visible.

**G1 could surface a wall of pre-existing violations** in any project that already has `apps/`. The
linter's existing `--ratchet` is the answer — adopt the current state as a baseline and forbid growth
— rather than asking a downstream project to fix N violations before its next PR can land.

**This plan's evidence is one project.** campaign-foundry is a single downstream consumer with one
unusually instrumented day. The yield table in F5 in particular should not be treated as a general
claim about reviewer families.

---

## 6. What would justify more, and what it would cost

A **golden/byte-identity harness** caught the highest-severity defect of campaign-foundry's session
(16 of 16 Linux cells differing from the runner's). It is not proposed because it is inherently
project-specific — it needs a deterministic renderer and a recorded platform baseline, and a generated
stub has neither. If a future template family ships a renderer, that template should carry its own
golden harness and its own "record on the platform's own runner" rule, which is the lesson that cost
campaign-foundry a full lane.

A **premise system** (F7) is the other high-yield gate left on the table. Porting it means porting a
planning convention, not code, and it only pays where plans are written the way this repo writes them.
The honest version is a `docs/planning` add-on that ships the convention and the verifier together —
a larger piece of work than anything above.

---

## 7. What this plan does not pretend

- It does not claim the add-on materializer needs changing. It is **already wired into generation**
  (`generate-project-use-case.ts:193-238`, `apps/web/app/lib/wire.server.ts:85-101`) — the plan doc
  that says "not started" is stale, and that staleness is itself worth a correction commit.
- It does not claim to have verified that `apps/web/app/api/generate/route.ts` threads `addOnsAnswers`
  through to the use case. **Check that before building G2 or G4**, because both are inert if the
  answers never arrive.
- It does not claim core generation seeds an `arch-lint-baseline.json`. The emitted workflow calls
  `--ratchet`, which implies one; whether generation writes a starting baseline is unverified and
  bears directly on G1's ratchet mitigation.
- It does not propose mutation testing (G-D7), a coverage threshold for hexagen-monaco's own suite, or
  any change to the conformance gate, which is sound.
- It does not treat campaign-foundry's numbers as universal. They are one project, one wave, and every
  one of them is cited so a reader can discount them.

---

## 8. Running this plan with the wave orchestration

G1–G5 are five lanes with disjoint file ownership, which is what the wave orchestration wants. Two
rules from campaign-foundry's 2026-09-16 wave are worth importing with them, because both were learned
by being wrong:

**Enumerate, do not describe.** A brief that says "cover the config surface in full" and then lists
three of five fields ships a defect that passes every gate — it happened four times in one day, and
each time the lane implemented exactly what was written. G2's brief must name every file the template
emits; G1's must name every context root it maps.

**A gate must be shown to fail before it is called a gate.** This is already hexagen's rule
(`2026-08-23-enforcement-remediation-plan.md:35`) and §4 is written to it. campaign-foundry re-learned
it three times in one session when its own premise fences could not decide — twice because a probe was
too slow for its budget, once because it probed a proxy that closed before the work did. **Time every
check you add, and construct the failing case before you trust the passing one.**
