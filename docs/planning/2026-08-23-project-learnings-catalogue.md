# Project learnings catalogue

**Date:** 2026-08-23
**Scope:** the whole repository — 70 ADRs, PRs #400–#626, the `.agents/` review doctrine, `best_practices.md`, and the memory of corrections across every session that touched this codebase.
**Supersedes in scope:** `2026-08-23-learnings-from-the-brownfield-and-dp1-arc.md`, which covered one arc (#606–#626). That document stands as the detailed record of that arc; this one is the catalogue of the project.

**How to read it.** §0 is the one finding everything else instantiates. §1–§4 are the defect classes, each with instances cited by PR number so every claim can be checked. §5 is the doctrine the ADRs established, with the mistake each corrects. §6 is the misreads — places where a person or a bot read the evidence wrong. §7 is the deterministic-failure navigation table. §8 is the derived practice. §9 is what the record itself gets wrong.

Every instance below was verified against a squash-commit body, an ADR, or a live probe. Where a figure is given it came from a grep or a measurement, not a recollection.

---

## 0. The master pattern

**A check that reports success while checking nothing.**

Not a wrong answer — an absent one, dressed as a right one. A wrong answer gets investigated. An absent one retires the question, and the defect it would have caught ships under a green tick.

This is not a pattern that appeared once and was fixed. It is the **default failure mode of any check written by someone who expected it to pass**, and it recurred across every arc in the repository's history. Counted across #400–#626, there are **more than forty** distinct instances. The repository eventually gave it a name — _AUD-010_ — and taught all three review bots to hunt for it as a first-class category (#504).

The shapes it takes, each with a canonical instance:

| shape                                                                  | canonical instance                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The gate never ran**                                                 | `sync-integrity.yml`'s architecture gate ran `sync --dry-run`, which short-circuits the linter entirely. _"The architecture gate was decorative."_ (#452)                                                                                                                                                |
| **The gate ran over an empty population**                              | The prop-brand check printed _"28 prop types scanned"_ and a green tick over declarations it never looked at, through four separate blind spots. (#519)                                                                                                                                                  |
| **The gate swallowed its own failure**                                 | `loadOptionalYamlConfig` mapped every failure to "using defaults," so a corrupt `linter-config.yaml` disabled every rule and the linter printed _"Architecture is compliant."_ (#448)                                                                                                                    |
| **The gate's exit code conflated two meanings**                        | The arch-linter returned `1` for both "found violations" and "could not run" — _"gate found problems and gate never ran were the same signal."_ (#496). Repeated in `hexagen scan`, where a scan that never ran _"told the UI the architecture had violations."_ (#577)                                  |
| **The gate was bypassable**                                            | `check-lint-coverage.mjs` tested `Boolean(pkg.scripts?.lint)`, so `"lint": "echo ok"` satisfied it. (#462)                                                                                                                                                                                               |
| **The gate's fixture created the thing it verified**                   | `monorepo-root.test.ts` writes its own manifest, then finds it. It proves the walk; it cannot notice a missing tree. (#616)                                                                                                                                                                              |
| **The gate was written to catch this class and had the defect itself** | The PR-Agent failure guard: `--raw-field` switched `gh api` to POST (it tried to _create a comment_), `$since` was undefined, `\|\| echo 0` swallowed both. _"A guard that cannot fail, inside the guard built to catch guards that cannot fail."_ (#625)                                                |
| **The test harness itself was lying**                                  | Vitest 4 auto-selects a silent "agent reporter" when it detects `CLAUDECODE` or `AI_AGENT` in the environment. _"0 warnings in an agent shell, 23 with the variables unset. Any test evidence gathered in an AI-assisted shell has therefore been systematically unreliable in this repo."_ (#509, #514) |

That last row deserves its own sentence. For an unknown period before August 2026, **every test run an AI agent performed in this repository suppressed its own warnings.** The fix to `apps/web` (#509) left 32 other workspaces affected (#514), and the fix to _that_ had a defect (`mergeConfig` concatenates arrays, producing `["default","default","github-actions"]`). Three rounds to pin a reporter.

### The practice, which the rest of this document elaborates

1. **Every guard is shown failing before it is trusted.** Inject the fault — delete the binary, revert the fix, corrupt the config, empty the population — and observe non-zero exit with a message naming the cause. The repository's own phrase is _"Verified discriminating"_ (#440, #452, #457, #461, #470, #479, #490, #494, #501, #516, #524). In the #606–#626 arc: every guard mutation-tested held; every guard only reasoned about had a hole. 100% and 0%.
2. **Assert non-empty before asserting clean.** `files.length > 0`. A counter of cells inspected. A `filesInspected === 0` branch that _fails_. ADR-language: _"Anti-vacuity is mandatory and mutation is the proof."_ (#503)
3. **"Could not check" is a failure, never a zero.** No `\|\| echo 0`, no `catch { return [] }`, no coercion to a default. The step fails and says _why it could not run_.
4. **Carry the evidence.** A catch that fails closed but discards `stderr` is half right. Include exit status and stderr in the thrown error. (#616 first draft; #508 _"nothing is tolerated, ENOENT included — a selective allow-list is how this bug grows back"_)
5. **Exit codes separate "found problems" from "could not run."** 0 / 1 / 2, never 0 / 1. (#496, #577)
6. **Ratchets fail on stale entries, not only new ones.** _"Failing on a stale entry rather than only on a new one is the property that stops the allowlist rotting into permanent permission."_ (#459, #462, #502)

---

## 1. Defect classes in the test layer

### 1.1 Vacuous assertions

The gate runs, but over an empty or wrong population. Distinct from §0 in that the machinery works; the question asked is empty.

| PR               | instance                                                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #421             | `indexOf` returns `-1` for a missing title, so a newest-first assertion passes when the item never rendered                                                                                                                                                                                                |
| #478             | The anti-stub floor was `files.length > 200`; the first replacement was self-referential and _"cutting the roots to packages alone still passed all eleven tests"_                                                                                                                                         |
| #499, #500, #501 | _"with both scan regexes broken and the anti-vacuity assertions weakened to `>= 0`, the suite passes green over an empty population"_                                                                                                                                                                      |
| #518             | _"Dropping the field-population assertions leaves nine tests passing over an empty field set"_                                                                                                                                                                                                             |
| #595             | **The route ratchet did not observe the route.** Both creation-path tests compared two in-repo constants. _"Deleting the page file left them green."_ The author's own PR body had overclaimed what the pair proved.                                                                                       |
| #570             | _"the delivered test asserted only that the call throws, which passes against the OLD implementation too"_                                                                                                                                                                                                 |
| #616             | Four telemetry privacy tests asserted an absence after an unchecked `record()` write. A rejected fixture yields empty rows; the "no user content in any column" guarantee passed having inspected zero cells.                                                                                              |
| #616             | Emptying `NOT_YET_ROUTED` made a `for` loop iterate zero times; the ratchet stayed green asserting nothing.                                                                                                                                                                                                |
| #626             | The first remedy for a vacuous `not.toContain` asserted `fellThrough.length > 0` on a fixture that also applies a fix — **unsatisfiable**, because every reachable violation except `Invalid YAML` is repaired and `Invalid YAML` stops the parse. A fix for a vacuous guard replaced it with a false one. |

**Practice:** the population guard precedes the cleanliness assertion, always. When hardening a test, _run it_ — the hardening can be wrong in a way the original was not.

### 1.2 Mocks that replaced the subject

| PR   | instance                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #494 | _"the Wave-1 tests mock `wire.server`, so a new getter would have sat outside those mocks and left all four assertions passing over a mocked-away subject"_                                                   |
| #479 | _"A ninth test was written and deleted rather than shipped — it survived its mutation because `vi.mock` replaced the library it was meant to be watching"_                                                    |
| #605 | `vi.mock("node:child_process")` _"rewires the test file's binding, not the route's, so the real `execFile` ran while 'the fake was called' assertions passed against an empty recording"_                     |
| #616 | Every scan-route unit test injected the root (`new CliHexagenScanAdapter(ROOT, …)`) or mocked the factory (`fromMonorepoRoot: () => ({ scanZip })`), so the one line that throws in production never executed |
| #483 | Mocks returned `{ ok, value }` where `Result` is `{ success, value }` — _"passing only because mock and assertion shared the same wrong shape"_                                                               |
| #524 | _"the hardware profile factory returns a `Result`, so the hook was reporting the wrapper and the assertion compared it to the same wrapper"_                                                                  |

**Practice:** when a test mocks the seam, write a second suite that drives the real composition root (#477). A test that passes because its mock agrees with its assertion has tested the mock.

### 1.3 Fixtures that encoded a shape no real file has

| PR   | instance                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #487 | **The canonical case.** _"The tests were accomplices. Fixtures hand-wrote a shape no real file has, which is why the defect survived: the suite asked the code to agree with the fixture rather than with the repo."_ The analyzer read `layers.domain.adapters`; zero of 34 real files use that path. A guard now asserts every key the analyzer reads appears in at least one real file. |
| #569 | The golden fixture encoded `layout` as a structured object; the real consumer guards on `typeof === "string"`. Producer and consumer contract tests were _both_ written against the fixture, so they _"would have agreed with each other and disagreed with reality."_                                                                                                                     |
| #460 | 188 accumulated test type errors: fixtures on shapes the real types never had, invisible because `__tests__` was excluded from every tsconfig                                                                                                                                                                                                                                              |
| #616 | `ImportOptionRow` used the real `github` option as its "coming-soon" fixture. Shipping github broke four tests about rendering behaviour that never changed. _"Using production data as a fixture makes the fixture change when the product does."_                                                                                                                                        |
| #597 | _"a fixture that no longer matches its producer reads as proof while proving nothing"_                                                                                                                                                                                                                                                                                                     |

**Practice:** fixtures for _state_ tests are synthetic. Fixtures for _contract_ tests are captured from the real producer and pinned with a key-set assertion. Never the reverse.

### 1.4 Tests that were not type-checked

| PR         | instance                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #460       | `turbo run typecheck` excluded `__tests__` in every tsconfig. _"Nothing in CI ever type-checked a test file."_                                                                                          |
| #486       | `governance` was in the publish filters but had no `typecheck:test` task, so turbo silently skipped it. Adding it surfaced 9 real errors.                                                               |
| #513       | A deleted adapter test compiled while supplying 10 of 26 required properties, _"using `assert.ok` on an assign-only constructor, so it could not fail"_                                                 |
| #595, #616 | `apps/web/tsconfig.json` excludes `**/*.test.tsx`. A required prop was added and a test broke **invisibly**; `yarn typecheck` reported 0. This is still true — `apps/web` has no `typecheck:test` task. |

**Practice:** `apps/web` test files are not typechecked. Runtime tests are the only check there. Every other package has `typecheck:test`; treat its absence as a known blind spot, not a convention.

### 1.5 Flaky-timing tests, and the one correct reversal

| PR       | instance                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #424     | The clearest self-correction in the history. First commit raised a `waitFor` to 15s blaming CI contention. Second commit: _"run 30142934591 failed identically at 15421ms, **refuting the starvation diagnosis**."_ Real cause: `form.watch` was a passive effect landing one task after the fields committed; _"`watch(cb)` doesn't replay, so the edit is PERMANENTLY lost, which is why no timeout helps."_ Fixed with `useLayoutEffect`; timeout reverted to 1s. |
| #384     | Three streaming tests skipped on the premise jsdom exposes no readable body. A probe proved `response.body` _is_ a real `ReadableStream`. The real blocker was provider gating — `resolveExecutionStrategy` returning `"none"` before any fetch. And: a transient-state assertion must _hold_ the response open via a gate promise; `delay(0)` failed 3/8.                                                                                                           |
| #497     | Deleted a test that asserted a mock whose body is `setTimeout` took ≥2500ms. _"It asserts that `setTimeout` waits."_ Repair rejected: _"fake timers would only assert that fake timers advance."_                                                                                                                                                                                                                                                                    |
| ADR-0033 | Timing-test policy: no wall-clock assertions; deterministic gates instead.                                                                                                                                                                                                                                                                                                                                                                                           |

**Practice:** a timeout increase that does not fix a red run has refuted its own diagnosis. Revert it and find the real cause.

---

## 2. Defect classes in the build and toolchain

### 2.1 Stale `dist` and build-order traps

`apps/web` and `packages/sync` resolve workspace dependencies through `dist/`, not source. Turbo replays cached builds across branches. This cost time on every arc.

| PR         | instance                                                                                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| runbook §2 | `filesScanned` gained `.nullable()` in source while `dist` still carried main's version — a "schema bug" that was a stale build                                                                                                                             |
| #452       | Yarn writes `node_modules/.bin` shims only for bins whose target exists at install time; the linter's target is a build artifact, so **the shim was never created**. Measured with a 4-row truth table.                                                     |
| #465       | _"On a fresh installed-but-unbuilt tree, `yarn lint:arch` dies with MODULE_NOT_FOUND… `turbo run lint`'s `dependsOn ^build` never reaches `@hexagen/arch-linter`"_                                                                                          |
| #616       | `tools/arch-linter` was never built in CI because `hexagen scan` invokes it as a **subprocess** — nothing imports it, so turbo has no `^build` edge. The Docker builder stage is a clean checkout. Fixed by declaring the dependency that genuinely exists. |
| #616       | The spacing gate ran before "Build Packages" and shelled to `eslint` directly, bypassing turbo's `^build`. `ERR_MODULE_NOT_FOUND` on the plugin's `dist`.                                                                                                   |
| #448       | `yarn install --immutable` failed on every CI job because a bin retarget did not regenerate the lockfile's mirrored `bin:` entry                                                                                                                            |
| #433       | A template relied on a sibling workspace hoisting `@types/node` — _"built clean locally but failed in CI"_                                                                                                                                                  |
| #624       | Relative imports in an ESM package need the `.js` extension. The compiler accepts its absence; Node does not.                                                                                                                                               |

**Practice:** after editing any package source, `yarn turbo build --filter=<pkg> --force` before consuming it. Assume `dist` is stale until proven otherwise. A subprocess dependency is a real dependency; declare it.

### 2.2 Worktree-authored work arrives unverified

Delegated workers author in worktrees with no `node_modules`. Every "tests pass" claim is authored-but-unrun until the Primary re-runs it. The runbook says this; every packet in #606–#626 confirmed it.

| PR         | what arrived broken                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #598       | 3 of 56 tests failing on arrival — `useLayoutRatify` keyed on an array reference, "Too many re-renders"                                                       |
| #616       | `platform-db.ts` did not parse: backticks inside SQL comments inside a JS template literal. The worker's type-stripper tolerated it; the real parser did not. |
| #616, #621 | Two separate packets arrived with prettier failures — the formatting gate covers `**/*.md` and the worker could not run prettier                              |
| #626       | Two test assertions unsatisfiable; jsdom has no `showModal`; one assertion quoted copy that exists nowhere                                                    |
| #572       | _"Three fixes to the delivered work, all found by actually running the suite the delivered test file could never have passed"_                                |
| #594       | _"Node strips types but not JSX — so the author could not even syntax-check the four .tsx files"_                                                             |
| runbook §1 | Collection trap: the worktree branch has no commit, so `git checkout <ref> -- path` silently yields main's copy. Copy from the worktree directory.            |

**Practice, in order:** prettier → typecheck → the package's own suite → the gates. Each catches what the next would obscure. Then the full `apps/web` suite — after changing a shared domain constant, the touched subset is the wrong scope (#614: six failures in three suites not run).

### 2.3 Portability invisible under ubuntu-only CI

| PR   | instance                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #466 | A ts-morph output (forward slashes) minus a native-separator input — _"On Windows… classifies every file as package unknown. Invisible because CI is ubuntu-latest only."_                                                |
| #458 | fast-glob does not treat `\` as a separator, so a `path.join` glob matched nothing on Windows                                                                                                                             |
| #545 | `isContainedRelativePath` walked only `/`; `..\..\outside.txt` escaped on Windows                                                                                                                                         |
| #567 | husky's shim runs `sh -e` regardless of shebang; dash has neither process substitution nor `read -d`                                                                                                                      |
| #449 | A suite red on Node ≥24 was invisible because CI pins 22.7, where Web Storage is flagged off                                                                                                                              |
| #616 | The smoke test ran the packaged artifact on Node 22 while the image runs `node:20-alpine` — two bots caught it independently. A job whose purpose is to run the artifact must run it on the version the image runs it on. |

### 2.4 ESLint flat config replaces rather than merges

Four independent demonstrations, one causing a real regression on `main`:

- #492, #498, #520: the ADR-0021 local-llm ACL entry must be _repeated_ in every scoped block. Removing it as "duplication" silently exempts the directory. _"That is the fourth independent demonstration in this arc that flat config replaces rather than merges."_
- #504: encoded as a do-not-flag rule in all three bot configs, because bots kept proposing the deletion.

### 2.5 Dead config does not announce itself

- #482, #461: the c8 script and devDependency, the Jest config surviving the Vitest migration by months. _"Dead config does not announce itself, so its return would be as quiet as its survival was."_
- #464: `layer-rules.yaml` keyed on a deleted directory.
- #517: `tsconfig.base.json`'s `references` array — _"nothing reads the array… A missing entry could never have failed a build and neither could a stale one."_

---

## 3. Defect classes in boundaries and contracts

### 3.1 Seam edits without verifying the path was live

The single most expensive class by wall-clock. The memory file `feedback_verify_codepath_live` records its origin: in June 2026, _four code reviews, a WIP pass, and a "live regression" hotfix_ all hardened `ExecutePromptNormalizationUseCase` believing it was the wired normaliser. **It had zero production construction sites.** The entire engagement rested on a false premise; one grep would have reframed it.

| PR   | the phantom surface                                                                                                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #487 | The governance analyzer read `layers.domain.adapters` — **zero of 34** context files use that path. `adapterCount` was permanently 0 and a shadow rule fired on 21 of 21 port-bearing contexts, unsilenceable. A sibling rule read `dependencies` where every manifest writes `depends_on` — it _"could never have fired on any manifest ever written."_ |
| #453 | `proposePR` POSTed to `/api/gitops/propose-pr` — a route that never existed, with zero consumers                                                                                                                                                                                                                                                         |
| #451 | A fictional auth hexagon: 3 use cases, 3 inbound ports, 2 driven ports, validated as "live" with zero adapters and zero consumers                                                                                                                                                                                                                        |
| #488 | Six dead validators with no caller since April. _"Their existence is what made reviewers and bots believe an enforcement mechanism was in place."_                                                                                                                                                                                                       |
| #483 | A security scanner unreachable through its own barrel — _"a fake security control, which is worse than none because it invites reliance"_                                                                                                                                                                                                                |
| #586 | `useRovingTabIndex` was inert through three independent defects. DESIGN.md advertised it and told authors to compose it; _"following that advice yielded silent no-ops."_                                                                                                                                                                                |
| #564 | Three live contract defects in an already-shipped scan path, found only when planning the next arc: the CLI emitted no JSON, `reportMarkdown` was always null, and the handoff zip was never built                                                                                                                                                       |
| #626 | `LayoutRatifyView`, `FindingsReviewView`, `ReportView`, `ManifestRatify`, `GateInstall` — five complete, tested slices imported by **nothing**                                                                                                                                                                                                           |
| #626 | `ProjectScanResponse.findings` has no producer anywhere; the CLI emits it and the adapter drops it                                                                                                                                                                                                                                                       |
| #603 | `KINDS` was hand-listed — the one non-compile-checked exhaustive site — so adding a kind compiled cleanly while silently dropping it from `snapshot()`                                                                                                                                                                                                   |

**Practice:** step zero of any "harden X" task is `rg "new X"` from a live route. _Compiles-and-tests-green_ says nothing about _wired-live_. Verify your own claims at the same depth — the rewire-scope doc verified construction sites but not method names, and review caught `onStageStart` never existed.

### 3.2 Parser and scanner blind spots inside guards

A named do-flag category after ~15 recurrences. A guard blind to one syntactic form is a guard that passes over exactly the form the defect takes.

| PR   | blind spot                                                                                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #458 | Domain-layer guard collected `ImportDeclaration`/`ExportDeclaration` only — blind to type-position imports, _"exactly the erased-at-runtime shape HEX-038 was"_                                |
| #479 | `globalThis` was an open doorway; unreadable dynamic-import specifiers silently skipped                                                                                                        |
| #490 | Specifier regex blind to backtick imports. _"The repo had already made this move twice before for the same reason."_                                                                           |
| #501 | A namespace import made a misfiled port invisible; a constructor scan stopped at the first `)`                                                                                                 |
| #519 | Four blind spots in the prop-brand gate, each printing "28 scanned" and a green tick                                                                                                           |
| #525 | The import fence blocked static, re-export and type-only forms but allowed all three dynamic ones — _"one `await import` defeated it"_                                                         |
| #461 | Four widenings of the no-Jest guard: scoped adapters, path invocation, the `"jest"` package.json key, unspaced shell operators                                                                 |
| #580 | A whole-string pre-filter with a narrower charset than the detector — `'w-[85%] text-[13px]'` reported nothing. Fix: remove the pre-filter, tokenize.                                          |
| #579 | Check 3 never required a declaration, so `<input type="radio" data-testid="probe" />` failed CI                                                                                                |
| #573 | Check 3 was line-scoped; the dominant multi-line `interface P { status: string }` sailed through                                                                                               |
| #617 | The spacing rule's variant regex consumed neither `group-hover/item:` (no `/`) nor `[&>[data-active]+span]:` (nested brackets) — both silently skipped. Replaced with a bracket-depth scanner. |
| #617 | PR-Agent found a leading `!` before a variant (`!hover:mt-0.5`) silently skipped — a false negative that would have defeated the `error` gate                                                  |
| #624 | Both Tailwind rules visited `Literal` only; 24 violations lived inside template literals. `String.raw` returns raw text while the AST exposes cooked — tagged templates skipped entirely.      |
| #616 | The tool-declaration guard read `failed=$(gh …)` as an assignment and took the _next_ token, `api`, as the binary; then read `;` and `\|\|` inside a _comment_ as shell operators              |

**Practice:** when a guard is fixed for one syntactic form, enumerate the others before closing. Deletion-proof guidance (#559): _"named, default, namespace, type-only, and re-export references; dynamic and template-literal references; empty scanned population must fail before typecheck; unresolved dynamic references treated as inconclusive, not zero."_

### 3.3 Cross-slice import debt

| PR       | instance                                                                                                                                                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #462     | Check 6 took the first `../<segment>` as the slice — `../../app/lib/wire` yielded `..` and always matched: _"62 false positives against a real count of 3."_ Then: it only ever read relative specifiers, reporting "0 violations, PASSED" while 15 alias-form imports sat in the tree. |
| #473     | `no-feature-slice-imports` returned early on any non-relative specifier — _"an error-level rule had never inspected an `@/` import while apps/web writes ~206 of them."_                                                                                                                |
| #590     | Promoting a component into `apps/web/components/` silently **dropped its lint coverage**. _"Three promotions made the same trade, each disclosing it, before anyone closed it."_                                                                                                        |
| #602     | Forced scope expansion, proven by attempting it: moving a hook alone made a neutral home import a feature slice                                                                                                                                                                         |
| #613     | Two stale `eslint-disable-next-line hexagen-ui/no-feature-slice-imports` directives. Harmless today; _"suppresses whatever moves onto the next line later."_                                                                                                                            |
| ADR-0055 | Cross-slice imports are debt, not composition. No "shared config" exemption. Remedy is extraction to a neutral home. Baseline burned 9 → 0 across #463/#464/#467/#552.                                                                                                                  |

### 3.4 Manifest and registry drift

| PR   | instance                                                                                                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #488 | _"The repo asserted a rule it does not follow and cannot check."_ 96 ports declared against 142 on disk, 56 adapters against 118; `lint:arch` never read the layers block. → ADR-0057: a curated ownership registry, accuracy not completeness. |
| #523 | _"Names had been resolved for existence but not for direction"_ — a port registered inbound while an infrastructure adapter implements it                                                                                                       |
| #508 | `packages/ui/.architecture/manifest.yaml` was an 806-line copy of the whole-repo manifest, swept in by a sync run rooted in the wrong directory — and the linter's `findProjectRoot` walked up into it                                          |
| #609 | `external-integration/context.yaml` drifted in the very next PR after #608 added a port. Nothing in the build read the file.                                                                                                                    |
| #621 | The accuracy check ADR-0057 said "is held by review" now exists. Ports/adapters: 150/150 clean. Sibling lists: 20 real drift entries. The policy had been decided two weeks earlier; the brief framed it as open.                               |
| #621 | `runtime` carries `type: shared-kernel` (universal import rights) while living in `contexts/infrastructure/`; `core-domain` in `contexts/shared-kernel/` carries `type: core`. Inverted against both layout and `planes:`. Open policy call.    |

### 3.5 Sanitise versus reject

A lesson the repository learned at least six times: **sanitising creates collisions and hides intent; rejecting preserves injectivity.**

| PR   | instance                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #593 | `safeSegment` stripped `.`: `scan.1` → `scan1.zip` collides with `scan1`. _"Fixed by REJECTING rather than sanitising. Sanitising is what caused the collision."_ |
| #576 | An allow-list of `[A-Za-z0-9._-]` passed `..` — made only of allowed characters. Dot segments must be rejected by name.                                           |
| #598 | _"Rejected BY SEGMENT, not by stripping — stripping would turn `../src` into `src`, a different directory the user never chose."_                                 |
| #476 | Normalising a trailing separator _"would have converted a throw into a successful write to a neighbouring path"_                                                  |
| #507 | Reserved is a closed set of names, not a prefix: _"an open-ended skip list where any directory opts out of every check by naming itself"_                         |
| #507 | `collectFiles` read through symlinks while the budget guard `lstat`'d the link — size limits bypassable with one `ln -s`                                          |

### 3.6 Silent drops at the load perimeter, and the two correct opposite policies

The same structural question — _what to do with damaged input_ — has two correct answers depending on what is at stake, and the repository records both.

**Salvage, never delete** (user's only copy): #404/#414, _"metadata damage never deletes the user's only copy of a session"_ — field-level salvage, drop only on unusable content.

**Discard, never salvage** (derived conformance artifacts): #589/#593, _"a partially migrated `layoutDraft` is structurally valid and semantically wrong… Losing a draft costs one re-entry and is visible; mis-applying one is invisible and gets committed."_

The defect is applying either policy where the other belongs. #407: LLM-derived names flowed _verbatim_ into rendered YAML that a strict schema then rejected at the last click — _"bricked the whole run… with no trace in prod logs."_ #491: a field-by-field merge silently lost eight top-level keys; the plan had named four.

---

## 4. Defect classes in runtime and deployment

### 4.1 Runtime/build divergence

Things present in dev and absent in the artifact. Every gate reads source; none could see these.

| PR   | instance                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #615 | The `hexagen` CLIs were absent from the image: `@hexagen/sync` is in `transpilePackages` (library exports inlined), but the CLI is _spawned_, never imported, so the tracer kept nothing            |
| #615 | `outputFileTracingIncludes` globs resolve against the **app dir**, not `outputFileTracingRoot`, despite sitting beside it in config. Root-relative globs matched nothing and were silently dropped. |
| #616 | Next's tracer copies files, not Yarn's workspace symlinks — the linter landed at `tools/arch-linter`, a path the resolver never consults                                                            |
| #616 | The image had no `.architecture/manifest.yaml` at all; `findMonorepoRoot()` threw before any binary lookup. The scan path never read the manifest — _"a required file that nothing required."_      |
| #616 | `docker exec` on the live container settled in one command what three rounds of local reasoning had not                                                                                             |
| #486 | `publish.yml` published to npm with **no test step**, and a `v*` tag triggered no test workflow                                                                                                     |
| #457 | Both packages advertised `engines.node: ">=20"` while _"no CI leg has ever run Node 20"_                                                                                                            |
| #481 | Thirteen template adapters would have failed `tsc` in every generated project; _"template sources are emitted, never compiled here"_                                                                |

**Practice:** a CI job that builds the standalone artifact and runs a real scan out of it (#616). It caught, on its first run, that `tools/arch-linter` was never built in a clean checkout. Verify in the place the code runs.

### 4.2 Streaming, reconnect, and double-charge

| PR   | instance                                                                                                                                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #440 | A module-level singleton cached instances wired with per-request abort signals and streaming callbacks — later requests got _"an already-fired abort signal plus stream callbacks pointing at a closed response"_                                                                                           |
| #602 | _"reconnect re-POSTs the same body with no run id or cursor, so a network blip can charge a user twice for one generation"_ — recorded for Wave D, not fixed                                                                                                                                                |
| #614 | BF-5.3 deliberately did **not** reuse `useStagedGenerationStream` despite it being promoted to unblock that packet: re-POSTing here spends a second daily quota and starts a second `git clone`. Shape copied; reconnect refused. Qodo independently evaluated the alternative and recommended the refusal. |
| #603 | Four explicit anti-double-charge mechanisms: `precheck()` peeks without counting; `charge()` memoised; charge after all cheap validation; one shared budget. Flagged: no refund API when the CLI fails after the credit is spent.                                                                           |
| #443 | Every header-less anonymous caller collapsed into one bucket, so one caller could exhaust the window for all                                                                                                                                                                                                |
| #525 | An HTTP-error response racing a discard _"stranded the dead session in the error phase"_                                                                                                                                                                                                                    |

### 4.3 GitHub token scope surfaces as 404, not 403

A complete four-PR arc (#413 → #431 → #435 → #436, ADR-0046). `POST /git/trees` returns **404** when the tree contains `.github/workflows/*` and the token lacks `workflow` scope. Every yarn-project publish had failed since #330. A scope problem that looks like a not-found. The same 404 class blocked a delegated agent from pushing workflow changes in #622.

### 4.4 React lifecycle

| PR   | instance                                                                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #424 | Passive effect → `useLayoutEffect` (the form.watch case in §1.5)                                                                                                                                                        |
| #422 | `FileReader.onload` fires after render; spreading the render-time draft resurrected a stale snapshot. Contract moved to `Dispatch<SetStateAction<T>>`.                                                                  |
| #423 | `router.replace("/projects/new/ai")` stripped `?name=` mid-mount — three separate legs, three commits                                                                                                                   |
| #522 | A `useMemo` after an early return: _"The failure-reporting path was itself crashing."_                                                                                                                                  |
| #598 | Two packets correct alone and broken together — _"the seam only exists once both are on main"_                                                                                                                          |
| #586 | A fresh ref-callback closure per render: 2N detach/attach cycles per keystroke                                                                                                                                          |
| #619 | `markNotEnabled` was one-way in its public API but not in effect: the probe's `cancelled` flag guards _unmount_, not a state transition. A late GET could overwrite `not-enabled` with `available`. Latched with a ref. |

---

## 5. Doctrine the ADRs established, and the mistake each corrects

Seventy ADRs, read in full. Most exist because something was done wrong first, and the value is in the _wrong thing_, not the rule. Grouped by theme; the bracket is where to read the reasoning.

### 5.1 Build toolchain and module resolution

- **Every package tsconfig sets `"paths": {}`** [ADR-0004]. The mistake: builds passed locally because `dist/` existed, and failed in CI because `tsconfig.base.json` `paths` resolved `@hexagen/shared` to _another package's source_, violating `rootDir`. Every cross-package import needs an explicit `package.json` dependency.
- **Bundle the CLI with tsup; keep source at `moduleResolution: bundler`** [ADR-0009b]. The proposed alternative was a monorepo-wide NodeNext migration — _~900 files, 28 packages_ — to publish one CLI. _"Approach 1 optimizes for a consistency impulse over deployment reality."_ ADR-0050's amendment later withdrew its own Decision 4 to confirm this: NodeNext lives only in three documented exceptions.
- **`/server` and `/client` subpaths are a convention, not a one-off** [ADR-0037, superseding ADR-0035]. The mistake: server code importing a value from `@hexagen/local-llm` dragged `WebLLMAdapter` into the SSR bundle. **`server.ts` must not re-export the client barrel** — the merged `.d.ts` would make the boundary _"a naming convention rather than an enforced contract."_ _"The pain of a compile error is preferable to silent SSR contamination."_
- **Guard browser storage with `try/catch`, never `typeof localStorage`** [ADR-0036]. In Node 22 the global _exists but throws on read_, and the `SecurityError`'s getter-only `message` produced a secondary `TypeError` that hid the real one.
- **Vitest is the runner; the "never Vitest" rule was a misapplied memory** [ADR-0044]. _"No ADR ever banned it. ADR-0000 was about the bundler; ADR-0009 cites Vitest approvingly."_ The migration was a runner swap, not an assertion rewrite — ~8,900 `assert.*` calls retained.
- **`engines.node` aligns with the toolchain floor** [ADR-0052]. Published `>=20` while no CI leg ever ran Node 20 — _"a published contract that is a fiction."_ If a Node-20 consumer appears, the floor change and the 20.x CI leg land together, _"never one without the other."_

### 5.2 Sync engine and generator safety

- **Dry-run must never mutate the filesystem** [ADR-0002]. The reaper deleted files under `--dry-run`. Also: preflight failed _silently_ on stdout overflow (Turbo output exceeded Node's 1 MB default); `--force` could clobber `turbo.json`. `ensureRootFiles()` removed entirely — _"user-controlled files the sync engine should never generate."_
- **One barrel walker** [ADR-0007]. A second generator was introduced _accidentally_ in commit `c2048e8` when a `src/` prefix was dropped, creating 81 package-root barrels outside the compilation boundary. Traced by git archaeology to a three-week-old intermittent failure. _"The fix demonstrates the value of deleting redundant systems rather than patching them."_
- **The manifest is authoritative; generators read templates, never embed them** [ADR-0024]. `generator.sync.layers` was read but never declared; `workspaceDefaults.tsConfig` declared but never read. The inflection: commit `b2b8c6c` fixed a real TS6305 by _removing all tsconfig references_ instead of deriving them from `depends_on`.
- **Barrels regenerate last, in a second pass** [ADR-0025]. Two independent "generate a monorepo" implementations; barrels emitted before stubs existed, so generated projects needed a post-extract `yarn sync`.
- **`--force` never overwrites hand-written files; `--force-root` is the explicit escape** [ADR-0026]. The most instructive failure in the record: immediately after ADR-0025, `yarn sync --force` overwrote hand-written files and broke CI four ways. Protection existed but was gated on `!force`. **The primary fix was removing `!force &&` from one line.** _"The bug had always been present; the expanded generator surface made it load-bearing."_
- **Only a bare `{identifier}` is a template placeholder; `$`-prefixed text passes through** [ADR-0039]. `${{ secrets.GITHUB_TOKEN }}` collapsed to `${ secrets.… }` and _shipped broken in the merged docker template_. A regex lookbehind was deliberately avoided — parse-time `SyntaxError` on Safari < 16.4, and the module ships to the browser.
- **`layers.*` lists are a curated ownership registry — accuracy, not completeness** [ADR-0057]. 33% of port files and 57% of adapter files named no entry. The deleted validator directory, simulated against the tree it emitted, produced _"231 errors and 156 warnings with a 100% false-positive rate"_ and had never acquired a caller. _"Their continued existence is precisely what makes reviewers and bots believe an enforcement mechanism exists."_ **Never delete a file because it is unlisted; never add an entry merely because a file was created.**

### 5.3 Barrels and the published surface

- **Retire `export {}` empty barrels** [ADR-0050, superseding ADR-0007]. Discovered that AGENTS.md rule 7 and ADR-0007 _directly contradicted each other_ — ADR-0007 had explicitly decided `export {};` for empty dirs. Deletion predicate is **"frozen AND no runtime code"**, never "frozen" alone: `transaction-system` is frozen with 38 source files and is retained.
- **The binary is the contract; the root barrel is provisional under 0.x** [ADR-0056]. Four checks inverted a request for a `/testing` subpath: generated projects never import the package; _"exactly one import of the published name exists in the whole repo"_ — a README — _"and that import is of `runSync`, a function that has never existed."_ Rules: a removal rides a minor, never a patch; **each removed name is listed individually in the changelog** — _"'Trimmed the public barrel' is not a changelog entry; the names are."_ Enforced by a _static_ ts-morph snapshot, because a runtime `import *` erases every type-only export.

### 5.4 Ports, adapters, and the shared kernel

- **Delete dead port copies; never cross-import to "de-duplicate"** [ADR-0047]. Corrected a review's own numbers: "166 names, 7 homonyms" was 159 and 4 — the extra three were generated template duplicates. The refuted alternative is _recorded as refuted_ "so the deletion is not later 'corrected' back into a cross-context import."
- **If an infrastructure adapter `implements` it, it is outbound and belongs in `ports/out`** [ADR-0048]. The convention was attributed to `workspace.config.yaml`, which never defined it — _"it lives only in developer habit."_ Five packages had driven ports under `ports/in`, with doc comments saying "Infrastructure adapters implement this contract." ADR-0010's sketch had drifted from 4 ports/8 use cases to 9/26, with `deps` typed on 26 concrete classes.
- **Ports never import `infrastructure/`, type-only or otherwise** [ADR-0053]. Fourteen port files did, and the template _self-justified it in a comment_: "types a port's failure channel without runtime coupling." **"The reasoning in that comment is the bug."** Type-only erasure removes the runtime edge, not the compile-time dependency. _"The self-justifying comment is removed, not preserved — leaving it would re-teach the anti-pattern."_ The linter could not see it: any `.`-prefixed specifier was "relative, allowed."
- **Identities in domain, routing facts in infrastructure, chains composed at the root** [ADR-0051]. Vendor `baseUrl` was hardcoded in `domain/`. Corrected a review finding: an env-derived chain in the composition root _is the root doing its job_; the "duplicate" was factually wrong (`gpt-4o` vs `gpt-4o-mini`).
- **Drivers implement ports; they never own them** [ADR-0009a]. A suspected bidirectional smell was _accepted_ as correct hexagonal shape.
- **Shared-kernel lift is the exception, for context-agnostic operations only** [ADR-0047 §3, ADR-0005]. `type: shared-kernel` is self-asserted; a misspelled type fails closed [ADR-0043]. Which is why `runtime` carrying it matters (#621).

### 5.5 Dead code: three deliberately non-overlapping deletion predicates

| ADR  | predicate                                                        | example                                        |
| ---- | ---------------------------------------------------------------- | ---------------------------------------------- |
| 0049 | unregistered + zero consumers + scaffold-grade                   | `@hexagen/security`                            |
| 0050 | frozen **and** no runtime code                                   | `architectural-enforcement`, `code-generation` |
| 0058 | active, registered, zero live consumers, no other ADR retains it | `@hexagen/intent-compiler`                     |

- ADR-0049's amendment found two things only at deletion time: **the scanner was unreachable through its own barrel**, and **its tests were type-invalid fictions** — `{ ok, value }` where `Result` is `{ success, value }`, passing _"only because mock and assertion shared the same wrong shape,"_ never type-checked because `include: ["src/**/*"]`. _"A gate reporting more confidence than it had earned."_ Core rule: **a hexagonal package is either a registered, wired context or it is not created.**
- ADR-0058 refuses to be a one-off: _"A future sweep must not treat 'unconsumed' as sufficient on its own — the retaining-ADR carve-out is load-bearing."_ Enumerates every graph declaration that must go in the same change, lockfile _"via `yarn install`, never a hand edit."_
- ADR-0031 discarded a **270-file mega-PR**: barrels referencing five domain modules that were never created, zero tests vs ~351 in the phased replacement.
- ADR-0042 deleted `tandem-execution` entirely rather than flag-gating it — _"a flag preserves all of it for a mode with no quality argument"_ — and notes it is now the only discoverable record of why no tandem context exists.

### 5.6 Enforcement: make the fence real before fixing what it guards

- **The linter derives cross-context legality from `depends_on`** [ADR-0043]. Before: success messages claimed compliance with the manifest while legality was decided _exclusively_ by `linter-config.yaml`; _"the one the tooling tells users to maintain is the one that does nothing."_ Empirically verified: editing three contexts' `depends_on` changed nothing.
- **CI enforces on a ratchet, not strict-from-zero** [ADR-0054]. Three grounded failures: the "verify" step ran `--dry-run` and verified nothing; the layer engine was blind to relative cross-layer imports, `node:` builtins and npm packages; **no CI job ran any firewall layer** while the script self-described as a "merge gate." Doctrine: _"fixing boundaries before fixing the fence guarantees regression."_ Acceptance is the **irony check** — the fixed linter must report violations against the host.
  - Amendment: the baseline is not a neutral hold — keyed on `rule|file|specifier`, it _"goes stale the moment a file moves."_ Rule coined: **"allowlist a parser, delete a re-validator."** Type-only imports explicitly **not** exempted: _"erasure removes the runtime edge, not the dependency."_
- **Cross-slice imports are debt; extraction to a neutral home, never an exemption** [ADR-0055]. The rule _"has never seen an `@/` import"_ — early-returned on any non-relative specifier while `apps/web` wrote ~206 of them. The rule **caused duplication rather than preventing coupling**: a hand-synced fork with a "keep in sync" JSDoc, and _"the next author routed around the blind spot in writing."_ Sequencing: extractions first, rule fix last, _"so the fix is a forcing function, not a wall of build failures with nowhere to go."_
- **Three-layer information-state firewall** [ADR-0018]: branded types, ESLint, CI script. Forbidden prop names. _"No spec-only or code-only changes to MVK contracts."_

### 5.7 LLM pipeline and anti-corruption

- **Any `setState` updater must be pure** [ADR-0016]. `"The The architecture architecture is is clean clean"` — React Strict Mode double-invokes updaters, and one mutated `last.content` on a shared reference. Also: the MLC model ID was not a real identifier; token stutter is model-specific — _"swap the model, don't parameter-search."_
- **MLC IDs exist only inside the adapter** [ADR-0017]. Two general hazards: React `onClick={fn}` passes the event as the first argument — `"Unknown model ID: [object Object]"` — **always wrap in an arrow**; and _"`clearError` is not a retry."_
- **The ACL accepts only `(prompt, schema)`; LLM never overrides the deterministic kernel** [ADR-0021, ADR-0018]. Hard-fail on schema drift. Monotonic state promotion, never backwards.
- **Server LLM routes read the key from env, never the request body** [ADR-0022]. The cloud chat route was _"an unauthenticated LLM proxy instantiating an adapter with an API key from the request body."_
- **BYOK: AAD binds to the NextAuth `sub`, not email; key rotates on every decrypt** [ADR-0030].
- **Cloud-first; falling back is honest** [ADR-0042]. A 7-context import took ~5 minutes vs ~16.5s server-side — `auto` silently ran a loaded WebLLM model then fell back. _"A 20× latency penalty from an architecture-level routing decision invisibly."_
- **Explicit `maxTokens` plus a visible truncation notice on `finishReason === "length"`** [ADR-0045]. The adapter default of 2048 silently truncated summaries (#414).
- **Train the fixer, not the generator; synthesise the corpus, never persist prompts** [ADR-0067]. Four shipped strings promise the source is not retained.
- ADR-0010b records that the description max-length change _"was made without documentation"_ — an ADR written retroactively.

### 5.8 State, transactions, persistence

- **Two-phase modification: stream, then accept/reject** [ADR-0028]. Before: patch generation and mutation were atomic, and on lint failure _"the transaction state was left inconsistent."_
- **Emit event → await purge → only then reset UI** [ADR-0029]. Three production defects: drafts surviving discard, thread state destroyed by a tab switch, an infinite loader with no timeout and swallowed rejections. **Amendment:** the subscriber-driven cleanup this ADR specified _caused a double purge_. _"Do not reintroduce a purging subscriber."_
- **Read-merge-write `updateProjectRecord`, never whole-array snapshots** [ADR-0045]. IndexedDB holds one key for the whole array; `useSavedProjects` is per-mount with no shared store, so _"a stale-instance write silently reverts fields written elsewhere (this already bit `githubLink.lastCommitSha`)."_ A durable key was rejected because it _"leaked stale specs onto unrelated projects."_ `deleteProjectRecord` made idempotent so an optimistic revert cannot resurrect a deleted row.
- **Salvage at the load perimeter; never delete the user's only copy** [ADR-0045, ADR-0015]. Partial restore: one corrupt entry does not reject the workspace. Contrast §3.6.
- ADR-0015 records a _deliberately unfixed_ bug — `saveSession` and `loadLatestSession` key on different ids — left because it has zero production consumers. ADR-0032 keeps `ManifestPatchPort` as an unused design artifact, named as such.

### 5.9 Testing policy

- **No wall-clock assertions** [ADR-0033]. 108+ timing patterns across 70+ tests. Fake timers only when the test name says SLA/latency/throughput. Compliance: `--repeat 3` plus a 100-run stress loop.
- **`mock.module()` is blocked; the escape is a container/presentational split** [ADR-0038]. _"Test files exist and pass lint, but cannot execute."_
- **Every catch returns `Result<T,E>`; never `null`, `false`, or a default** [TESTING.md]. Measured exception in #619: 1 of 90 catches in `apps/web/features` complies; a React hook mapping failure to a documented state was refuted as the outlier.
- **Never delete or skip a test to make a suite pass; delete a test that passes for the wrong reason** [ORCHESTRATOR.md, REVIEW.md]. _"A green line that looks like coverage is worse than an absent one."_ Zero PRs in #400–#626 add a skip to get green.
- **Restore from a `cp` copy and prove with `diff`, never `git checkout`** [REVIEW.md] — _"that reverts uncommitted work alongside the probe."_
- **A `pull_request` check does not re-fire when the base branch moves** — _"read the run's SHA, not just its colour."_

### 5.10 UI and product surface

- **One canonical token dialect; delete the dead preset** [ADR-0023]. The app rendered _"almost entirely unstyled"_ from three independent pre-existing defects, including a preset never imported referencing variables never loaded.
- **Every user-facing step has a URL; modals are deleted, not repurposed** [ADR-0034]. Its amendment is a model of honest record-keeping: the original section is _"left unedited because it is an accurate record of 2026-05-07 and of why the duplication existed."_
- **A bounded context is a domain boundary, not a deployable** [ADR-0041]. _"The defect is presentation, not derivation."_ Divergence surfaces as a dismissible inline notice, _"not merely a dev-console log, which is invisible to the non-developer."_

### 5.11 Publishing, GitHub, and error contracts

- **Degrade with warnings on the `workflow`-scope 404; editor-push hard-fails** [ADR-0046]. _"Every OAuth scaffold publish of a yarn-default project had been broken since #330 deployed."_ The fail-open probe and the reactive 404 backstop **protect each other and must not be removed independently** — both carry comments naming the pairing. No user-facing error string may contain a parenthesised HTTP status — the route remaps `/\((401|403)\)/` to `reauth_required`.
- **Tokens mint only on sign-in; the session callback never exposes them** [ADR-0046].
- **Git Database API, one atomic commit; token and owner injected server-side** [ADR-0013].

### 5.12 Quota, deployment, licensing

- **Leave metering as-is; the double-charge stays; OAuth is publish-authorisation, not an entitlement** [ADR-0063]. _"This decision almost flipped twice because it lived only in a planning doc"_ — two runbook drafts reversed it in opposite directions. Ships a literal do-not-touch list of eight files.
- **Single-container topology** [ADR-0064, ADR-0065]. A k8s manifest declaring `replicas: 2` against single-process better-sqlite3: _"Free-tier quotas double and reset per-pod. Revoked BYOK keys silently un-revoke."_ — but see §9 for the contradiction between these two.
- **D-3 decides the motion, D-1 implements it** [ADR-0060]. Choosing the license first would invert the dependency.
- **Three-layer fair source; new packages default proprietary** [ADR-0061]. _"Never transitions to open source" appears only in README.md; it is not a term of LICENSE._ Budget legal review into the trial, not after the first yes.
- **The README claimed an "automated brownfield ingestion engine." Nothing of that kind existed** [ADR-0062].
- **Parking implementation does not park enforcement** [ADR-0059].

## 6. Misreads

Places where a person or a bot read the evidence wrong. Distinct from bugs: these are errors of interpretation, and several were by the author of this document.

### 6.1 By the author

| where                  | the misread                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-P1                   | Claimed option A (move the workspace) was sufficient. It was one of three gaps, and the third — no manifest in the image — had not been found at all. The symptom quoted to the user was a _local_ artifact. |
| #620                   | Justified a timeout with `parallel_calls` — verified against the pinned image but never pinned in our config. A default is not a guarantee.                                                                  |
| #622                   | Set two mutually exclusive reasoning keys. Every review for the next several hours failed in ~2s and went green.                                                                                             |
| #625                   | Wrote the guard for "exit 0 on failure" with three defects that meant it could never fail. Reviewed, not run.                                                                                                |
| #626                   | "The loop loses later violations." It does not — the outer `while` re-parses. The worker corrected the brief.                                                                                                |
| #626                   | Filed `SCAN_COMPLETE` as a deferred cleanup. It was five unrouted screens.                                                                                                                                   |
| #626                   | Invented `renderPage()` / `ingestArtifacts()` helpers that do not exist in the test file.                                                                                                                    |
| #621                   | Briefed the context.yaml policy as an open decision. ADR-0057 had decided it two weeks earlier.                                                                                                              |
| #618                   | Briefed that the `summary` column was displayed in run history. It is rendered nowhere.                                                                                                                      |
| #616                   | Declined a rollback-failure test as "too fragile." The file already injects its fs boundaries for exactly that purpose.                                                                                      |
| #611                   | Placed the sparkline in `components/` when the plan's component table said `components/primitives/` — the only location inside the information-state gate. (Self-caught.)                                    |
| mutation testing, #423 | `git checkout -- <file>` to undo a mutant also reverted uncommitted review fixes in the same file                                                                                                            |
| #404, #405, #602       | `git add -A` and `git stash` swept in untracked WIP and, in #602, left _"three orphaned additions and nothing else"_                                                                                         |
| June 2026              | Four reviews and a hotfix hardened an unwired normaliser — the origin of `verify_codepath_live`                                                                                                              |

### 6.2 By reviewers — diagnosis right, remedy wrong

Codified as its own severity tier in #503: _"REVIEW.md was good at verifying whether a bot's claim is true. It did not cover what to do when the claim is true and the proposed fix is wrong — which happened three times this arc, each converting a loud failure into a quiet one."_

| PR   | the wrong remedy                                                                                                                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #491 | _"The suggested `every()` fix would have been the change that caused real loss — it returns hollow pointer stubs, silently green"_                                                                                                                 |
| #487 | Routing the guard through the production loader would ask whether the _schema allows_ a key, not whether a _real file provides_ it — _"the exact substitution that let the original defect ship"_                                                  |
| #498 | A proposed fallback _"would have silently rewritten a valid `generic` context to `supporting` before it reached the model"_                                                                                                                        |
| #595 | Mirroring the server's `isZipFile` on the client _"would send a single manifest.yaml as a zip — a regression on the common path to fix a rare one"_                                                                                                |
| #445 | CodeRabbit's `^5.0.0 \|\| ^6.0.0` and Qodo's `^5` cases were both right and both wrong in opposite directions. Replaced with `highestMajor()` checked over 34 range shapes.                                                                        |
| #623 | PR-Agent: `max_model_tokens` exceeds the completion cap — a **category error** (it caps the prompt). But the underlying risk was real; 96000 + 50000 overflowed 128000. Its 48000 would have reintroduced diff-pruning. The arithmetic gave 70000. |
| #615 | Qodo: trace the linter into `node_modules/@hexagen/arch-linter`. Cannot work — the resolver walks up from the _scanned repo's_ tmpdir and never reaches `/app`.                                                                                    |
| #586 | Focus relocated only when it sits on the item that became unfocusable. _"Moving focus that lives elsewhere would be an unprompted focus steal — a worse defect than the one being fixed."_                                                         |

### 6.3 By reviewers — refuted with measurement

The repository refutes rather than complies, and records the evidence. A sample:

| PR                    | refutation                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #478                  | _"The validator it assumes is path-broken, reads only `ports.in`, has had no caller since April, and checks declared-to-file rather than the reverse"_ |
| #576                  | `new Uint8Array(zipped.value)` is load-bearing — _"`NextResponse`'s `BodyInit` does not accept Buffer (TS2345)"_                                       |
| #511                  | The table padding a reviewer wanted changed is Prettier's — _"the proposed state is unreachable"_                                                      |
| #525                  | A dynamic-import rule inside `no-restricted-imports` is impossible — _"that rule has no visitor reaching `ImportExpression`"_                          |
| #619                  | "Return a `Result` from this catch": **1 of 90** catch blocks in `apps/web/features` does; adopting it makes the hook the outlier                      |
| #621                  | Single-context ownership: ADR-0057 asks for it, but **150 declared, 0 duplicated** — cross-context state for a class with no instances                 |
| #227, #411, #617 (×3) | `node:assert/strict` style: 598 files of precedent; the bot's own relevance block rated it weak while citing the PR where it was rejected              |
| #589                  | A self-refutation of a refutation: _"My first probe was too shallow and reported this as refuted."_                                                    |

**The doctrine, from memory `verify_sdk_imports_against_repo_usage`:** verify a bot's SDK-path flag against _the repo's own working usage_, not external docs — web-sourced findings are version-ambiguous. The mcp-server v1 subpaths were flagged against v2 docs.

### 6.4 Bot behaviour, measured

- PR-Agent ticket-compliance: **3/3 correlation** between `#NNN` in a body and false "non-compliant requirement" blocks. Turned off (#600).
- PR-Agent diff pruning: #598 reviewed 3 of 6 files and the pruned set _"included the one file carrying a crash"_; reported "no major issues." Root cause `custom_model_max_tokens` (#600).
- PR-Agent concurrency: every review cancelled ~10s in by a bot comment (#596), then by the author's own comment (#610), then `/review` doubled rather than superseded (#610 round 2). **A cancelled run reports red, not missing, so it read as flake for weeks.**
- PR-Agent `auto_review` never emits line-anchored suggestions — it was running the command that does not do code review (#616).
- PR-Agent exits 0 on "Failed to generate" (#625).
- CodeRabbit rate-limited reports `pass` (#503, and five PRs at once in #616–#626). _"A passing bot check is not evidence a review happened."_
- CodeRabbit "Addressed" auto-annotation wrong for 2 of 3 (#564). A thread marked resolved with no reply was never addressed (#504).
- The largest single source of review noise: _"bots faithfully enforcing an AGENTS.md rule the repo did not follow and could not check. The line was the defect."_ (#504, #488)
- Late-landing findings are the norm: _"pass 1 found 4, pass 2 found 7 more, pass 3 found 2 on a PR that had zero in pass 2"_ (runbook). Replies land _inside resolved threads_ (#616, twice).

---

## 7. Deterministic failures and their navigation

Failures that recur the same way every time, and the specific move that avoids each.

| failure                                                           | cause                                                                                       | navigation                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Test request 403s before the route                                | `new NextRequest(url)` sets no `Host`; the same-origin guard has nothing to compare         | set `Host` and `Origin`                                                                                          |
| Quota looks un-charged in a test                                  | `resolveAnonSession` validates an anchored UUID and mints a fresh session for anything else | UUID-shaped sids only                                                                                            |
| `typecheck:test` fails on `process.exitCode`                      | getter typed to include `null`, setter not                                                  | `?? undefined`                                                                                                   |
| `outputFileTracingIncludes` matches nothing                       | globs resolve against the app dir, not `outputFileTracingRoot`                              | `../../`-prefix; build and look                                                                                  |
| Subprocess dependency never built in CI                           | nothing imports it; no `^build` edge                                                        | declare it in `package.json`                                                                                     |
| Tool-declaration guard flags `"api"`                              | `failed=$(gh …)` matches the assignment pattern; next token read as the binary              | let the binary lead its own line                                                                                 |
| Tool-declaration guard flags `"and"`                              | `;` or `\|\|` inside a `#` comment in a `run:` block                                        | no shell operators in prose                                                                                      |
| `gh api` with `--raw-field`                                       | switches the request to POST                                                                | `--method GET`; never send params to a read                                                                      |
| jq `$var` undefined                                               | `--raw-field` is a request param, not a jq arg                                              | `jq --arg` on a stored response                                                                                  |
| Backticks in SQL comments inside a JS template literal            | terminates the JS string                                                                    | none inside template-literal DDL                                                                                 |
| ESM `ERR_MODULE_NOT_FOUND` on a relative import                   | no `.js` extension                                                                          | add it; the compiler will not warn                                                                               |
| Template-literal classNames invisible to Tailwind rules           | rules visit `Literal` only                                                                  | visit `TemplateElement`; drop interpolation-adjacent fragments                                                   |
| `String.raw` chunks misclassified                                 | AST exposes cooked, runtime gets raw                                                        | skip `TaggedTemplateExpression`                                                                                  |
| `indexOf` `-1` treated as "precedes an expression"                | `-1 < length-1` is true                                                                     | guard `-1`; classify nothing                                                                                     |
| Fixture uses a real option as "coming-soon"                       | shipping the feature breaks rendering tests                                                 | synthetic fixtures for state tests                                                                               |
| `findMonorepoRoot()` throws in the container                      | no manifest in standalone                                                                   | anchor on what the caller _needs_ (`workspaces`), not a file it never reads                                      |
| Stale `eslint-disable-next-line`                                  | suppresses whatever moves onto that line later                                              | delete when the rule no longer fires                                                                             |
| Raising a shrink-only pin                                         | indistinguishable from "raised to pass CI"                                                  | record the reason _in the script_; state the debt did not grow                                                   |
| Vitest silent in an AI shell                                      | agent-reporter auto-selection on `CLAUDECODE`/`AI_AGENT`                                    | `reporters` pinned in `vitest.shared.ts` (#514); `mergeConfig` concatenates arrays, so do not re-pin per package |
| `vi.unstubAllGlobals()` re-exposes Node's throwing `localStorage` | storage stubs installed with `vi.stubGlobal` are undoable                                   | stubs owned by setup, not the suite (#496)                                                                       |
| jsdom `<dialog>` subtree invisible to role queries                | incomplete a11y tree                                                                        | query raw DOM; polyfill `showModal`/`close`                                                                      |
| `apps/web` Vitest from repo root                                  | JSX transform config not applied                                                            | run from the `apps/web` cwd                                                                                      |
| Husky hook breaks on `read -d` / `< <(…)`                         | husky runs `sh -e`; dash lacks both                                                         | pin `shell: bash`, or avoid the constructs                                                                       |
| `yarn install --immutable` YN0028 after a bin retarget            | lockfile's mirrored `bin:` entry not regenerated                                            | re-run install; commit the lockfile                                                                              |
| Yarn public-PR TLS stall (YN0001)                                 | 60s default `httpTimeout`                                                                   | raise it (#543)                                                                                                  |
| Stacked PR auto-closed on base merge                              | `delete_branch_on_merge` + a PR based on the deleted branch cannot be reopened              | retarget dependents to `main` _before_ merging the base                                                          |
| Commit silently lost during a merge race                          | push during squash-merge recreates the head as an orphan                                    | `gh pr view --json mergeCommit,commits` after any push the user may merge imminently                             |
| `findWorkspaceRoot` walks up from the module's `__dirname`        | running repo `dist/cli.js` with a fixture cwd syncs **the repo**                            | contract tests copy dist under the fixture                                                                       |
| Dry-run never executes the linter                                 | `[DRY-RUN] would run arch-linter`                                                           | violations cannot fail a dry-run in any mode                                                                     |
| Off-scale spacing in `features/`                                  | no gate; `no-arbitrary-tailwind-values` catches brackets, not named steps                   | `no-off-scale-spacing` + `check-spacing-debt.mjs` (#617)                                                         |
| `mock.method()` on an ESM export                                  | `Cannot redefine property`                                                                  | container/presentational split; `vi.mock` with `importOriginal`                                                  |
| Hardcoded `0.11.0` assertions on a version bump                   | ~7 sites incl. `HEXAGEN_TOOLCHAIN_RANGE`                                                    | grep for the old version string before bumping                                                                   |
| Every new sync emitter needs gating                               | self-regen _and_ external modes                                                             | gate both; _"bit 3×"_                                                                                            |

---

## 8. Derived practice

Ordered by how much rework each would have saved.

1. **Mutation-test every guard.** Inject the fault, watch it fail, restore. The single highest-leverage habit in the repository's history.
2. **Verify in the place the code runs.** `docker exec` beat three rounds of reasoning. Local standalone ≠ container; dev ≠ artifact.
3. **Step zero is liveness.** `rg "new X"` from a live route before hardening X. Compiles-green says nothing about wired-live.
4. **Delegation briefs carry explicit write prohibitions**, stated as non-negotiable with the reason. A brief is not a permission boundary — an agent briefed to report merged two PRs and opened a third.
5. **Treat every delegated claim as unverified.** Prettier → typecheck → suite → gates, then the full suite. In that order.
6. **Brief the reason, invite the refusal.** Workers told _why_ refused bad premises (§2 of the arc doc); workers told only _what_ complied.
7. **"Could not check" is a failure, never a zero.**
8. **Assert non-empty before asserting clean.**
9. **Separate a reviewer's diagnosis from its remedy.** Take the line; verify the fix independently. A remedy that converts a loud failure into a quiet one is worse than the bug.
10. **Refute with measurements.** `1 of 90`, `150/150`, `598 files`, `3/3`. Never "I disagree."
11. **Verify bot SDK flags against the repo's own usage**, not external docs.
12. **Pin upstream behaviour your config depends on**, even when the default currently matches.
13. **A fast failure is a malformed request.** 2s against a 40s baseline is a rejection.
14. **Red bot checks are not flake until the log says so.** Grep for `canceled` first.
15. **Re-sweep after resolving; check timestamps, not thread counts.** Replies land inside resolved threads.
16. **When deleting config, grep its value in comments.**
17. **Format what you touched, not the file you touched.**
18. **Read the harness before writing a test.** Helpers are file-local.
19. **Grep for importers before calling something "deferred."**
20. **Reject, don't sanitise.** Sanitising creates collisions and hides intent.
21. **Exit codes: 0 / 1 / 2.** Found problems and could-not-run are different signals.
22. **Ratchets fail on stale entries.** A shrink-only baseline that only blocks growth rots into permission.
23. **Measure behaviour preservation; don't assert it.** Build before and after; byte-diff. _"95 files each, zero differences, with a legacy-vs-legacy run first to establish the comparison was deterministic at all."_ (#500)
24. **The mirror test for a port:** could a different implementation satisfy it? `access(absolutePath)` is `node:fs`'s own contract, not a port. (#470)
25. **Historical documents get dated amendments, never silent rewrites.** _"Rewriting a completed plan's text would falsify the record."_ (#454)
26. **Out-of-fence edits are flagged, not hidden.** _"The out-of-fence edit and the defect were the same mistake."_ (#571)
27. **State the honest outcome even when it is not shippable.** The routed flow refuses at S5/S6 because `findings` has no producer, and the PR body says so.
28. **No `git add -A`. No `git stash` mid-collection. No `git checkout --` on a file with uncommitted work.** Each has cost a commit.
29. **Check the branch before every commit.** The user merges and switches between turns.
30. **Never push a release tag without an explicit go-ahead.** It triggers a live npm co-publish.

---

## 9. What the record itself gets wrong

A learnings document that did not examine its own sources would be one more instance of §0. Everything below was verified against the tree on 2026-08-23, not taken from the ADR text.

### 9.1 Two live ADR-versus-ADR contradictions, neither citing the other

**Licensing — ADR-0061 vs ADR-0066.** _(Resolved 2026-08-23 by #627; recorded here as found.)_ ADR-0061 (Accepted) decided _"FSL the whole of `packages/sync`"_. ADR-0066 (Accepted) decided the opposite: the wedge is `tools/arch-linter` only, and _"`packages/sync` will remain proprietary."_ The tree matched ADR-0066 — `packages/sync/package.json` said `"license": "UNLICENSED"` — but ADR-0066 neither cited nor superseded ADR-0061, and ADR-0061 was still marked Accepted.

Worse, **`packages/sync/LICENSE` was self-contradicting text.** It was a byte-identical copy of the root evaluation license, and its own first paragraph read: _"The published wedge packages `@hexagen-monaco/sync` and `@hexagen-monaco/arch-linter` are licensed separately; see the LICENSE file in each package"_ — it pointed at itself as the separate wedge license while being the proprietary one. Every published sync tarball carried it, because `prepare-publish-package.js` copies the package-local file verbatim (and refuses to fall back to root — which is exactly _why_ the copy was made).

A secondary point the first draft of this catalogue got backwards: `tools/arch-linter/package.json` says `FSL-1.1-ALv2` while ADR-0061 and the LICENSE text say `FSL-1.1-Apache-2.0`. The draft listed this as a discrepancy to fix toward the ADR. It is the opposite — **`FSL-1.1-ALv2` is the SPDX identifier and `FSL-1.1-Apache-2.0` is merely the licence text's own abbreviation.** The reconciliation PR briefly "corrected" the field to the non-SPDX string; `prepare-publish-license.test.ts` caught it. The README and both preambles now name both forms so the next reader does not repeat it. Lesson: a test that pins a string you believe is wrong is a prompt to check the authority, not to edit the test.

**Deploy topology — ADR-0064 vs ADR-0065.** ADR-0064 (Accepted): _"Do not delete the k8s manifests. Fix them"_ — replicas 1, PVC, `Recreate`, `fsGroup: 1001`. ADR-0065 (Accepted): _"We are removing the Kubernetes manifests."_ The tree matches ADR-0065 — there is no `k8s/` directory. ADR-0065 does not cite ADR-0064.

### 9.2 Structural defects in the ADR index

- **Two ADR numbers are duplicated.** `ADR-0009` (driver-context wiring; published CLI bundling) and `ADR-0010` (description max-length; MCP server architecture). Every citation to either is ambiguous. This document disambiguates as 0009a/0009b and 0010a/0010b.
- **Twenty-six ADRs supersede an earlier one; only two of the superseded ones said so** (ADR-0038 partially, ADR-0049 — both via the inline `**Status:**` form, which the first draft of this sweep missed because ADRs use two status formats: a `## Status` block and an inline `**Status:**` line; a grep for one form is not a sweep of both). ADR-0061 was the third, marked on 2026-08-23 as part of the licensing reconciliation. ADR-0007 and ADR-0034 carry no status line at all. ADR-0021 reads "Accepted" while ADR-0022 narrows it. A reader who opens a superseded ADR is told it is current.
- **Two packages exist that no ADR covers:** `packages/llm-driver` and `packages/report-governance`, plus `apps/web/features/brownfield/` as a slice. Against ADR-0049's rule that _"a hexagonal package is either a registered, wired context or it is not created,"_ none of the three has a registration decision of record.

### 9.3 Rules the tree currently violates

- **`export {}` barrels: 20 files still live** across 11 packages, contradicting AGENTS.md rule 7, ORCHESTRATOR.md's quality gate, and ADR-0050. The three marker-less barrels ADR-0050 said _"must be deleted by hand"_ are all still present verbatim. ADR-0050 is Proposed and its work item was parked by ADR-0059 — so this is unfinished work, not regression, but the AGENTS.md rule reads as absolute today, and it is what the bots enforce.
- **`layer-rules.yaml:85-86` still carries `driver_slice_exceptions` keyed on `apps/web/features/llm-driver/`** — a directory deleted in #464. ADR-0055 predicted this exact dangling path; it is still dangling.
- **ADR-0037's `/server` consumer list omits `apps/web`**, which is the largest live consumer (`wire.server.ts`, `wire-adapters.ts`). The amendment narrowed the list "to consumers that exist" and did not add it.

### 9.4 Doc text that states a retired reason

- `.agents/TESTING.md` and `.agents/ORCHESTRATOR.md` both assert _"NodeNext module resolution — explicit `.js` extensions required"_ for `packages/sync/`. Its tsconfig is `bundler`/`Preserve`, exactly as ADR-0009b and ADR-0050's amendment insist. The `.js` practice is real; the stated reason is the approach both ADRs rejected.
- ADR-0017 mandated keeping MLC constants inlined in the adapter because the package used `emitDeclarationOnly`. That flag is now `false` and the constants live in their own module. The constraint was silently retired.
- ADR-0055's "the rule fix is unbuilt" and "three pins remain" are both stale: `aliasSliceTarget()` exists with a fail-closed branch, and `CROSS_SLICE_ALIAS_BASELINE` is empty.
- ADR-0054's baseline is at 1 entry, not 4.

### 9.5 The record's own process failures

- **AGENTS.md asserted a rule the repo did not follow and could not check** (#488). It was the largest single source of review noise until corrected. A doc that states an aspiration as a rule teaches every bot to enforce the aspiration.
- **ADR-0063's decision "almost flipped twice because it lived only in a planning doc."** Two runbook drafts reversed it in opposite directions. The ADR exists because plans are not decisions.
- **Planning docs went stale by 7, 17, and 25 merges** (#468, #559, #511) and were cited as current. The EchoFakePort count of 14 _"matched no scope at all"_ — it came from a plan, not a grep.
- **A plan stated its prerequisites three times and disagreed each time** (#564). Five sites carried a scope error; three fixed in one commit, two missed.
- **PR bodies overclaimed what their tests proved** (#595, #569, #572), each corrected by the same author later.
- **Memory notes drift too.** `web_component_test_gotchas` carries a bullet that `.test.tsx` files are not CI-gated, annotated further down as solved. Both sentences are in the file; only the annotation is current.

### 9.6 Rules verified to hold

So that this section is not only a list of breakage: ADR-0053 (zero port files import from `infrastructure/`, host and templates), ADR-0036 (zero `typeof localStorage` guards), ADR-0044 (zero `node:test` imports), ADR-0038 (`jest-mock` gone everywhere), ADR-0047 (one real-source homonym left, named as low-priority polish), ADR-0052 (`engines.node >=22.7.0` in all three places), ADR-0049/0050/0058 (all four deleted packages absent), ADR-0056/0057 (validators deleted; the public-surface contract test exists). The ratchet, the firewall layers, and the lint.yml header's AUD-019 origin story all match their ADRs.

**The practice:** a claim in a document is not evidence. Re-verify against the tree before citing. Date any amendment rather than rewriting the original. And when an ADR is superseded, say so in _both_ ADRs — the one that supersedes and the one that was superseded — because the second is the one a reader opens.
