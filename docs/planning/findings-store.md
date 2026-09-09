# The Findings Store — Implementation Plan

**Date:** 2026-09-08
**Author:** orchestrator (from campaign-foundry, the first downstream project to feed it)
**Status:** draft — for the owner's review. Nothing built.
**Verified against:** `main` at `c1038b31`
**Orchestration:** ported into this repo on 2026-09-08 — `.claude/skills/orchestrate-wave/`,
`scripts/wave-event.sh`, `scripts/merge-prs.sh`. §8 records what differs here.
**Scope:** a version-scoped record of defects found in generated projects, shipped with the
templates that caused them, readable offline by an agent working in any generated project.

---

## 0. What this plan answers

Every project the generator produces eventually finds a defect that belongs to the generator, not
to the project. Today those findings die in the downstream repository. Three real ones from
campaign-foundry this week:

| Finding                                                                                                                    | Belongs to                |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| CI runners have no zsh, so a test that spawns one passes on macOS and fails in CI                                          | `ci-github-actions`       |
| The arch-linter's layer rules cover `packages/*/src` only, so a claim about `apps/` is unfounded                           | the arch-linter invariant |
| `.agents/session-log.md` grows unbounded — 498 KB, ~125 000 tokens — and any agent told to append to it pays that as input | `agents-md`               |

None of those is a metric. **The unit of value is a finding tied to a template and a version, not
telemetry.** Token counts and durations pooled across projects would not have produced any of the
three.

**What this plan is not.** Not a hosted service, not a database, and not a cross-project inventory.
§6 says what would justify each of those and what each would cost.

---

## 0.1 Proposed decisions

