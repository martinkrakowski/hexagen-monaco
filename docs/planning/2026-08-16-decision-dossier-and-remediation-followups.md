# Decision Dossier & Remediation Follow-Ups

**Date:** 2026-08-16 · **Status:** Proposed. Six decisions ready to resolve; ten new findings, four of them defects.
**§2.5 is retracted** — see the note there; it would have hidden 14 real defects.
**Origin:** four parallel read-only investigations commissioned to unblock the architecture-remediation arc's
outstanding decision gates (D3, D4, D6, ADR-0049, HEX-018, `zod`-in-domain), plus item 5.2's missing scope.

Locators are durable (file + symbol), not line numbers, per planning house style.

---

## 0. What this document is for

Six decisions have been blocking the arc, and each has been re-litigated in PR review rather than settled.
Every one now has an evidenced recommendation. **Five of the six point the same way: the thing being
guarded is not what anyone assumed.** Read §2 before §1 — the findings change what the decisions are about.

**Every number below was verified against `main` (`5dc767de`) at the time of writing**, not carried from
a prior document. Two figures I had been repeating in status reports were wrong and are corrected in §2.7.

---

## 1. The six decisions

| Gate                          | Blocks                    | Recommendation                                             | Confidence                                       |
| ----------------------------- | ------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| **D3** api-gateway            | 4.5 → **Phase 8**         | **Delete**                                                 | High — zero consumers, zero runtime reachability |
| **ADR-0049** security fate    | 3.3 MOD-005, 6.4(e)       | **Option B (fold + delete)**, with one deviation           | High                                             |
| **D6** publish semver         | 4.7                       | **`0.10.0`**, unexport rather than subpath                 | High                                             |
| **D4** coverage posture       | 8.11                      | **No gate; delete the dead script.** Deferral, not erasure | High                                             |
| **HEX-018** port declarations | 4 PRs of review tax       | **Document-only** + bounded correction pass                | High                                             |
| **`zod`-in-domain**           | 11 of 30 baseline entries | **Split**: allowlist 6, burn down 3, fix 2 as rule defects | Medium-high                                      |

### 1.1 D3 — delete `apps/api-gateway`

19 lines of stock `fastify-cli` scaffold, unchanged since project setup. **Declares three workspace
dependencies and imports none of them.** Not deployed, not built (nothing depends on it, so it never
enters `turbo build --filter=web...`), not published, `private: true`. Port 3001 appears exactly once
in the repo — in its own `dev` script.

**The argument that survives challenge is not "it is a stub".** Its intended role is already occupied:
`apps/web/app/api` holds **28 route handlers**, hardened by #441–#444 with same-origin gating, a shared
rate limiter and BYOK persistence. "Wire it" does not mean finishing a scaffold; it means migrating 28
hardened routes onto a second Fastify process nobody has proposed.

It is also **the repo's only workspace with `echo` stubs for `build`/`test`**, so deleting it _is_ the
api-gateway half of AUD-021, not a prerequisite to it. And it carries cost: with no root `.dockerignore`,
every web image build installs the fastify ecosystem — **~26 lockfile entries that exist solely for it**.

**One hard blocker, must be in the same commit:** `scripts/check-lint-coverage.mjs` lists it in `UNLINTED`,
and that script has a _stale-detection_ arm — a deleted workspace lands in `stale` and reddens CI.
**Second trap:** `.architecture/manifest.yaml`'s entry and `.architecture/apps/api-gateway.app.yaml` must be
deleted **together**; removing the app file alone throws `App file not found` at load.

### 1.2 ADR-0049 — Option B, with one deviation from the ADR's own step 1

The ADR turns on one question: _is secret scanning about to be called from generation/sync/wizard?_
**No — on the record.** No wave schedules it, no ADR proposes it, no TODO references it, and the package
has been consumer-free for three months. Option A's step 4 has no candidate caller, and the ADR itself
calls A-without-step-4 _"the worst outcome"_.

Two facts the ADR does not contain:

- **The scanner is unreachable through its own barrel.** `src/index.ts` exports only two value objects;
  `TuffleHogAdapter`, the use case and `ISecretScanner` cannot be imported via `@hexagen/security` at all.