| id       | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F-D0** | **A finding has a _subject_, and only template-subject findings ship.** A subject is either a **template** (`ci-github-actions`, `agents-md`) or a **component** (`arch-linter`, the sync engine) — components have no template directory, so F-D1 has no home for them. Component findings live at `<component root>/findings/` — for the arch-linter that is `tools/arch-linter/findings/`, **not** `packages/`, which is where it actually lives (it publishes as `@hexagen-monaco/arch-linter` from `tools/`) and are **author-facing only: they do not ship**, because a downstream project cannot act on them by choosing a template version. Only template findings reach a generated project. Two of §0's three seed findings are template-subject; the arch-linter scope one is component-subject and proves the distinction is needed on day one. | Without this split the plan contradicts itself: §0 opens with three findings and F-D1 has a home for two of them. A component finding is still worth recording — it is generator debt — but it is not version-scoped payload a project can query, so shipping it would put a record in every tarball that no reader can act on.                                                                     |
| **F-D1** | **A template finding lives inside the template it belongs to**, at `packages/template-engine/templates/<id>/findings/NNNN-<slug>.md`. Not a top-level `findings/` tree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `templates/` is guarded: `discoverTemplateIds()` fails the bundle build and the guard suite for anything at its top level that is not a template directory, because the directory is copied verbatim into the published tarball. A sibling `findings/` tree would be a stray. Inside a template directory, nothing inspects subdirectories, so the finding rides along with **zero build changes**. |
| **F-D2** | **Findings ship in the package and are read offline.** The tsup `onSuccess` copy is recursive and unfiltered, so `templates/<id>/findings/**` lands in `dist/templates/` and in the tarball with no change to the build.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Every generated project already installs the CLI and resolves it through its lockfile, so it already holds the template payload **pinned to the version it runs**. A finding is version-scoped; delivering it by any other channel would decouple it from the version it describes.                                                                                                                 |
| **F-D3** | **A finding is never emitted into a generated project.** Emission reads `templates/<id>/files/**` only (`build-template-bundle.ts:229`, `file-emitter.adapter.ts:64`); `manifest.json` and `README.md` already sit beside `files/` as author-facing metadata and are not emitted. `findings/` joins them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | The record is for the generator's authors and for agents reasoning about a project, not content for the project.                                                                                                                                                                                                                                                                                    |
| **F-D4** | **The record is sanitised by schema, not by discipline.** Front-matter fields are a closed set: `id`, `subject`, `subjectKind` (`template`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `component`), `subjectVersion` (introduced), `fixedIn` (nullable), `class`, `severity`, `surface`, `status`. The body carries a synthetic repro and the fix. **No field can hold a project name, a client name, a file path from a downstream repository, or downstream source.** A validator refuses anything else.                                                                                | Downstream projects are client work. A shared record that _could_ carry client content will eventually carry it. Make the shape incapable of it rather than trusting a reviewer to notice. |
| **F-D5** | **Writes are pull requests; reads are local.** A downstream project never writes to a shared store. Its orchestrator opens a PR against this repository at wave close-out when a finding traces to a template.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | This asymmetry is what makes F-D4 structural: there is no endpoint a client project can write to, so there is no path by which client data reaches a shared store. It also keeps curation — of seven bot findings on one campaign-foundry PR this week, six were false on the code. An unfiltered agent-written store fills with confident nonsense.                                                |
| **F-D6** | **The join key is `(subject id, subject version)`**, both of which already exist: each `manifest.json` carries `id` and its own `version` (`mcp-server` is at `1.0.0`), independent of the published CLI version (`0.12.1`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A finding against `ci-github-actions@1.2.0` is noise to a project on `1.4.0`. Keying on the CLI version alone would be too coarse — one CLI release moves many templates.                                                                                                                                                                                                                           |
| **F-D7** | **~~A project must record which add-on templates it has.~~ CORRECTED 2026-09-08 — it already does, and this plan must not build a second one.** The generator defines `TEMPLATE_CONFIG_FILE = ".hexagen-template-config.json"` with `{ schemaVersion: "1", templates: {} }` and an `isInstalled(config, id)` predicate, and `hexagen add` writes one record per template: `{ installedAt, version: manifest.version, answers, generatedFiles }`. **That `version` is exactly F-D6's join key, already implemented.** The real gap is narrower: campaign-foundry has no such file — its add-ons predate the mechanism or were never applied through `hexagen add` — so the query path must treat an absent config as _unknown_, never as _no templates_.                                                                                                     | Found by the orchestrator when it read the plan against the shipped CLI, and confirmed in `dist/cli.js`. The original finding claimed no record existed and proposed adding `addons:` to `.architecture/manifest.yaml`. That would have created a **second source of truth for the same fact** — the exact defect class this plan exists to collect. The lane is re-cut in §3; see F8.              |
| **F-D8** | **The reader is a local process, not a service.** A small MCP server over the installed `dist/templates/**/findings/**`, generated from this repo's own `mcp-server` template.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | No hosting, no auth, no network, no shared endpoint, and the generator becomes the first consumer of its own template.                                                                                                                                                                                                                                                                              |

---

## 1. Findings about the ground this is built on

#### **F1 · C · `templates/` is a guarded directory, and that decides the layout**

`packages/sync/tsup.config.ts:151-168` copies `../template-engine/templates` into `dist/templates`
**verbatim and unfiltered**, and its comment says so: _"whatever sits under templates/ ends up in
the published tarball… Do not add a second, differently-worded filter here; make that function
authoritative."_ The authoritative function is `discoverTemplateIds()`
(`build-template-bundle.ts:92`), which reports a stray for any top-level entry that is a symlink,
a file, or a directory whose name fails `TEMPLATE_ID`. A top-level `findings/` directory would
therefore fail the build. **A `findings/` directory _inside_ a template is invisible to that check
and ships for free** — the whole of F-D1 and F-D2 follows from this one constraint.

#### **F2 · ~~H~~ → M · A generated project records its templates — the record was there and this plan missed it**

**Corrected 2026-09-08, by the orchestrator, before a line was written.** `dist/cli.js` carries
`TEMPLATE_CONFIG_FILE = ".hexagen-template-config.json"`, `emptyConfig()` returning
`{ schemaVersion: "1", templates: {} }`, `isInstalled(config, templateId)`, and one written record
per applied template:

```js
const record = {
  installedAt: new Date().toISOString(),
  version: manifest.version,
  answers,
  generatedFiles,
};
config.templates[id] = record;
```

The original text of this finding said no record existed. It was wrong, and the plan's own §7 rule
applies to it: _evidence, not a rule_. What remains true is narrower and still matters —
**campaign-foundry has no such file**, so a reader must distinguish _no config_ (unknown) from
_config with no templates_ (genuinely none). Attribution is not blocked; it is conditional.

#### **F9 · H · §8's "already anticipates" was false, and would have aborted wave 1's second merge**

Found by the orchestrator while reading the ported scripts before committing them. §8 (F6) claimed
`merge-prs.sh`'s append-only allowlist already admitted `.agents/session-log.md`. **It did not** —
the ported regex was `^(CHANGELOG\.md|docs/planning/[^/]+\.md)$`, which I wrote by hand during the
port and then described from campaign-foundry's behaviour rather than from what I had written. A
wave whose two lanes both appended a record would have aborted its **second** merge on exactly the
conflict the resolver exists to handle. Fixed in PR #669: the regex admits `.agents/session-log.md`
while still denying `.agents/ORCHESTRATOR.md` and every source path. **A ported file's behaviour is
a claim about the port, not about the original.**

#### **F8 · H · How the plan missed it, and the check that would have caught it**

The original search was `find . -maxdepth 2 -name "hexagen*"` and a grep of `.architecture/`. The
file is **dotfile-prefixed and at the project root**, so the first pattern could not match it and
the second looked in the wrong directory. **A claim that something does not exist must be tested
against the tool that would create it, not only against the filesystem** — one grep of the shipped
CLI for the concept would have found it immediately. This is a finding about _this plan's method_,
and it is the reason F-D7 now carries its own correction rather than a silent edit.

#### **F3 · M · Template versions already exist and are per-template**

`manifest.json` carries `id`, `version`, `requires`, `conflicts`, `provides`, `scope`, `questions`,
`envVars`, `outputs`, `checklist`. `mcp-server` is `1.0.0` while the CLI is `0.12.1`. The finding
schema keys on the template's own version (F-D6).

#### **F4 · M · The distribution channel already reaches every project, offline**

47 templates, 2.0 MB, present in a downstream `node_modules` and resolved through the lockfile.
Findings need no new channel — only ~10 KB more in the same tarball.

#### **F5 · H · This repository's gate is not campaign-foundry's, and the plan's lanes must say so**

Learned while porting the orchestration. `yarn lint` **already chains `lint:arch`**, so a separate
step is a lie in a report. There is **no root coverage script** — `test:cov` does not exist and no
100 % counter can be asserted; `yarn test` is the bar. `yarn sync` **runs the generator**, it is not
a check, and there is no `sync:check`.

**Corrected 2026-09-08, after wave 1.** This finding originally gave the lane gate as
`yarn build && yarn typecheck && yarn lint && yarn test` and stopped there. That is **incomplete,
and incomplete in the direction that lets a lane pass and still redden `main`** — which is exactly
what lane G2 did. `typecheck` is `tsc --noEmit` over each package's `tsconfig.json`, and those
exclude `__tests__` by design, so **nothing in the stated gate ever type-checks a test file**. G2's
guard suite carried three `Dirent<NonSharedBuffer>` errors, passed the stated gate locally, and
failed CI.

The gate a lane must run is therefore:

```
yarn build && yarn typecheck && yarn lint && yarn test
yarn workspace <the package it touched> typecheck:test
```

The second line is not optional and not a nicety: `sync-integrity.yml:95` runs
`yarn turbo run typecheck:test` across all 35 packages via each one's `tsconfig.test.json`, which
_includes_ `__tests__/**`. The repo added that step deliberately (AUD-020: test fixtures had
silently drifted from the ports they stood in for). Note the trap this created in wave 1 — two
independent reviewers cited AUD-020 as evidence that `typecheck:test` "is run by no workflow",
reading the _problem statement_ rather than the step that fixed it.

**What CI runs beyond the lane gate**, in the "Verify Sync Engine & Hexagonal Structure" job, in
order: Verify Dependency Constraints (`yarn constraints`) · Build All Packages · **Execute Hardened
Sync** · Verify Build After Sync · Verify TypeCheck After Sync · **Verify TypeCheck (test
sources)** · Verify Architecture (arch-linter, strict) · Verify Template Questions Generator
Parity · Run Test Suite — plus a Windows job, `lint.yml`, `capstone.yml` (path-filtered, and
`packages/template-engine/**` is in its filter, so every lane in this plan triggers it) and two
standalone packaging smokes. **A lane brief may not claim the local gate is the merge gate.** It is
a fast subset; CI is the gate.

`AGENTS.md` also names files a lane may never edit — `generator.config.yaml`, any `dist/`, any
`*.tsbuildinfo`, `src/**/*.d.ts`, `yarn.lock`, `turbo.json`, `.gitignore` — changed only by stating
a reason, getting the owner's confirmation, and running `yarn sync --force-root`. **G2 was
therefore built as a module inside `template-engine` rather than a new package** (owner's call,
2026-09-08): a new workspace needs a `yarn.lock` entry and every CI job installs `--immutable`.
G4 inherits that constraint. The earlier text here said "G2 and G4 add a package; both touch none
of them" — the second clause was false, and it is the same error class as the gate above: a claim
about the build written without checking what the build actually does.

#### **F6 · M · CI here is four workflows, and the merge poll had to be retargeted**

`sync-integrity.yml` (_"Build & Sync Integrity Check"_, with a Windows job) is primary; `lint.yml`,
`capstone.yml` and `pr-agent.yml` run beside it. The ported `merge-prs.sh` polls
`^(Build & Sync Integrity Check|Verify Sync Engine)` rather than campaign-foundry's `^Build`, and
its append-only allowlist is now `CHANGELOG.md` and `docs/planning/*.md` — this repo has no
`.agents/session-log.md`, so **the wave record has no home yet** (see §8).

#### **F7 · L · A curation step already exists and should not be automated away**

campaign-foundry's orchestrator writes a close-out record per wave naming what was refuted and why.
The upstream PR (F-D5) is one more step in a habit that already exists.

---

## 2. The shape of a finding

```markdown
---
id: 0001
subject: ci-github-actions
subjectKind: template # template (ships) | component (author-facing only)
subjectVersion: "1.2.0" # where it was found
fixedIn: "1.3.0" # null while open
class: host-assumption # closed vocabulary
severity: high # critical | high | medium | low
surface: ci # ci | build | lint | test | runtime | docs | dx
status: fixed # open | fixed | wontfix
---

## What happens

The emitted workflow runs tests on `ubuntu-latest`, which has no zsh. A test that spawns
`zsh` passes on a macOS developer machine and fails in CI with `spawnSync zsh ENOENT`.

## Minimal repro

A test that shells out to `zsh -c 'echo hi'`, run on a stock `ubuntu-latest` runner.

## Fix

Ship POSIX `sh` for anything a test executes; gate zsh-only operator scripts behind a
`skipIf(!hasZsh)`.
```

Prose in the body is synthetic and generic by construction. A validator enforces the closed
front-matter vocabulary and rejects any additional key (F-D4).

---

## 3. Lanes

| Lane    | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Owns                                                                         | Buys                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| **G1**  | **Make the existing record authoritative** (F-D7 as corrected, F2). **Not** a new record. Read `.hexagen-template-config.json` through the template-engine's existing config store; establish the three-state contract — _absent_ = unknown, _present and empty_ = no add-ons, _present with entries_ = the list; and add whatever is missing for the query path only (the entry already carries `version`, so probably nothing). If the audit finds the record complete, **this lane is a test suite and a doc, and it should say so rather than inventing work.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `packages/template-engine` config store, tests                               | Attribution, on the mechanism that already exists         |
| **G2**  | **The finding schema and its validator** (F-D4, F-D6). The front-matter type, the closed vocabularies, a parser, and a validator that rejects unknown keys, a missing `fixedIn` on `status: fixed`, an unknown subject id, and a `subjectKind` that does not match where the file sits. **A module inside `template-engine` at `src/domain/findings/**`, not a package** (owner's call 2026-09-08): a new workspace needs a `yarn.lock`entry,`yarn.lock`is protected by AGENTS.md, and every CI job runs`yarn install --immutable`. Extract later if G4 justifies it. **`subjectVersion`is validated in its testable form** — the subject exists, the version is well-formed semver, and it is not ahead of that subject's current`manifest.json`. "A version no manifest ever carried" needs git history and is not knowable at validation time.                                                                                                                                                                                                                                                                                                                                              | `packages/template-engine/src/domain/findings/**` (new dir), a guard test    | A record that cannot carry the wrong thing                |
| **G3**  | **Seed the store** (§0, F-D0). The two template-subject findings as `templates/ci-github-actions/findings/0001-*.md` and `templates/agents-md/findings/0001-*.md`; the arch-linter scope finding as a **component** finding at `tools/arch-linter/findings/0001-*.md`, which does not ship. Assert in the guard suite that `discoverTemplateIds()` still reports **no strays**, the bundle build is unchanged, and the component finding is **absent** from the tarball.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `templates/ci-github-actions/`, `templates/agents-md/`, `tools/arch-linter/` | Proof the layout ships for free, and that the split holds |
| **G4**  | **A query API over the installed store.** `listFindings(templatesDir, { template?, version?, status? })` — a **pure function taking the templates directory as an argument**, not resolving it. **Corrected 2026-09-09, before dispatch.** The original text said it should reuse "the same dual resolution `resolveTemplatesDir()` already does" and own a `packages/template-findings` package. Neither is available: (a) that package was decided against for G2 (a new workspace needs a `yarn.lock` entry and every CI job installs `--immutable`), so the findings module lives at `packages/template-engine/src/domain/findings/`; (b) `resolveTemplatesDir()` lives in `packages/sync` and resolves relative to **its own** module (`packages/sync/dist/templates`, where tsup copies the tree), and `sync` depends on `template-engine`, not the reverse — so the module cannot import it without inverting the dependency. Resolution therefore stays with the **caller**, which already owns it: `sync` passes its `resolveTemplatesDir()` result in, and G5 wires the two. This also makes "no network is possible" trivially true rather than a thing to assert about path logic. | `packages/template-engine/src/domain/findings/`, tests                       | The read path                                             |
| **G5**  | **`hexagen findings`** — a CLI subcommand listing what applies to _this_ project by reading its `.hexagen-template-config.json` (G1) and filtering by version (G4). This is the smallest thing that delivers value to a human.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `packages/sync` CLI, tests                                                   | A developer can ask "what is known about my templates"    |
| **G6**  | **The MCP reader** (F-D8). Generated from this repo's own `mcp-server` template: one tool, `findings.forProject`, over G4. Runs locally per project.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | new package from `hexagen add mcp-server`, tests                             | An agent can preload known issues into a lane brief       |
| **G6b** | **The web-generation gap** (found by the orchestrator, 2026-09-08). `InMemoryTemplateConfigStore.save()` is a documented no-op (`in-memory-template-config-store.adapter.ts:17-19`), so **every web-generated project silently drops the config file** — the likeliest reason campaign-foundry has none. Closing it changes the output of every web-generated project, which is a blast radius, not a corner of a test lane. **Its own lane, after G1 proves the three-state contract.** It is also this store's first real component finding: record it as one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | the in-memory adapter, the web generation path, tests                        | Every future project records its templates                |
| **G7**  | **The upstream write path** (F-D5). A documented procedure plus a `hexagen findings new` scaffold that writes a valid stub. No automation of the PR itself — a human or an orchestrator opens it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `packages/sync` CLI, `docs/`, `AGENTS.md`                                    | The loop closes                                           |

**Order.** **G1** → **G2** → **G3** → **G4** → **G5** ‖ **G7** → **G6**.

**Where it splits.** G1–G5 is a complete, useful system: projects declare their templates, findings
are recorded and validated, and a developer can list what applies. G6 and G7 are the agent-facing
and contributor-facing surfaces; re-plan them once G5 has been used a few times, because how people
actually query it will change the tool's shape.

---

## 4. Definition of Done

Every lane's gate here is `yarn build && yarn typecheck && yarn lint && yarn test` **plus
`yarn workspace <package> typecheck:test`** (F5, corrected after wave 1 — the plain `typecheck`
excludes `__tests__`, so without the second command a lane can pass locally and redden CI, which
G2 did). No coverage assertion, no separate `lint:arch`, no `sync:check`. Plus one mutation per
behavioural claim, its diff shown before it runs.

- **G1** (rewritten 2026-09-08 — the old text described the record this lane no longer builds):
  a RED test first, proving `FileSystemTemplateConfigStore.load()` returns `emptyConfig()` on
  `ENOENT` (adapter lines 13-15) so _absent_ and _present-but-empty_ are indistinguishable today;
  then an **additive** fix — a new port method, because `load()`'s contract is depended on by 12
  source files and 36 test suites and must not change; then the config store's **first** test
  suite, which it has never had. The three states are asserted by name: absent → unknown,
  present-and-empty → no add-ons, present-with-entries → the list.
- **G2**: an unknown front-matter key, an unknown `class`/`severity`/`surface`, a `fixedIn` on an
  `open` finding, and a `subjectVersion` that no manifest ever carried are each refused with the
  field named; a finding whose body contains an absolute path outside the generator is refused.
- **G3**: `discoverTemplateIds()` reports **no strays** with `findings/` present; the published
  tarball contains the finding files; **no generated project receives them** (assert the emitter's
  output for a template that has findings is byte-identical to before).
- **G4** (rewritten 2026-09-09 — the old text asked the module to resolve a directory it cannot
  reach): `listFindings` is **pure** — it takes a templates directory and reads only beneath it,
  so the same function serves the monorepo layout and the installed-package layout because the
  caller supplies the difference. Given a fixture tree it returns every finding under
  `<dir>/<template>/findings/**`; filtering by version excludes a finding whose `fixedIn` precedes
  the version asked for; filtering by `template` and `status` narrows as named; an absent or empty
  directory yields an empty list, never an error. No network call is possible — assert the module
  imports nothing that can make one, which is now a statement about its imports rather than about
  path resolution.
- **G5**: run inside campaign-foundry, `hexagen findings` lists the three seeded findings that
  apply and nothing else.
- **G6**: one tool, read-only; a written file or a network attempt fails the test.
- **G7**: `hexagen findings new` emits a stub that passes G2's validator unedited.

---

## 5. Risks

| Risk                                                                                                                      | Mitigation                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A finding discovered after a version ships cannot reach projects pinned to it.**                                        | Data-only patch releases are cheap. If that chafes, split findings into their own tiny package that a project can bump independently of the CLI — but do not start there; it doubles the release surface for a problem that may not appear. |
| **The store fills with false findings.** Six of seven bot findings on one downstream PR this week were false on the code. | F-D5: PR review is mandatory and there is no write endpoint. A finding must carry a repro that fails.                                                                                                                                       |
| **Client content leaks upstream.**                                                                                        | F-D4 makes the schema incapable of carrying it, and G2's validator refuses a body containing an absolute path outside the generator. Reviewers are the second line, not the first.                                                          |
| **`templates/` guard changes and strays become permitted**, letting a top-level `findings/` tree creep back in.           | G3 asserts no strays with findings present, so a guard weakening shows up as a test change, not as silent drift.                                                                                                                            |
| **Findings rot** — `fixedIn` never gets set.                                                                              | G2 refuses `status: fixed` without `fixedIn`; a template version bump with an open finding against it is a reviewer prompt, not an automated gate.                                                                                          |

---

## 6. What would justify more, and what it would cost

- **A database** — when grep stops working (hundreds of findings) or when a query needs joins the
  filesystem cannot express. Cost: hosting, auth, a client, a migration path, and it front-runs the
  identity decision the downstream projects have not taken.
- **A hosted service** — only for cross-project questions such as _"which projects run a template
  version with a known critical finding"_. That needs an **inventory of projects**, which is a more
  sensitive dataset than the findings themselves and deserves its own plan and its own consent
  model. Do not let it arrive as a side effect of this one.
- **Real telemetry** (tokens, durations, pass rates) — a different system with a different consent
  posture. This plan deliberately excludes it; nothing here should grow a metrics field.

---

## 7. What this plan does not pretend

- **It does not close the loop by itself.** G1–G5 make findings recordable, shippable and
  queryable. Someone still has to notice a defect and write it down.
- **It does not make findings authoritative.** A finding is a note from one project, reviewed by a
  human. It is evidence, not a rule.
- **It changes no build step.** F-D1 and F-D2 are chosen precisely so that the existing verbatim
  copy does the distribution work. If a lane finds itself editing `tsup.config.ts`, the layout is
  wrong and the lane should stop and report.

---

## 8. Running this plan with the wave orchestration

Ported on 2026-09-08 from campaign-foundry, adapted, and smoke-tested here:

| Piece                                                      | State                                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `.claude/skills/orchestrate-wave/SKILL.md`                 | gate, protected files and plan pointer rewritten for this repo                                           |
| `.claude/skills/orchestrate-wave/references/cast.md`       | seats, spending rules and traps carry over; a provenance note says the track record was earned elsewhere |
| `.claude/skills/orchestrate-wave/scripts/dispatch-lane.sh` | unchanged; syntax-checked                                                                                |
| `scripts/wave-event.sh`                                    | unchanged; smoke-tested, writes `events.jsonl`                                                           |
| `scripts/merge-prs.sh`                                     | CI poll and append-only allowlist retargeted (F6); syntax-checked under zsh, its real interpreter        |

**Three gaps to close before or during wave 1.**

1. **The wave record goes to `.agents/session-log.md`** (owner's call, 2026-09-08). `.agents/` is
   tracked and not ignored, and `merge-prs.sh`'s append-only allowlist already anticipates that
   path. **Reconcile with `.agents/ORCHESTRATOR.md`**, a 215-line spec this repo already has
   (decompose → parallelise → work-plan table → governance injection → quality gate → sub-agent
   roles) which the ported skill does not reference. They are not rivals: ORCHESTRATOR.md describes
   _how to decompose and govern_, the ported skill describes _how a lane becomes a merged PR_. The
   first wave should state which governs where, in the record, rather than letting two specs drift.
2. **`tools/wave-status/` was not ported.** It is a TypeScript tool with its own tsconfig and test
   suite; dropping it into a different build would risk this repo's gate for a convenience. Port it
   as its own lane if the window is wanted.
3. **`.claude/` is gitignored** — resolution: **copy the skill into each worktree** (owner's call,
   2026-09-08); no protected-file change, no trace in the repo. (`.gitignore:85`), so a lane worktree branched from `main` will not
   contain the skill or `dispatch-lane.sh`. Either un-ignore `.claude/skills/` (a protected-file
   change needing `yarn sync --force-root`) or have the orchestrator copy the skill into each
   worktree. `scripts/wave-event.sh` and `scripts/merge-prs.sh` are untracked but **not** ignored —
   commit them.
4. **Re-probe every seat.** Quotas are per-account and shared with campaign-foundry's runs; gemini
   was at 76 % of its week on 2026-09-08 and grok resets 2026-09-14 16:28.