- **Its tests are type-invalid fictions.** `tsc --noEmit` yields 10 errors — mocks use `{ ok, value }`
  while `Result` is `{ success, value }`. They pass only because mock and assertion share the same wrong
  shape across a pass-through use case. **The one file with real logic has zero coverage.**

Its regexes match on the _words_ `secret`/`password`, `redactedKeys` is populated with a timestamp rather
than the key, and redaction is explicitly stubbed. **A fake security control is worse than none**, because
it invites reliance.

> **Deviation from the ADR's step 1.** The ADR proposes moving the value objects into `@hexagen/governance`.
> Recommend **deleting outright** instead: they have zero consumers, so the move relocates dead code into a
> live, manifest-visible context, adding a `context.yaml` edit and handing `governance` unused types the
> Wave-2 ratchet will then police. Annotate this on the ADR rather than deviating silently.

**Do not lean on ADR-0050 as precedent.** Its deletion predicate is _"frozen AND no runtime code"_, and
`security` satisfies **neither** half. ADR-0049's own predicate — unregistered, zero consumers,
scaffold-grade implementation — is the one that applies.

### 1.3 D6 — ship `0.10.0`; unexport rather than build a subpath

**The type-only removals are the smallest thing in this release.** The consumer-visible changes are
manifest-level:

|                   | 0.9.0 (published) | `main`                                                                   |
| ----------------- | ----------------- | ------------------------------------------------------------------------ |
| `engines.node`    | `>=20`            | `>=22.7.0` — **drops Node 20**                                           |
| `ts-morph`        | `^22.0.0`         | `^27.0.2` — a major; bundled TS 5.4.2 → 5.9.2                            |
| arch-linter rules | 3 fewer           | 3 new classes — consumer projects may newly fail `hexagen arch validate` |

Under 0.x, `^0.9.0` resolves `>=0.9.0 <0.10.0`. **A patch would auto-adopt all of the above** into every
already-generated project. The minor is the only fence available.

**The barrel is not the contract.** Generated projects consume the `hexagen` **binary** — zero generated
files import the package, the contract fixture exercises `dist/cli.js`, and the only
`from "@hexagen-monaco/sync"` string in the repo is a README example for **`runSync`, an export that has
never existed**. So take 4.7's fallback as its primary: **unexport** `InMemoryConfigDouble` (zero consumers
anywhere), `yaml-config.adapter` and `fs-utils` from the root barrel, rather than building a `/testing`
subpath that would be maintained forever for no caller.

**Propose ADR-0056** recording that the supported contract is the binary; the root barrel is provisional
under 0.x; removals ride a **minor**, never a patch, and must be named in that release's CHANGELOG section.
**Add a public-surface snapshot test** in `packages/sync/__tests__/contract/` so a removal becomes a
deliberate red-then-green edit instead of the per-PR judgement call #450 and #470 each required.

### 1.4 D4 — no coverage gate; this is a deferral with a re-open trigger

Coverage instruments _files the runner loads_. Four packages (`model-settings`, `runtime`, `shared`,
`api-gateway`) have no tests at all, so they contribute nothing to the denominator — **the metric rises as
the gap worsens.** Adopting that inside an arc whose thesis is _"a check's scope must be visible in its
output"_ would be self-refuting.

Item **8.10 is about to delete 24 mock-testing suites**, so any baseline taken now is invalidated by the
arc's own work — and during the interval the number rewards keeping the suites the audit called fabricated.

**Resolve as:** delete `package.json`'s dead `c8` coverage script and the `c8` devDependency; fix
`README.md`'s `yarn test --coverage` (it cannot work — no provider installed, no config). Record the
decision **with an explicit re-open trigger**: reconsider once 8.10's purge has landed, FU-1 has brought
`typecheck:test` to every workspace with tests, and every workspace with source has a real `test` target.
When re-opened, copy `scripts/check-lint-coverage.mjs`'s shape — assert _which packages are in the
denominator_, and print the number before enforcing it.

### 1.5 HEX-018 — document-only, plus a bounded correction pass

Survey across 34 contexts: **96 declared ports vs 141 port files; 56 declared adapters vs 108.**
12 contexts have no `ports:` key; 21 have no `out:` key.

**But the decisive question was what consumes these lists, and ten of twelve consumers are indifferent to
completeness.** The two that are not both argue _against_ enforcement — see §2.1 and §2.2.

**The bots are not wrong.** No bot config exists in this repo; they are enforcing **`AGENTS.md`'s** rule
that every file maps to a named manifest element — a rule the repo wrote, does not follow (63% of port
files undeclared), and cannot check (`yarn lint:arch` never reads `layers`). **That line is the lever.**

**Recommended:**

1. Declare in an ADR that `layers.*.ports`/`adapters` are a **curated ownership registry, not a file
   inventory**; the filesystem is the authoritative inventory. Fix the `AGENTS.md` rule that generates the flags.
2. **Delete the 12 hard phantoms and re-attribute the 7 misattributions** (19 entries, ~10 files). Resolve
   `TransactionManagerPort`'s double-declaration in favour of `transaction-system`.
3. **Delete `packages/sync/src/generators/validators/**`\*\* — see §2.3.

**Do not enforce (option a):** ~150 additions whose _direction_ is not derivable from the tree (25 port files
sit in folders with no in/out signal, and for the five packages HEX-018 names the folder signal is known
wrong), gated behind an unstarted item 6.4, needing a new baseline key scheme — with no consumer paying for it.

**Do not delete the declarations (option c):** it breaks the live `hexagen_create_adapter` write path and a
published emission contract.

### 1.6 `zod` — split, weighted to allowlist

11 entries, **37% of the current baseline**, untouched since seed.

- **Allowlist 6** (`project-configuration` ×2, `agentic-interaction` ×2, `shared`, `local-llm`, plus the
  `prompt-compiler` carrier): these parse a YAML manifest, an LLM JSON response, or a config file —
  identical in kind to the `js-yaml` exception ADR-0054 already accepted. **ADR-0054's own allowlist comment
  names zod as "the same class"**; only the disposition differs. In the same edit, allowlist
  `agentic-interaction`'s two `js-yaml` files, so one package is not adjudicated two ways.
- **Burn down 3** (one dead line in `wizard-session.ts`; two files defensively re-validating the repo's own
  in-process port results). Here the code gets _better_, not merely compliant.
- **Fix 2 as rule defects, not architecture** — see §2.5 and §2.6.

**Not wholesale burn-down:** it means hand-rolling a validator reproducing `.strict()`, preprocessing,
cross-field refinement and structured `issues[].path` for the repo's most central type — while the repo
would _still_ hand-write JSON Schema alongside it, since no `zod-to-json-schema` is installed.

**Prefer allowlisting over leaving it baselined.** The baseline is not a neutral hold: its key is
`rule|file|specifier`, so a new domain zod fails CI immediately (a de facto ban already in force) and any
file move goes stale _and_ fails on the new path. The decision has been made by mechanism; this writes it down.

---

## 2. New findings — four are defects

### 2.1 The grounded LLM prompt shows the model wrong port ownership · **defect**

`api/llm/context` builds a `{portName → context}` map, then renders `Object.entries(...).slice(0, 10)` under
`PORT OWNERSHIP (selected):`. The repo produces **95 entries; 85 never reach the model.** Of the 10 shown,
**3 are wrong** — a phantom `GeneratorPort`, `LoggerPort` attributed to `project-configuration` when it lives
in `shared`, and `ProjectGeneratorPort` which names no port at all. Two lines below, the prompt asserts
`port-single-ownership [critical]` as an invariant.

**Completeness is structurally irrelevant here; accuracy is not.** Adding the 45 missing entries would push
real ones out of the window. Fix the phantoms; make the slice deterministic or raise it.

### 2.2 `manifest-analysis.ts` reads a key no file uses · **defect**

It reads adapters from `layers.domain.adapters`. **Zero of 34 `context.yaml` files put `adapters:` under
`domain:`** — all 23 that have the key use `infrastructure:`, which is what the schema mandates. So
`adapterCount` is permanently `0`, `complete` is always `false`, and the shadow rule _"Context X has N
port(s) but no adapters implemented"_ fires for **all 21 contexts with declared ports**, unsilenceable.
Its test passes because the fixture hand-writes a shape no real file has. A sibling rule reads
`dependencies` where the manifest uses `depends_on`.

### 2.3 `validateBoundedContext` was dead from birth and is path-broken · **defect**

Introduced 2026-04-28; `git log -S` shows the symbol has **never had a caller**. It is also unusable:
it probes `*.in-port.ts` / `*.out-port.ts`, conventions that **do not exist** in this repo (the convention is
`*.port.ts`), and adapters as `${name.toLowerCase()}.adapter.ts`. Wired unchanged it would emit **~150 false
errors**. Its continued existence is precisely what makes reviewers and bots believe an enforcement
mechanism exists. **Delete it.**

### 2.4 `publish.yml` publishes two npm packages without running any test · **defect**

Build + `turbo run typecheck` only. Not raised in any plan document. If there is appetite for one
verification investment in this arc, this outranks coverage.

### 2.5 ~~Half the ratchet baseline is template payload — a one-edit 30 → ~12~~ · **RETRACTED**

> **RETRACTED 2026-08-16, before this document was actioned.** The recommendation was to exclude
> `**/templates/**` from the linter scan, clearing 15 entries at a stroke. **That would have hidden 14 real
> defects.** Item 5.9 (PR #481) landed while this dossier was in review and _fixed_ those 14
> `cross-layer-relative-import` entries — they were genuine layering violations in template **ports** that
> are emitted into customer projects, not scaffolding noise. The baseline went **30 → 16 by repair, not by
> exclusion**, and only **one** template entry remains (a `zod` finding belonging to §1.6).
>
> §5's own risk note warned that template payload ships into generated projects and deserves its own check
> rather than being assumed away — and this recommendation contradicted it. The lesson generalises:
> **"outside the tsconfig" is not the same as "not real code."** Emitted templates are compiled by
> _consumers_, so a layering violation there is a defect this repo exports.

**What stands:** 15 of 30 entries were under `packages/template-engine/templates/**`. **What was wrong:**
treating that as grounds for exclusion. Do **not** narrow the linter's scan. If template scanning is ever
reconsidered, the burden is to show the emitted output is checked somewhere else — and today it is not;
see §2.11.

### 2.6 Three `zod` findings are `import type` — erased at compile time

`import type { z }` / `import type { ZodSchema }` emit **no runtime import**. Calling these "an npm package
in the domain layer" is arguably a rule defect. Consider exempting type-only imports from
`npm-package-in-domain`.

### 2.7 Corrections to figures I reported during the arc

| Claim                                                                | Correct                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "`apps/web` has ~1200 never-type-checked test **files**"             | **1,184 test _cases_ across 135 files** — a ~9× over-sizing of FU-1.2                                                                                                                                                |
| "FU-1.2 is one script line away"                                     | **False.** `apps/web/tsconfig.test.json` does not override `include`/`exclude`, and the base config _excludes_ `**/*.test.ts` — `tsc -p` would check **zero files**. The naive fix ships a gate over an empty domain |
| "`SendStructuredRequestPort` is undeclared in `agentic-interaction`" | It **is** declared — by `local-llm`, which defines it. Under ADR-0047 single-ownership its absence there is **correct**, not drift                                                                                   |
| Baseline "34"                                                        | **30.** `lint.yml` comments, RI-1 and the runbook all still say 34 — exactly the drift RI-1.3's visible-count line would catch                                                                                       |

### 2.8 Two coverage gaps in the linter itself

HEX-015 (item 5.6b) was found by human review and the linter was **silent before and after**: there is no
application-layer sibling to `npm-package-in-domain`, and **DOM globals require no import**, so no
specifier-based rule can ever see them. Phase-2 ratchet candidates.

### 2.9 An undetectable dodge the current posture rewards

`packages/project-configuration/src/schema.ts` is 184 lines of zod with `z.infer` types sitting at `src/`
root — outside any layer directory, so the linter never sees it. "Move the file up one level" is a live,
invisible way around every layer rule.

### 2.10 `manifest-merge-loader` silently drops four manifest keys

It builds the merged manifest field-by-field and drops `generator`, `monorepo`, `planes` and `cross_context`
entirely. That single omission disarms `generateStubs`, `generator.sync.layers`, `monorepo.archInvariants`
and the linter's `required-communication` rule for this repo. No ADR or comment explains it. **Upstream of
several "nothing happens" verdicts in §1.5** — worth its own item.

### 2.11 Template manifests have no npm-dependency mechanism · **blocks First-Run-Green coverage**

Found while building item 5.9. No template manifest can declare an npm dependency — verified: **no template
declares one, and nothing in the emitted `package.json` provides `zod`**. So any template importing `zod`
(every Adobe template, `llm-adapter`, `bedrock-agentcore-runtime` — which also needs
`@aws-sdk/client-bedrock-runtime`) fails `yarn typecheck` in a generated project before its own code runs.

**Consequence:** those templates **cannot be added to a capstone fixture**, so First-Run-Green structurally
cannot cover them. That is why 5.9's acceptance had to fall back to a bundle-backed guard suite. The gap is
not 5.9's — it is a missing feature of the template format, and it silently caps what the capstone harness
can ever verify.

---

## 3. Escalations — decisions only a human can make

1. **D3, ADR-0049, D6, D4, HEX-018, `zod`** — recommendations above. D3 compounds: it gates 4.5, which gates
   Phase 8.
2. **Six release gates** are queued on published packages (#457, #459, #466, #470, #474, #476). D6 proposes
   the carrier; someone must approve the publish.
3. **ADR-0055 is `Proposed`** and asserts repo-wide doctrine four merged PRs already follow.
4. **Branch protection** for `Lint & Boundaries / ESLint + UI boundary` — a repo setting no PR can make.
5. **`packages/mcp-server/src/index.ts` is uncommittable** — root-run ESLint errors on undeclared env vars;
   package-run ESLint rejects the disable comment that fixes it; `turbo.json` is never-edit. It has already
   blocked one agent.
6. **`SecureChatDispatchUseCase` has zero consumers.** If it goes, HEX-008 closes by deletion and
   `ApiKeyVaultLifecyclePort` goes with it.
7. **The dangling `driver_slice_exceptions` entry** in `layer-rules.yaml`, orphaned by #464 — its only entry,
   so retiring it questions the concept.

---

## 4. Sequencing

```text
Now, no gate:        2.2, 2.3 (defects, self-contained)
                     5.2 (spec ready — see the investigation record)
                     2.11 (template npm-dependency mechanism)
After D3:            4.5 delete api-gateway  → unblocks Phase 8's dependency
After ADR-0049:      3.3 MOD-005 resolves or dissolves; 6.4(e) in or struck
After D6:            4.7 + the 0.10.0 release
After HEX-018:       phantom cleanup (19 entries), 2.1's prompt fix
After `zod`:         allowlist amendment + the 3-entry burn-down
Independent:         2.4 (tests in publish.yml) — arguably ahead of all of it
```

**2.2 and 2.3 first.** Both are self-contained defects needing no decision. The baseline has already
halved (30 → 16) via item 5.9 repairing template ports properly — see the §2.5 retraction for why
repair was the right mechanism and scan-exclusion was not.

## 5. Risks

- **Deleting `api-gateway` and `security` are both fully reversible** — neither is published, neither appears
  in any of the 50 template directories, and `deriveApps()` never emits `api-gateway`. Recovery is one revert.
- **The 0.10.0 release is not reversible** once published. The Node-20 drop is the loudest change and belongs
  at the top of the release notes.
- **HEX-018's correction pass touches `.architecture/`**, which is Primary-only under the runbook's
  delegation model. It cannot be delegated to a worker as currently written.
- **2.5's template exclusion must not hide real findings.** Template payload is emitted _into_ generated
  projects; if those files are wrong, generated projects inherit it. The exclusion is right for the _host_
  ratchet, but the templates deserve their own check — file it rather than assume it away.
