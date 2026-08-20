# Brownfield UI — feature list and atomic delegation plan

**Date:** 2026-08-20 · **Status:** ready to run (rev 2 — two adversarial review rounds adjudicated, see §10) · **Baseline:** `wave-b-8.12h` @ `8791a765` (origin/main @ `1eb20679`; docs-only ahead of the parent plan's `4dddf1e1`)
**Drives:** `docs/planning/2026-08-20-brownfield-ui-plan.md` (the _what/why_; this doc is the _how/in-what-order_)
**Companion:** `docs/planning/2026-08-20-remaining-work-plan.md` (Wave D item 8.1 collides with **BF-1.2** — see §6.3)

Grounded in five parallel repo explorations (UI inventory · creation-funnel map · scan/bootstrap/linter contracts · GitHub publish plumbing · repo conventions). Locators are durable (file + symbol), not line numbers.

---

## 0. Corrections that reshape the parent plan

Five findings from the exploration change scope materially. They are folded into the packets below.

| #       | Finding                                                                                                                                                                                                                                                                                                                                                                       | Effect                                                                                                                                                                                                                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C-1** | **`hexagen scan` emits no JSON on stdout.** `runScan` (`packages/sync/src/commands/scan/index.ts`) only `console.log`s `nextSteps`. The web adapter's JSON branch in `cli-hexagen-scan.adapter.ts` (`collectArtifacts`, reading `layout`/`filesScanned`/`reportMarkdown`/`error`) is **dead code against the real CLI**.                                                      | The adapter's existing parse _defines_ the contract. BF-0.1 makes the CLI emit exactly that envelope — a CLI-only change with a live consumer already written.                                                                                                                                                                     |
| **C-2** | **`reportMarkdown` is always `null`.** CLI writes `<root>/hexagen-report.md` (`commands/report/index.ts`); the adapter probes only `.architecture/HEXAGEN-SCAN-REPORT.md`, `.architecture/scan-report.md`, `HEXAGEN-SCAN-REPORT.md`. Pure filename mismatch.                                                                                                                  | Folded into BF-0.1. Affects the **shipped** #558 screen today, not just new work.                                                                                                                                                                                                                                                  |
| **C-3** | **`hexagen scan` never builds the handoff zip.** `runScan` calls `reportCommand` without `handoff`; only `hexagen report --handoff` produces it (`commands/report/handoff.ts` `buildHandoffZip`).                                                                                                                                                                             | Tier A's premise ("run scan, upload the zip") is broken as written. BF-0.2 adds `scan --handoff`.                                                                                                                                                                                                                                  |
| **C-4** | **CLI-1 is far smaller than the parent plan states.** `hexagen-lint --json` already emits `{fresh, baselined, stale, expired, introduced, baselineGrowth}` (`tools/arch-linter/src/cli.ts`), and `parseLintJson` (`packages/sync/src/commands/report/lint-collect.ts`) already consumes it. The gap is only that `invokeHexagenLint` uses `stdio: "inherit"` and discards it. | BF-0.3 is **S**, not the "new findings contract" the parent plan sized.                                                                                                                                                                                                                                                            |
| **C-5** | **A new feature slice cannot import from an existing one.** `scripts/validate-ui-boundary.sh` check 6 resolves both relative and `@/` specifiers across `apps/web/features/*/`; `CROSS_SLICE_ALIAS_BASELINE` is **empty** and stale entries are fatal. Only `workspace-shell` is exempt, both directions.                                                                     | `ScanResultPanel` (landing), `ThinkingBlock`/`AiGeneratingStep`/`useStagedGenerationStream` (manifest-generation) are **unreachable** from a new slice. Phase 1 promotes them to neutral homes _before_ any screen work. This gate is CI-only — the pre-commit hook does not run it, so a worker will not see the failure locally. |

**Also confirmed, and load-bearing:** `@hexagen/ui` has no Table, RadioGroup, Select, Toast, Progress, Stepper, EmptyState, diff viewer, or sparkline (27 components total) → Phase 2. `@hexagen/ui/types` is **not a valid subpath** (no `./types` export) despite DESIGN.md §3.4 showing it — import `NoSemanticState` from bare `@hexagen/ui`. `/projects/new/import/github/page.tsx` already exists as `redirect("/projects/new/import")` — enabling it is a one-line flip. **No PR-creation code exists anywhere** (no `/pulls` call, no octokit) → BF-6.3 is genuinely new.

---

## 1. UX / application flow

### 1.1 Route map

```text
/projects/new/import                     ImportSelectionPage  (exists; flip `github` to available)
/projects/new/name?path=artifacts        NameStepClient       (exists; add "artifacts" to NamedPath)
/projects/new/name?path=repo             NameStepClient       (exists; add "repo")
/projects/new/import/artifacts   ← NEW   Tier A: handoff-zip / loose-file upload
/projects/new/import/github      ← FLIP  Tier B: repo URL + branch, streaming scan
/projects/new/import/scan                ImportScanPage       (exists, #558; Tier C zip)
/projects/new/import/ratify      ← NEW   S3+S4+S5 ratification wizard (post-scan, any tier)
/projects/new/import/report      ← NEW   S6 report + S7 install-the-gate
```

Every leg carries `?name=` per the **carried-name store-key contract** (`features/manifest-generation/carriedName.ts` `withCarriedName`) — `carriedName` is also the genesis-settings store key, so dropping it silently orphans state.

### 1.2 The flow as a state machine

One machine spans all tiers; the tier only decides how `scanArtifacts` is obtained.

```text
                    ┌──────────────┐
                    │  tier_pick   │  S1
                    └──────┬───────┘
         ┌─────────────────┼─────────────────┐
     A: artifacts      B: repo url        C: zip upload
         │                 │                 │
   ┌─────▼─────┐   ┌───────▼───────┐   ┌─────▼─────┐
   │ uploading │   │  repo_entry   │   │ uploading │
   └─────┬─────┘   └───────┬───────┘   └─────┬─────┘
         │                 ▼                 │
         │          ┌─────────────┐          │
         └─────────▶│  scanning   │◀─────────┘   S2 (streaming for B, sync for A/C)
                    └──────┬──────┘
              ┌────────────┼────────────┐
       could-not-run    violations     pass
              │            │            │
        ┌─────▼─────┐      └─────┬──────┘
        │  blocked  │            ▼
        └───────────┘   ┌─────────────────┐
                        │ layout_ratify   │  S3
                        └────────┬────────┘
                                 ▼
                        ┌─────────────────┐
                        │ manifest_ratify │  S4
                        └────────┬────────┘
                                 ▼
                        ┌─────────────────┐
                        │ findings_review │  S5   (skipped when fresh == 0)
                        └────────┬────────┘
                                 ▼
                        ┌─────────────────┐
                        │     report      │  S6   ← terminal-with-actions
                        └────────┬────────┘
                                 ▼
                        ┌─────────────────┐
                        │  gate_install   │  S7   (dialog, not a page)
                        └─────────────────┘
```

Terminal states: `report` (never auto-navigates — per the standing no-auto-navigate-past-telemetry rule, S6 exposes an explicit **Install the gate** button). `blocked` is recoverable: it offers "try another tier".

**Back semantics.** `layout_ratify → scanning` is _not_ re-runnable (the scan is a point-in-time artifact); Back from S3 returns to `tier_pick` and discards the draft behind a confirm. S4→S3 and S5→S4 are free — drafts are held in one reducer, not per-step.

### 1.3 Screen designs

Chrome for every screen: `ProjectsShellWithFreeTier` (`title`, `headerContent`, `children`, `footer`) — Back/primary buttons live in `footer`, never in content. Content skeleton, step indicator, and `animate-fade-in-up delay-{100,200}` copied verbatim from `ProjectNameStep`.

**S1 — Entry + tier picker** (`max-w-3xl`)

```text
┌ CreationStepIndicator ─ ●Method ─ ●Configure ─ ○Generate ───────────┐
│                                                                     │
│           How should we read your codebase?                         │
│   Pick what leaves your machine. You ratify everything after.       │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ ◉  Artifacts only                          RECOMMENDED      │    │
│  │    You run `npx hexagen scan --handoff` locally and upload   │    │
│  │    the handoff zip. No source code is uploaded — file paths, │    │
│  │    package names and rule findings are.                      │    │
│  │    ┌ leaves your machine ──────────────────────────────┐     │    │
│  │    │ manifest · layout · baseline · report · ledger    │     │    │
│  │    └───────────────────────────────────────────────────┘     │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │ ○  Public repo URL                                          │    │
│  │    We shallow-clone, scan, and delete. Nothing is retained   │    │
│  │    but the scan artifacts.                                   │    │
│  │    ⚠ Not for client engagements.                             │    │
│  ├─────────────────────────────────────────────────────────────┤    │
│  │ ○  Upload a zip                                             │    │
│  │    Same retention as above. Max 32 MB.                       │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
 footer:  [← Back]                                    [Continue →]
```

Component: `ChoiceCardGroup` (BF-2.2) — the `role="radiogroup"` + `<label><input type="radio">` pattern lifted from `PublishSettingsDialog` `OPTIONS`. The "leaves your machine" strip is a `Badge` row, not prose; it is the honesty affordance the doctrine demands and must not be collapsed into the description.

**S2 — Scan progress** (streaming, Tier B only; A/C show a determinate 3-step list)

```text
┌──────────────────────────────────────────────────────────────────┐
│  Scanning acme/checkout-service @ main                           │
│                                                                  │
│  ✓ Clone            depth 1 · 2,481 files · 18.4 MB      1.9s    │
│  ✓ Detect workspaces  7 packages found                    0.3s   │
│  ⟳ Lint             checking 2,481 files…                        │
│  ○ Report                                                        │
│                                                                  │
│  ┌ log ───────────────────────────────────────────── [hide] ─┐   │
│  │ remote: Enumerating objects: 2481, done.                  │   │
│  │ Files scanned: 2481                                       │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
 footer:  [Cancel]
```

`StageProgressList` (BF-1.3, promoted from `ThinkingBlock`'s presentation half). Clone lines stream as `chunk` frames — **no synthetic percentages**; byte counts are real or absent.

**Partial-failure semantics — decided here, not in the packet.** The stages are not all-or-nothing, and the UI must say which ones ran:

| Failure point                                                       | Server frame                     | UI result                                                                           |
| ------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| Clone fails (size preflight, auth, 404, wall-clock)                 | `error` (terminal)               | `blocked`, no artifacts, "try another tier"                                         |
| Detect-workspaces throws (duplicate context name, unsupported glob) | `error` (terminal)               | `blocked` **with the CLI's own message surfaced verbatim** — it is actionable       |
| Lint exits 2 (could-not-run)                                        | `stage-complete` + `error`       | `blocked`; the layout **was** written, so offer the partial artifacts as a download |
| Lint exits 1 (violations)                                           | `stage-complete`                 | **normal path** — violations are the product, not a failure                         |
| Report step fails                                                   | `stage-complete` + warning frame | Proceed to S3; the report is regenerable and must never block ratification          |
| Server wall-clock kill                                              | `error` with `code: "timeout"`   | `blocked`, explicit "the scan exceeded N seconds" — never a generic failure         |

The last good partial result is written to the draft store (BF-3.4) on every `stage-complete`, so a mid-stream failure leaves something to resume from. `runId` rides every frame for correlation (F-36).

**S3 — Layout ratification** (`max-w-4xl`)

```text
┌ 7 packages found. Confirm the ones that are bounded contexts. ───────┐
│                                                                      │
│ ☑  packages/orders          → context ⌜orders          ⌟             │
│      domain ⟨src/domain ×⟩ ⟨+⟩   application ⟨src/application ×⟩ ⟨+⟩  │
│      infrastructure ⟨src/db ×⟩ ⟨src/http ×⟩ ⟨+⟩                       │
│ ─────────────────────────────────────────────────────────────────    │
│ ☑  packages/billing         → context ⌜billing         ⌟             │
│      domain ⟨src/core ×⟩ ⟨+⟩     application —  ⟨+⟩                   │
│ ─────────────────────────────────────────────────────────────────    │
│ ☐  packages/eslint-config   → context ⌜eslint-config   ⌟   excluded   │
└──────────────────────────────────────────────────────────────────────┘
 footer:  [← Back]                        5 of 7 included   [Continue →]
```

Rows are `EntityDataGrid` (BF-2.1) with an expandable layer row; layer dirs are `ChipInput` (reused from `features/project-wizard/steps/ChipInput.tsx` — **must be promoted or copied**, see §6.2). Directory chips prefill from `DetectedPackage.layers`, which records **only aliases that exist on disk** (`LAYER_ALIASES` in `detect-workspaces.ts`) — so an empty layer is a true "not found", and the UI says _found_ / _not found_, never a confidence score. Duplicate context names are blocked inline (`detectWorkspaces` throws on duplicates; the UI must never let that throw reach the server).

**S4 — Manifest ratification** → writes `BootstrapAnswers` `{system, scope, architecture, contexts[]}`. Scope shows a live `sanitizeScope` preview (`@Acme Corp!` → `acme-corp`); the function is **not exported** — BF-4.2 exports it rather than reimplementing (a second implementation would drift). `dependsOn` edges start **empty and unchecked**; bootstrap infers nothing. Zero included contexts is blocked client-side (bootstrap errors with "No contexts were ratified").

**S5 — Findings review**

```text
┌ 34 findings ───────────────────────────── [group: rule ▾] ──────────┐
│ ▸ cross-package-import              18   [baseline all…]            │
│ ▾ npm-package-in-domain              9   [baseline all…]            │
│    packages/orders/src/domain/order.ts        zod                   │
│      ○ Leave fresh   ◉ Baseline it                                  │
│      reason ⌜parsing carrier — ADR-0054 §2c        ⌟  expires ⌜⌟     │
│    packages/billing/src/domain/invoice.ts    date-fns               │
│      ◉ Leave fresh   ○ Baseline it                                  │
│ ▸ server-marker-missing              4   [baseline all…]            │
│ ▸ subpath-convention                 3   [baseline all…]            │
└─────────────────────────────────────────────────────────────────────┘
 sticky:  27 baselined · 7 fresh → the gate will exit 1     [Continue →]
```

Grouping is **dynamic over `BaselineEntry.rule` (an open `string`)** — never a hardcoded key set. `Accordion.Root type="multiple"` per rule group. Reason is required to baseline (`parseBaseline` rejects an empty `reason`). `expires` is calendar-validated and carries the counter-intuitive warning: **an expired entry fails the gate even if the finding is gone.**

**S7 — Install the gate** (Dialog, mirroring `ExportDialog`'s phase machine)

```text
┌ Install the conformance gate ───────────────────────────────┐
│ ◉ Download a zip                                            │
│   3 files + your ratified .architecture/. You open the PR   │
│   inside your client's own review process.                  │
│ ○ Open a pull request                                       │
│   Uses your GitHub connection. Scope is all-repos —         │
│   use this for your own repos and demos, not client orgs.   │
│                                                             │
│ files: .github/workflows/sync-integrity.yml                 │
│        .github/actions/hexagen-conformance/action.yml       │
│        .github/actions/hexagen-conformance/post-comment.mjs │
│        .architecture/{manifest,layout}.yaml                 │
│        .architecture/arch-lint-baseline.json                │
│ ⚠ needs yarn@4 + `hexagen-lint` / `sync:check` scripts       │
└─────────────────────────────────────────────────────────────┘
                                   [Cancel]  [Download zip]
```

The ⚠ line is required: `hexagenConformanceActionFiles()` materializes **only the three workflow files** — there is no installer that adds the `package.json` scripts or the `packageManager` pin a consumer also needs.

---

## 2. Component decisions — reuse / promote / build

DESIGN.md §5.2 composition priority governs: primitive as-is → compose → custom Tailwind with a documented justification.

| Need                                                                        | Decision                             | Home                                                 | Why                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Cards, badges, buttons, inputs, dialog, tabs, accordion, tooltip, file drop | **Reuse** `@hexagen/ui`              | —                                                    | All exist. `FileDropZone` covers Tier A/C upload; `Dialog` family covers S7; `Accordion` covers S5 grouping. |
| `ScanResultPanel`                                                           | **Promote**                          | `apps/web/components/conformance/`                   | In `features/landing` today → C-5 blocks reuse.                                                              |
| NDJSON stream hook                                                          | **Promote**                          | `apps/web/app/lib/`                                  | In `features/manifest-generation` → C-5. Collides with Wave D 8.1 (§6.3).                                    |
| Stage progress view                                                         | **Promote (presentation half only)** | `apps/web/components/`                               | `ThinkingBlock` mixes an LLM-specific stage vocabulary with a generic progress list; extract the list.       |
| `ChipInput`                                                                 | **Promote**                          | `apps/web/components/`                               | In `features/project-wizard` → C-5.                                                                          |
| Data grid                                                                   | **Build**                            | `apps/web/components/primitives/EntityDataGrid.tsx`  | No table anywhere in `@hexagen/ui`. DESIGN.md §3.2 mandates this exact name over `Table`.                    |
| Radio card group                                                            | **Build**                            | `apps/web/components/primitives/ChoiceCardGroup.tsx` | No radio primitive. Pattern already proven inline in `PublishSettingsDialog`.                                |
| Empty state · count pills                                                   | **Build**                            | `apps/web/components/primitives/`                    | Neither exists.                                                                                              |
| Sparkline (S6 trend)                                                        | **Build, deferred**                  | `apps/web/components/primitives/`                    | Only S6 needs it; Phase 7.                                                                                   |

**Why `apps/web/components/primitives/` and not `packages/ui`:** these are single-app compositions, and a `@hexagen/ui` addition drags in a DESIGN.md §9 version bump + changelog entry + `NoSemanticState` branding + the package's own ESLint firewall. Promote to `packages/ui` later if a second app needs them.

**But that siting has a cost rev 2 did not account for — verified, and it is the reason for the `primitives/` sub-directory.** `apps/web/components/` sits outside **both** enforcement layers:

| Layer                                                              | Covers                                                                                                                  | Does **not** cover                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| ESLint (`apps/web/eslint.config.js`)                               | `app/**`, `features/**` — where the `hexagen-ui` plugin rules incl. `no-arbitrary-tailwind-values` are wired at `error` | **`components/**` — no block exists at all\*\*        |
| Firewall check 3 (`validate-ui-boundary.sh`, forbidden prop names) | `packages/ui/src` **only**                                                                                              | `apps/web/features/**` _and_ `apps/web/components/**` |

Proof the gap is live, not theoretical: `apps/web/components/chat/ChatMessageList.tsx` carries two `w-[85%]` arbitrary values that DESIGN.md §4.8 forbids and no gate has ever flagged. Left alone here — it is out of scope — but it demonstrates that siting a _presentation-only_ primitive in an unenforced directory trades a DESIGN.md version bump for a silent loss of the two rules that matter most for these components.

**BF-2.0 closes it** by scoping both layers to a new, greenfield `apps/web/components/primitives/` — zero legacy blast radius, because the directory does not exist yet.

**Why a sub-directory rather than the whole of `components/`:** a blanket forbidden-prop check over `components/` would produce false positives on components that are _supposed_ to hold that state. `ErrorBoundary.tsx` declares `error: Error | null`, and DESIGN.md's own table says error handling **belongs** in boundary components. `primitives/` means presentation-only by construction; stateful boundary components stay outside it and keep their props legitimately.

---

## 3. Feature list

Atomic, independently acceptable. **Size:** XS<½d · S≈1d · M≈2-3d · L≈4-5d.

### Contract layer

| ID   | Feature                                                                                                                                                                                                                                              | Size |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| F-01 | `hexagen scan` emits a single-line JSON envelope on stdout: `{layout, filesScanned, reportMarkdown, error}` — the shape the web adapter already parses.                                                                                              | S    |
| F-02 | Report path alignment: adapter probes `hexagen-report.md`; envelope carries the markdown directly.                                                                                                                                                   | XS   |
| F-03 | `hexagen scan --handoff [--handoff-out]` produces `hexagen-handoff.zip` via the existing `buildHandoffZip`.                                                                                                                                          | S    |
| F-04 | Scan captures `hexagen-lint --json` (drop `stdio:"inherit"`) and adds `findings: {fresh, baselined, stale, expired}` to the envelope and to `ProjectScanResponse`.                                                                                   | M    |
| F-05 | `unpackZipToDir` streams entries (`entry.nodeStream()` + aborting byte counter) instead of checking `maxEntryBytes` post-inflation, and rejects a duplicate normalized entry name before the first write. **Both are live defects in shipped #558.** | S    |
| F-06 | Tier-A limit profile: `maxEntries: 8`, `maxEntryBytes: 1 MiB`, `maxUncompressedBytes: 4 MiB`, distinct from the 256 MiB scan profile.                                                                                                                | XS   |

### Platform layer

| ID   | Feature                                                                                                                             | Size |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ---- |
| F-07 | `POST /api/projects/scan/artifacts` — parses handoff zip or loose files in-process, no CLI.                                         | M    |
| F-08 | `POST /api/projects/bootstrap` — `BootstrapAnswers` + layout edits → written files.                                                 | M    |
| F-09 | `POST /api/projects/scan/github` — NDJSON stream; GitHub API `size` preflight, size-capped tmpfs, wall-clock kill.                  | L    |
| F-10 | `"scan"` `QuotaKind` + `resolveAnonSession`/`consume` in both scan routes, `Set-Cookie` propagated. **Nothing meters scans today.** | S    |
| F-11 | `POST /api/projects/install-gate` — gate bundle as zip.                                                                             | M    |
| F-12 | Branch + commit + `POST /pulls`. **All new — no PR code exists.**                                                                   | L    |
| F-13 | `ScanRecord` store on `platform.db`, owner-scoped, artifacts on the `/data` volume with path+size in the row.                       | M    |

### UI layer

| ID   | Feature                                                                         | Size |
| ---- | ------------------------------------------------------------------------------- | ---- |
| F-14 | Slice skeleton + `brownfield-flow-state-machine.ts` (8.12(h) shape).            | M    |
| F-15 | S1 entry + tier picker.                                                         | M    |
| F-16 | S2 streaming progress.                                                          | M    |
| F-17 | S3 layout ratification.                                                         | L    |
| F-18 | S4 manifest ratification incl. exported `sanitizeScope` preview.                | L    |
| F-19 | S5 findings review + baseline seeding (dynamic rule grouping).                  | L    |
| F-20 | S6 report dashboard.                                                            | M    |
| F-21 | S7 install-the-gate dialog.                                                     | M    |
| F-22 | PR-comment deep link (`post-comment.mjs` gains a `?repo=&pr=` link).            | XS   |
| F-23 | Flip `github` sub-option to `available`; add `artifacts`/`repo` to `NamedPath`. | XS   |

### Shared components

| ID   | Feature                                                         | Size |
| ---- | --------------------------------------------------------------- | ---- |
| F-24 | Promote `ScanResultPanel` → `apps/web/components/conformance/`. | S    |
| F-25 | Promote NDJSON stream hook → `apps/web/app/lib/`.               | M    |
| F-26 | Extract + promote `StageProgressList`.                          | M    |
| F-27 | Promote `ChipInput`.                                            | S    |
| F-28 | Build `EntityDataGrid`.                                         | M    |
| F-29 | Build `ChoiceCardGroup`.                                        | S    |
| F-30 | Build `EmptyState` + `CountPills`.                              | S    |
| F-31 | Build `RatchetSparkline`.                                       | S    |

### Cross-cutting

| ID   | Feature                                                                                                                                                                          | Size |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| F-32 | Versioned scan-envelope schema in `@hexagen/shared` + golden-fixture contract test both sides run.                                                                               | S    |
| F-33 | `validate-ui-boundary.sh` in `.husky/pre-commit`, gated on staged `apps/web/{features,app}` paths.                                                                               | XS   |
| F-34 | Draft persistence for the ratification reducer via `createPersistedStorage` / IDB.                                                                                               | S    |
| F-35 | Shared error taxonomy across CLI → route → UI (one typed code set, one renderer).                                                                                                | M    |
| F-36 | Stream observability: a `runId` on every NDJSON frame, scan duration / failure-rate / quota-hit counters.                                                                        | S    |
| F-37 | Extend ESLint + firewall check 3 to `apps/web/components/primitives/**` so forbidden prop names and arbitrary Tailwind values are machine-blocked where the new primitives live. | S    |

---

## 4. Packets — one packet = one worktree = one PR

**Column key.** _Mode_: `PARALLEL` (no shared file) · `SEQUENTIAL` (shared barrel/tsconfig/contract) · `GATE` (human decision). _Gate_: who runs the Quality Gate — always **Primary from the main checkout**, because worktrees have no `node_modules`. _Scout_: seam edits require a read-only scout sub-agent **before** the worker exists.

### Phase 0 — Contract truth (no UI; unblocks everything)

| Packet        | Features   | Scope (exclusive file ownership)                                                                                                                                                    | Mode       | Depends | RED test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BF-0.0**    | F-32       | `packages/shared/src/**/scan-envelope.ts` + barrel; golden fixture `__tests__/fixtures/scan-envelope.v1.json`                                                                       | SEQUENTIAL | —       | Both a producer-shaped and a consumer-shaped object validate against the schema; an unknown field is preserved, a missing `schemaVersion` is rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **BF-0.1**    | F-01, F-02 | `packages/sync/src/commands/scan/index.ts`, `__tests__/commands/scan/*` (producer test); `apps/web/app/lib/project-scan/cli-hexagen-scan.adapter.ts`, `__tests__/*` (consumer test) | SEQUENTIAL | BF-0.0  | Producer test (`packages/sync`): capture stdout and stderr **separately**; assert the exact final stdout line equals `JSON.stringify` of a `schemaVersion`-bearing envelope object, not merely that some line parses as JSON — the test must fail against C-1 because `runScan` today emits no such line at all, not because a later unrelated line happens to parse. Consumer test (`apps/web`): adapter parses that exact fixture and asserts `reportMarkdown` non-null. **Both test files are named here and both must run in the Quality Gate** (§8) — a change that breaks one side without breaking the other is exactly what BF-0.0 exists to catch, so the gate fails unless both suites executed. |
| **BF-0.2**    | F-03       | `packages/sync/src/commands/scan/index.ts` (flags), `commands/report/index.ts` (call-through)                                                                                       | SEQUENTIAL | BF-0.1  | `scan --handoff` writes a zip containing all 6 entries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **BF-0.3**    | F-04       | `packages/sync/src/commands/scan/index.ts` (`invokeHexagenLint`), `apps/web/app/lib/project-scan/types.ts`                                                                          | SEQUENTIAL | BF-0.2  | Envelope carries `findings.fresh[]` with `{rule,file,specifier,message}`; `ProjectScanResponse.findings` typed and optional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **BF-0.4** 🔒 | F-05, F-06 | `apps/web/app/lib/project-scan/zip-unpack.ts`, `limits.ts`                                                                                                                          | PARALLEL   | —       | (1) A 1-entry bomb whose declared size exceeds `maxEntryBytes` is rejected with the running byte counter never exceeding the limit — assert the peak counter value, not merely that the call throws. (2) A fixture archive with two entries sharing the same normalized path is rejected before either is written — assert zero bytes on disk after the call.                                                                                                                                                                                                                                                                                                                                              |

**BF-0.1 absorbs the former BF-0.2** (envelope and report-path are one contract change; splitting them left an incoherent intermediate state on a hot file). Even so, BF-0.1→0.3 still serialize on `scan/index.ts` — schedule them back-to-back with one worker, not three.

🔒 **BF-0.4 is a security packet, not a normal S.** It fixes a live defect in shipped #558 and **must land before any public Tier A or Tier C traffic**. Refuter panel required. Scope note from verification: zip-slip is _already_ handled — `isUnsafeZipEntry` rejects `..` segments, absolute POSIX/Windows/UNC paths, NUL bytes, and any post-`resolve()` escape, and every entry is validated _before_ the first write. Do not re-implement it. The genuine residuals are (a) the post-inflation `maxEntryBytes` check and (b) duplicate entry names silently last-write-wins.

**F-32 — the shared envelope schema.** `@hexagen/shared` is already a dependency of both `packages/sync` and `tools/arch-linter`, and is in the linter's `global_whitelist`, so it is the one legal home for a type both sides own. The envelope carries an explicit `schemaVersion`; the consumer ignores unknown fields and refuses an unrecognized major. Without this, the CLI↔web contract is dual-owned with no shared type and rots on the first additive change.

### Phase 1 — Neutral-home promotions (C-5 unblock)

Each rewires existing consumers. All touch different files → parallel, but each is a **seam edit → scout first**.

| Packet     | Features | Scope                                                                                                                                                   | Mode       | Depends                               |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------- |
| **BF-1.0** | F-33     | `.husky/pre-commit` — run `validate-ui-boundary.sh` when staged paths touch `apps/web/{features,app}`                                                   | PARALLEL   | —                                     |
| **BF-1.1** | F-24     | move `features/landing/components/ScanResultPanel.tsx` → `apps/web/components/conformance/`; update `ImportScanPage` + tests                            | PARALLEL   | —                                     |
| **BF-1.2** | F-25     | move `features/manifest-generation/useStagedGenerationStream.ts` → `apps/web/app/lib/`; rewire `useStagedManifestGeneration`, `useStagedSpecGeneration` | SEQUENTIAL | **§6.3 — coordinate with Wave D 8.1** |
| **BF-1.3** | F-26     | extract the stage-list half of `ThinkingBlock` → `apps/web/components/StageProgressList.tsx`; `ThinkingBlock` composes it                               | PARALLEL   | —                                     |
| **BF-1.4** | F-27     | move `features/project-wizard/steps/ChipInput.tsx` → `apps/web/components/`; update the two step consumers + `steps/index.ts`                           | PARALLEL   | —                                     |

**BF-1.0 lands first and is not optional.** The plan otherwise relies on every worker voluntarily respecting a check that only runs in CI — which will not survive time pressure. Measured runtime is **5.6s**, too slow to run on every commit, so gate it on staged paths: run only when `git diff --cached --name-only` matches `apps/web/(features|app)/`. This converts C-5 from a discipline problem into a mechanical one.

**Worker note for all of Phase 1:** the move must not add an entry to `CROSS_SLICE_ALIAS_BASELINE` or `NEUTRAL_FEATURE_BASELINE` in `scripts/validate-ui-boundary.sh` — both are shrink-only ratchets. If a promotion appears to need one, the promotion is wrong; stop and report. **BF-1.4 is a promotion, never a copy** — a duplicated `ChipInput` is a silent fork, and the copy will drift from the wizard's version within a release.

### Phase 2 — Primitives

| Packet     | Features | Scope                                                                                                                                                                                        | Mode       | Depends |
| ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------- |
| **BF-2.0** | F-37     | `apps/web/eslint.config.js` (new `components/primitives/**` block); `scripts/validate-ui-boundary.sh` (check 3 walks a new `WEB_PRIMITIVES` path); `apps/web/components/primitives/.gitkeep` | SEQUENTIAL | —       |
| **BF-2.1** | F-28     | `apps/web/components/primitives/EntityDataGrid.tsx` + test                                                                                                                                   | PARALLEL   | BF-2.0  |
| **BF-2.2** | F-29     | `apps/web/components/primitives/ChoiceCardGroup.tsx` + test                                                                                                                                  | PARALLEL   | BF-2.0  |
| **BF-2.3** | F-30     | `apps/web/components/primitives/EmptyState.tsx`, `CountPills.tsx` + tests                                                                                                                    | PARALLEL   | BF-2.0  |

**BF-2.0 lands first and is the whole point of the phase.** It wires `hexagen-ui/no-arbitrary-tailwind-values` (+ the sibling plugin rules) onto `components/primitives/**` and extends firewall check 3 to walk that path, so the forbidden prop names are machine-blocked in the one directory where the new presentation-only components live. Its RED test is a fixture file declaring `status: string` and using `w-[85%]`: the gate must fail on it before the packet is done, and the fixture is deleted in the same PR.

BF-2.1–2.3 are then greenfield files under a covered path → maximal fan-out. No `@hexagen/ui` change ⇒ **no DESIGN.md §9 bump needed**, which was the reason for this siting; BF-2.0 is what makes that trade honest rather than a quiet loss of enforcement.

### Phase 3 — Tier A vertical slice (ships alone; procurement story)

| Packet     | Features   | Scope                                                                                                                                                                                           | Mode       | Depends                |
| ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------- |
| **BF-3.1** | F-14, F-23 | `features/brownfield/` skeleton + `BrownfieldFlow/brownfield-flow-state-machine{,.test}.ts`, `types.ts`; `features/landing/domain/creation-path.ts`; `app/projects/new/name/NameStepClient.tsx` | SEQUENTIAL | —                      |
| **BF-3.2** | F-07       | `app/api/projects/scan/artifacts/route.ts`, `app/lib/project-scan/artifact-parse.ts`                                                                                                            | PARALLEL   | BF-0.4                 |
| **BF-3.3** | F-15       | `features/brownfield/BrownfieldImportPage.tsx`, `views/TierPickerView.tsx`, `views/ArtifactUploadView.tsx`; `app/projects/new/import/artifacts/page.tsx`                                        | SEQUENTIAL | BF-3.1, BF-2.2, BF-1.1 |
| **BF-3.4** | F-34       | `features/brownfield/draft/` — draft persistence via the existing `app/lib/persisted-state.ts` `createPersistedStorage<T>`                                                                      | PARALLEL   | BF-3.1                 |

### The MVP is **not** Phase 3 alone — corrected

The original cut line was wrong, and the adversarial review is right about why. Walk the Tier A user through it: they ran `hexagen scan --handoff` locally, so `manifest.yaml`, `layout.yaml`, and the baseline **already exist on their machine**. Ratification (S3–S5) has already happened — via the CLI. Uploading the zip to see a rendered report and then being offered nothing to _take away_ is a dead end, and shipping it publicly buys support load.

**The real MVP is `Phase 0 + Phase 1 + Phase 2 + Phase 3 + BF-6.1 + BF-6.2`** — artifacts in, report out, **gate bundle downloaded**. The download is the entire procurement story and it is one of the cheapest packets in the plan (`hexagenConformanceActionFiles()` already returns the right shape). BF-6.1/6.2 therefore move into **Wave 3** of the schedule, ahead of all of Phase 4.

Phase 4 (in-browser ratification) is what Tiers B and C need, because there the _server_ ran the scan with `--yes` and nobody has confirmed anything yet. That is a genuine second increment, not MVP scope.

**BF-3.4 (draft persistence) is MVP-scope, not Phase 7.** Verification found the infra already exists — `createPersistedStorage<T>` in `app/lib/persisted-state.ts`, plus `IDBWizardDraftAdapter` as the large-payload precedent. Findings lists run to hundreds of entries, so drafts key on `carriedName` and use IDB above a size threshold, localStorage below it. Without this, a refresh mid-S5 destroys the work; retrofitting it onto a settled reducer later is strictly harder.

### Phase 4 — Ratification

| Packet     | Features | Scope                                                                                                                   | Mode       | Depends                |
| ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------- |
| **BF-4.1** | F-17     | `features/brownfield/LayoutRatify/*` (incl. pure `layout-draft.ts` + test)                                              | PARALLEL   | BF-3.1, BF-2.1, BF-1.4 |
| **BF-4.2** | F-18     | `features/brownfield/ManifestRatify/*`; **export `sanitizeScope`** from `packages/sync/src/commands/bootstrap/index.ts` | SEQUENTIAL | BF-3.1, BF-2.1         |
| **BF-4.3** | F-08     | `app/api/projects/bootstrap/route.ts`                                                                                   | PARALLEL   | BF-4.2 (type only)     |
| **BF-4.4** | F-19     | `features/brownfield/FindingsReview/*` (incl. pure `baseline-draft.ts` + test)                                          | PARALLEL   | BF-0.3, BF-2.1         |

BF-4.1 / BF-4.2 / BF-4.4 own disjoint sub-folders → true parallel fan-out once BF-3.1 lands.

### Phase 5 — GitHub entry + streaming (gated on D-P1)

| Packet     | Features | Scope                                                                                                                 | Mode       | Depends                |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------- |
| **BF-5.1** | F-10     | `apps/web/lib/quota-store.ts` (`QuotaKind`), both scan routes                                                         | SEQUENTIAL | **D-U1**               |
| **BF-5.2** | F-09     | `app/api/projects/scan/github/route.ts`, `app/lib/project-scan/clone.ts`                                              | SEQUENTIAL | BF-5.1, **D-P1**       |
| **BF-5.3** | F-16     | `features/brownfield/views/RepoEntryView.tsx`, `ScanProgressView.tsx`; flip `app/projects/new/import/github/page.tsx` | SEQUENTIAL | BF-5.2, BF-1.2, BF-1.3 |

### Phase 6 — Install the gate

| Packet        | Features | Scope                                                                                                                                                                              | Mode       | Depends          |
| ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------- |
| **BF-6.1**    | F-11     | `packages/project-generation/src/domain/conformance-gate-files.ts` (generalize `hexagenConformanceActionFiles`); `app/api/projects/install-gate/route.ts`                          | SEQUENTIAL | —                |
| **BF-6.2**    | F-21     | `features/brownfield/GateInstall/*`                                                                                                                                                | SEQUENTIAL | BF-6.1, BF-2.2   |
| **BF-6.3** 🔒 | F-12     | `packages/external-integration/src/infrastructure/adapters/github-pull-request.adapter.ts` + port                                                                                  | SEQUENTIAL | BF-6.1, **D-U3** |
| **BF-6.4**    | F-22     | `packages/project-generation/src/domain/sync-integrity-workflow.ts` (comment-script constant); `.github/actions/hexagen-conformance/post-comment.mjs` (this repo's dogfooded copy) | PARALLEL   | —                |

🔒 **BF-6.3 is a security packet.** It opens the product's first repo-_write_ surface beyond the existing publish flow: 3-refuter panel, an explicit threat-model paragraph in the PR body, and a kill switch (env-gated, default off) that survives D-U3.

**One correction to the review on this point:** a feature flag does not "leave the token in the session" as a new risk — the `repo workflow` scope is **already granted today** (`app/lib/auth.ts`) and is already used by `/api/export/github`. BF-6.3 adds a new _use_ of an existing token, not a new grant. That makes the flag meaningful (it bounds the new surface) while correctly locating the standing risk: it predates this plan and belongs to the GitHub-App migration, not here.

**BF-6.4 owns both files, not just the constant** — the constant and the dogfooded copy at `.github/actions/hexagen-conformance/post-comment.mjs` have already drifted (0.11.0 vs 0.10.0 headers). Its RED test is a byte-comparison of the two: fails today on the header-comment mismatch, passes once BF-6.4 makes the dogfooded copy re-derive from the constant (or an explicit, tested equality check) rather than existing as an independent hand-maintained file.

### Phase 7 — Report + persistence

| Packet     | Features   | Scope                                                                            | Mode       | Depends        |
| ---------- | ---------- | -------------------------------------------------------------------------------- | ---------- | -------------- |
| **BF-7.1** | F-13       | `apps/web/lib/platform/{platform-db.ts,scan-records-store.ts,store.ts,index.ts}` | SEQUENTIAL | —              |
| **BF-7.2** | F-31, F-20 | `apps/web/components/RatchetSparkline.tsx`; `features/brownfield/Report/*`       | SEQUENTIAL | BF-7.1, BF-4.4 |

---

## 5. Dependency DAG and fan-out schedule

```text
WAVE 0  BF-0.0 (schema) · BF-1.0 (pre-commit gate)  ── land these two first

WAVE 1  (4 concurrent — the cap)
  BF-0.1 ──▶ BF-0.2 ──▶ BF-0.3 ────────────────────┐
  BF-0.4 ───────────────────────────┐              │
  BF-1.1 ──┐                        │              │
  BF-1.3 ──┤                        │              │
                                    │              │
WAVE 2                              │              │
  BF-1.4 ──┤                        │              │
  BF-2.0 ──▶ BF-2.1 ──┐             │              │
          └─▶ BF-2.2 ─┤             │              │
          └─▶ BF-2.3 ─┘             │              │
  BF-3.1 ─────────┼─────┐           │              │
                  │     │           │              │
WAVE 3            │     │           │              │
  BF-3.2 ◀────────┼─────┼───────────┘              │
  BF-3.3 ◀────────┴─────┤                          │
  BF-3.4 ◀──────────────┤                          │
  BF-6.1 ───────────────┤                          │
  BF-6.2 ◀── BF-6.1     │     ◀══ MVP SHIPS HERE   │
                        │                          │
WAVE 4                  │                          │
  BF-4.1 ◀──────────────┤                          │
  BF-4.2 ◀──────────────┤                          │
  BF-4.4 ◀──────────────┴──────────────────────────┘
  BF-4.3 ◀── BF-4.2
  BF-6.4  (independent — schedule opportunistically)

WAVE 5   BF-5.1 ⇐ D-U1 ──▶ BF-5.2 ⇐ D-P1 ──▶ BF-5.3 ⇐ BF-1.2
WAVE 6   BF-6.3 ⇐ D-U3 (security packet)
WAVE 7   BF-7.1 ──▶ BF-7.2
```

**Concurrency:** ≤4 open `wave-*`-labeled PRs, per the standing rule. Wave 2 has six ready packets — run them 4-at-a-time, ordering `BF-3.1` first because three Wave-4 packets gate on it. **Wave 0 is a hard prerequisite**: BF-0.0 fixes the contract's ownership before anyone writes to it, BF-1.0 makes the boundary check mechanical before Phase 1 starts moving files across slices.

**Branch naming:** `wave-bf-<packet>` (e.g. `wave-bf-3.1`), matching the existing `wave-b-8.12h` family. Commit subject quotes the packet ID: `feat(web): BF-3.1 brownfield flow skeleton + state machine`.

---

## 6. Delegation kit

### 6.1 Worker governance block — this arc's addendum

Prepend the standard `[GLOBAL GOVERNANCE]` block from `docs/planning/2026-08-14-architecture-remediation-implementation-prompt.md` §8, then add:

```text
[BROWNFIELD ARC ADDENDUM]
- DESIGN.md is binding and must be read before any UI edit. No inline styles.
  No arbitrary Tailwind values except `active:scale-[0.98]`. Spacing only from
  {1,2,3,4,6,8,12,16}. Focus ring on every interactive element.
- Import NoSemanticState from "@hexagen/ui", NOT "@hexagen/ui/types" —
  the ./types subpath does not exist despite DESIGN.md §3.4's example.
- NEVER import across apps/web/features/* slices. CI check 6 in
  scripts/validate-ui-boundary.sh fails it, and both its baselines are
  shrink-only. Before BF-1.0 lands, pre-commit does NOT run this check —
  a violation only surfaces in CI. After BF-1.0, it runs locally for staged
  apps/web/{features,app} paths. Either way: if you need a component from
  another slice, STOP and report — it needs a promotion packet.
- New shared components go in apps/web/components/ with domain-specific names
  (DESIGN.md §3.2: EntityDataGrid, never Table/List/Box).
- Do not add a "loading"/"status"/"error"/"data"/"isPending" prop to any
  component you create. Those 11 names are the forbidden set.
- Group findings dynamically over BaselineEntry.rule (an open string).
  Never hardcode a rule-id list — there are 10 today and the set grows.
- Tests: vitest + @testing-library/react, node:assert/strict or expect().
  Run apps/web tests as `yarn workspace web test`.
```

### 6.2 Per-packet worker contract

Every packet's prompt must carry, verbatim:

1. **Scope fence** — the exclusive file list from §4. Touching anything outside it is a stop-and-report.
2. **Failing-first** — write the RED test before the fix; it must fail on old behavior, pass on new.
3. **No gates in the worktree** — no `node_modules`; stage the diff and report. Primary runs `yarn build && yarn typecheck && yarn lint && yarn test` from main.
4. **Never** `git commit`, never edit `.architecture/**`, never run `yarn lint:arch`.
5. **Report shape** — files changed, RED test name + the failure it produced, anything refused and why.

### 6.3 The one real collision

**BF-1.2 vs Wave D item 8.1.** 8.1 ("NDJSON stream reducer as pure functions + table tests; hook binds reducer to fetch") rewrites the same hook BF-1.2 moves, and 8.1 is itself gated on 7.1 which is gated on 8.12(h). Two options, and this is a **decision, not a default**:

- **(a) Land BF-1.2 first as a pure move** (no logic change), so 8.1 later refactors it in its new home. Cheap; 8.1 absorbs a path change.
- **(b) Fold the promotion into 8.1** and block BF-5.3 until Wave D reaches 8.1.

Recommendation: **(a)** — BF-1.2 as a pure `git mv` + import rewiring, explicitly labeled "no behavior change", with the 8.1 owner notified in the PR body. It keeps Phase 5 off Wave D's critical path.

### 6.4 Scouts required before the worker exists

Read-only `Explore` sub-agents, no worktree: **BF-1.2** (every consumer of the stream hook, including test files), **BF-4.2** (`sanitizeScope` export — confirm no name collision in the sync barrel), **BF-6.1** (every consumer of `hexagenConformanceActionFiles` before generalizing its signature), **BF-7.1** (the `migrateSavedProjects` vs index-ordering constraint in `platform-db.ts`).

---

## 7. Decision gates

| Gate             | Question                                             | Recommendation                                                                                                                                                    | Blocks         |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **D-P1**         | Ship the `hexagen` CLI in the prod image             | Yes — #558 is dead in prod without it                                                                                                                             | BF-5.2, BF-5.3 |
| **D-U1**         | Anon public-clone quota policy                       | New `"scan"` `QuotaKind` + per-IP `checkRateLimit`; **not** the frozen ADR-0063 route files                                                                       | BF-5.1         |
| **D-U2**         | Tier B private-repo clone at all?                    | Post-MVP, labeled "not for client engagements"                                                                                                                    | —              |
| **D-U3**         | S7b OAuth PR despite all-repos scope optics?         | Keep for self-owned repos with an explicit warning; GitHub App is the real answer                                                                                 | BF-6.3         |
| **D-B1** _(new)_ | BF-1.2 vs Wave D 8.1 sequencing                      | Option (a) — pure move first                                                                                                                                      | BF-5.3         |
| **D-B2** _(new)_ | Do the Phase-2 primitives graduate to `@hexagen/ui`? | Not now — revisit when a second app needs them; graduation costs a DESIGN.md §9 bump                                                                              | —              |
| **D-B3** _(new)_ | Is the MVP public, or internal/preview-labelled?     | Public **only with BF-6.2** (gate download) included — otherwise the flow ends with nothing to take away. If shipped earlier, label it "preview — artifacts only" | BF-3.3 release |
| **D-B4** _(new)_ | Does the gate zip carry a `package.json` patch?      | Ship a `HEXAGEN-GATE-INSTALL.md` with the exact scripts + `packageManager` pin to add; do **not** auto-patch a foreign `package.json`                             | BF-6.1         |

---

## 8. Verification

Per packet: failing-first RED→GREEN · inverse-edit restores (never `git checkout` — it has eaten uncommitted work here before) · Primary runs `yarn build && yarn typecheck && yarn lint && yarn test` from the main checkout, quoting the suite count in the landing record. **Packets that touch the scan envelope (BF-0.1–0.3) additionally require both the `packages/sync` producer test and the `apps/web` consumer test named in BF-0.1 to have run — the gate fails, not warns, if either suite was skipped.**

UI packets additionally require:

```bash
bash scripts/validate-ui-boundary.sh     # cross-slice + neutral-home gates
node scripts/check-lint-coverage.mjs
yarn workspace web test
```

**Pre-commit coverage, precisely — this is the one place BF-1.0 changes what "the pre-commit hook runs" means, and every other reference to it in this plan (§0 C-5, §6.1's governance addendum) describes the state _before_ BF-1.0 lands:**

| Check                     | In pre-commit before BF-1.0 | In pre-commit after BF-1.0                                |
| ------------------------- | --------------------------- | --------------------------------------------------------- |
| `validate-ui-boundary.sh` | No                          | **Yes — gated on staged `apps/web/{features,app}` paths** |
| `check-lint-coverage.mjs` | No                          | No — CI-only, workspace-addition scope only               |
| `yarn workspace web test` | No                          | No — deliberately kept CI-only; too slow for every commit |

Once BF-1.0 lands, only `check-lint-coverage.mjs` and the web test suite remain CI-only; `validate-ui-boundary.sh` no longer needs a Primary to remember it.

Packets touching `packages/sync` or `tools/arch-linter` (published surface — BF-0.1…0.3, BF-4.2):

```bash
node scripts/verify-publish-test-scope.js --task typecheck:test packages/sync tools/arch-linter
yarn turbo run build --filter=@hexagen/arch-linter && yarn lint:arch
```

Refuter panel (2–3 parallel agents prompted to _refute_) on: BF-0.3 (contract shape), BF-5.2 (clone bounding), BF-6.3 (new GitHub write path).

---

## 9. Cross-cutting requirements

These were absent from rev 1 and are the kind of thing that gets invented three different ways by three different workers. Each is binding on every packet that touches its surface.

**Error taxonomy (F-35).** One typed code set spanning CLI → route → UI, modelled on the existing `GithubPublishErrorCode` + `mapGithubPublishFailure` pattern (snake_case on the wire, kebab-case internal — the split ADR-0046 records). Codes: `clone_failed · repo_too_large · quota_exhausted · scan_could_not_run · invalid_archive · archive_too_large · timeout · reauth_required`. One renderer maps code → message; **no route invents its own prose.** The existing `FetchJsonResult<T>` union is the transport.

**Observability (F-36).** `runId` (crypto.randomUUID) on every NDJSON frame and in every route log line, matching what `persistStageTelemetry` already does. Counters: scan duration by tier, failure rate by error code, quota-hit rate. Without this, a Tier B failure in prod is unanalysable — the container's stdout is all there is.

**Accessibility.** Binding on BF-2.1/2.2/2.3 and every screen: `EntityDataGrid` is a real `<table>` with `<caption>`, `scope` on headers, and no `role="grid"` unless full grid keyboard semantics are implemented — a fake grid role is worse than none. `ChoiceCardGroup` is `role="radiogroup"` with arrow-key roving (the `PublishSettingsDialog` pattern). S5's per-rule disclosures use the existing `Accordion`, whose triggers must be wrapped in a heading element by the consumer (the component does not do it — see `PlanWorkbench` for the correct `<h2>` wrapping). Every interactive element carries the DESIGN.md §4.8 focus ring. The sticky S5 footer count is an `aria-live="polite"` region.

**Viewport.** S3 and S5 are the two dense screens. Below `md`, `EntityDataGrid` collapses to stacked cards rather than scrolling horizontally; the page body must never scroll sideways. This is a requirement on BF-2.1, not an afterthought for the screens.

**Feature flags.** Env-gated, default-off kill switches on the two new external surfaces: `BROWNFIELD_GITHUB_SCAN` (BF-5.2) and `BROWNFIELD_GATE_PR` (BF-6.3). Tier A needs no flag — it executes nothing and writes nothing outside a tmpdir.

**Contract tests.** The BF-0.0 golden fixture is run by **both** `packages/sync` and `apps/web` test suites. A change to the envelope that breaks either side fails in both places, which is the entire point.

---

## 10. Risks and what this plan does not do

- **`.architecture/layout.yaml` does not exist in this repo** — it is a foreign-repo feature. No packet may reference it as a local file; the repo's own layout knowledge is `workspace.config.yaml` + `.architecture/apps/web.app.yaml`.
- **Branch protection is still off.** Every gate above is informational until an owner enables it — a worker's green report is not a merge guarantee.
- **The e2e suite is one file with no CI workflow and no `e2e` script.** Do not size any packet on Playwright coverage.
- **Not built here:** GitHub App tenancy (blocked on hosting H1), org-keyed ScanRecords, GitLab/Bitbucket, in-browser clone, VS Code extension, persistent server-side repo mirrors.
- **Deploy and release remain owner-gated.** BF-5.2 lands as code; shipping it needs D-P1's image change, which is `deploy.yml`-adjacent.

---

## 11. Review adjudication — round 2

Two review passes (constructive, then adversarial) against rev 1. Each claim was checked against the tree before acceptance; the repo's standing rule is that a review's say-so is not evidence.

| #    | Claim                                                                          | Verdict                                  | Action                                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | Phase 0 serializes three packets on `scan/index.ts`                            | **Accepted**                             | BF-0.1 absorbs former BF-0.2; chain is now 0.1→0.2→0.3 with one worker, and BF-0.0 lands the schema first                                                                                                                                                                                                                                 |
| R-2  | CLI↔web envelope is dual-owned, unversioned, untested                          | **Accepted — best finding of the round** | New BF-0.0: schema in `@hexagen/shared` (verified: already a dependency of both `packages/sync` and `tools/arch-linter`, and in the linter's `global_whitelist`) + `schemaVersion` + golden fixture run by both suites                                                                                                                    |
| R-3  | Phase 3 is a technical slice, not a product MVP                                | **Accepted**                             | Correct, and for a sharper reason than stated: Tier A users already ratified via the CLI, so without a gate bundle the flow ends with nothing to take away. BF-6.1/6.2 moved into the MVP and into Wave 3                                                                                                                                 |
| R-4  | BF-0.4 under-emphasised for a live security defect                             | **Accepted**                             | Marked 🔒, refuter panel, explicit "land before any public Tier A/C traffic"                                                                                                                                                                                                                                                              |
| R-5  | Zip handling still open to path traversal, absolute paths, `..`, symlinks, NUL | **Refuted**                              | `isUnsafeZipEntry` already rejects `..` segments, absolute POSIX/Windows/UNC paths, NUL bytes, and post-`resolve()` escapes, and validates **every entry before the first write**. JSZip writes via `writeFile`, so no symlink is materialised. Real residuals — post-inflation cap, duplicate-name last-write-wins — are named in BF-0.4 |
| R-6  | No streaming partial-failure design                                            | **Accepted**                             | Six-row failure table added to §1.3 S2; last-good partial written to the draft store on every `stage-complete`                                                                                                                                                                                                                            |
| R-7  | Drafts live only in a client reducer until Phase 7                             | **Accepted, cheaper remedy**             | Infra already exists (`app/lib/persisted-state.ts` `createPersistedStorage<T>`, `IDBWizardDraftAdapter`). New BF-3.4 in the **MVP**, not Phase 7                                                                                                                                                                                          |
| R-8  | Cross-slice discipline relies on worker perfection against a CI-only check     | **Accepted**                             | New BF-1.0 puts `validate-ui-boundary.sh` in `.husky/pre-commit`, gated on staged `apps/web/{features,app}` paths (measured 5.6s — too slow unconditional, fine when scoped)                                                                                                                                                              |
| R-9  | BF-6.3 treated as a normal packet; OAuth token is a landmine                   | **Accepted with correction**             | Marked 🔒 with refuter panel, threat model, and a default-off flag. **Correction:** the `repo workflow` scope is already granted today and already used by `/api/export/github` — BF-6.3 adds a new _use_, not a new grant. The standing risk predates this plan and belongs to the GitHub-App migration                                  |
| R-10 | "Never leaves your machine" is an absolute claim                               | **Accepted**                             | S1 copy now says what _does_ leave: file paths, package names, rule findings                                                                                                                                                                                                                                                              |
| R-11 | ChipInput "promoted or copied" is softer than elsewhere                        | **Accepted**                             | Promotion is mandatory; a copy is a silent fork                                                                                                                                                                                                                                                                                           |
| R-12 | No error taxonomy / observability / a11y / flags / contract tests / mobile     | **Accepted**                             | New §9, binding per-surface                                                                                                                                                                                                                                                                                                               |
| R-13 | Gate zip should carry a `package.json` patch                                   | **Accepted as a gate**                   | D-B4 — ship `HEXAGEN-GATE-INSTALL.md`; never auto-patch a foreign `package.json`                                                                                                                                                                                                                                                          |
| R-14 | If D-P1 slips, GitHub path is blocked while Tier A is live                     | **Accepted**                             | That window is now the _designed_ MVP (Tier A + gate download), not an accident                                                                                                                                                                                                                                                           |
| R-15 | Tier B lint cost is unbounded even for small repos                             | **Partially accepted**                   | The wall-clock kill already bounds it; the size preflight bounds bytes. Named explicitly in the S2 failure table rather than given a new control                                                                                                                                                                                          |
| R-16 | S3/S5 cognitive load; baseline reasons are opaque to non-experts               | **Deferred, logged**                     | Real, but a copy/onboarding problem best solved against a working flow. Not scoped into a packet; revisit after the first FDE trial                                                                                                                                                                                                       |

### Round 3 — PR #564 human review comment

| #    | Claim                                                                                                                                                                                      | Verdict                                                | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-17 | C-1/C-2/C-3 independently reproduced against the source tree                                                                                                                               | **Confirmed by a second party**                        | No change. The critical path (BF-0.1→0.3) stands on verified ground                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| R-18 | The new `apps/web/components/` primitives must honour the forbidden prop names from inception so they can be promoted to `@hexagen/ui` later; "requires strict enforcement during Phase 2" | **Accepted, and the finding is sharper than reported** | Verification showed `apps/web/components/` is covered by **neither** enforcement layer: ESLint's `hexagen-ui` rules bind `app/**` and `features/**` only, and firewall check 3 walks `packages/ui/src` alone. Two pre-existing `w-[85%]` values in `components/chat/ChatMessageList.tsx` have never been flagged. Rather than rely on Phase-2 discipline, **new BF-2.0** sites the primitives in a greenfield `components/primitives/` and scopes both layers to it — zero legacy blast radius. Scoped to a sub-directory deliberately: a blanket check would false-positive on `ErrorBoundary`'s `error` prop, which DESIGN.md explicitly sanctions for boundary components |

### Round 4 — PR #564 bot review (CodeRabbit + Qodo)

Both bots reviewed commit `b8391435` only — Qodo submitted at 22:48:55Z, CodeRabbit at 22:51:55Z, both before commit `76588281` landed at 22:54:49Z. Three CodeRabbit comments carry an automatic "✅ Addressed in commit 7658828" annotation from its own incremental diff-tracking; each was independently re-verified against the current tree rather than trusted, per house rule (adjudicate bots, never act on say-so alone).

| #    | Source     | Claim                                                                                                                                                                                                                            | Verdict                                                                                                                                                                                                                                                                                                              | Action                                                                                                                                                                                                                                                                                                          |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-19 | Qodo       | Embedded NUL byte in `docs/planning/2026-08-20-brownfield-ui-plan.md`, in the phrase `rule\0file\0specifier`                                                                                                                     | **Confirmed** — a byte-level scan found exactly 2 literal NUL bytes (not the two-character escape sequence some tools would render), left over from an earlier Python string-replacement in this same session. `grep -c` had false-negatived on it, which is itself a small lesson in why the check matters          | Replaced with `rule·file·specifier` in both the byte stream and, going forward, in how that phrase gets written                                                                                                                                                                                                 |
| R-20 | Qodo       | `apps/web.app.yaml` should read `.architecture/apps/web.app.yaml`                                                                                                                                                                | **Confirmed** — `ls .architecture/apps/web.app.yaml` exists; no file at the bare path                                                                                                                                                                                                                                | Path corrected in §9's risks list                                                                                                                                                                                                                                                                               |
| R-21 | CodeRabbit | MD040: 9 fenced blocks (route maps, wireframes, the DAG, the governance block) have no language tag                                                                                                                              | **Confirmed** — all 9 are ASCII diagrams or plain prose, none are executable code                                                                                                                                                                                                                                    | Tagged ` ```text `                                                                                                                                                                                                                                                                                              |
| R-22 | CodeRabbit | F-05/F-06's "small per-entry/total caps" is too qualitative for a security-marked packet's RED tests                                                                                                                             | **Accepted** — the packet is 🔒-marked precisely because vague limits produce untestable RED tests                                                                                                                                                                                                                   | F-06 now reads `maxEntries: 8, maxEntryBytes: 1 MiB, maxUncompressedBytes: 4 MiB`; BF-0.4's RED test column names both bounds explicitly                                                                                                                                                                        |
| R-23 | CodeRabbit | BF-0.0 owns only the shared schema; no packet explicitly assigns the both-suite consumer test files or asserts the gate fails if either suite didn't run                                                                         | **Accepted — auto-"Addressed" annotation was wrong.** Commit `76588281` never touched this region                                                                                                                                                                                                                    | BF-0.1's scope column now names the producer test file (`packages/sync`) and the consumer test file (`apps/web`) explicitly, and states the Quality Gate fails unless both ran; §8 carries the same assertion                                                                                                   |
| R-24 | CodeRabbit | BF-0.1's RED test ("last stdout line containing `{` parses") can pass on an unrelated log line rather than failing specifically against C-1                                                                                      | **Accepted** — a real precision gap. The old wording would go green if any later JSON-shaped line appeared in output, for the wrong reason                                                                                                                                                                           | Rewritten to require stdout/stderr captured separately and the exact final line asserted equal to the envelope, explicitly noting the test must fail against C-1 because `runScan` emits no such line today, not because a coincidental line happens to parse                                                   |
| R-25 | CodeRabbit | BF-0.4 names duplicate entry names as a residual defect but its one RED test covers only inflation, not overwrite                                                                                                                | **Accepted** — a real test-coverage gap on a security packet. Two entries sharing a normalized name could silently overwrite `manifest.yaml` or the baseline                                                                                                                                                         | Added a second RED test bullet: two same-named entries reject before either is written, asserted via zero bytes on disk. F-05's description updated to name the duplicate-rejection fix, not just streaming                                                                                                     |
| R-26 | CodeRabbit | BF-1.0 says pre-commit will run `validate-ui-boundary.sh`; §8 says the pre-commit hook runs none of the listed UI checks — contradiction                                                                                         | **Accepted — auto-"Addressed" annotation was wrong.** Commit `76588281` never touched §8 or BF-1.0's text; the contradiction was real and still present after that commit                                                                                                                                            | §8 now carries a before/after BF-1.0 table for exactly which checks run in pre-commit. The governance addendum (§6.1) updated the same way so it doesn't go stale the moment BF-1.0 lands                                                                                                                       |
| R-27 | CodeRabbit | BF-6.4 owns only the `sync-integrity-workflow.ts` constant, but its own caveat says the dogfooded `post-comment.mjs` copy has already drifted and must change too — scope/prose mismatch                                         | **Accepted** — a worker following the scope fence literally would leave the documented drift unfixed                                                                                                                                                                                                                 | `post-comment.mjs` added to BF-6.4's scope; RED test is a byte-comparison of the two copies, failing today on the header mismatch                                                                                                                                                                               |
| R-28 | CodeRabbit | Wave 2 text claims "six ready packets" but only five were listed (`BF-1.4, BF-2.1, BF-2.2, BF-2.3, BF-3.1`)                                                                                                                      | **Confirmed, but already fixed — auto-"Addressed" annotation was correct here.** Adding BF-2.0 in commit `76588281` (for R-18) brought Wave 2 to six packets as a side effect                                                                                                                                        | No further action; noted here so the count's correctness isn't accidental-looking in the historical record                                                                                                                                                                                                      |
| R-29 | CodeRabbit | The two docs describe the scan-handoff command and entry count differently (`hexagen scan` vs `hexagen scan --handoff`; 4 items vs 6-file claim vs 5 labels)                                                                     | **Accepted — a real, and the most consequential, cross-doc drift.** The decision plan's command and entry description predated this doc's corrections and were never synced back                                                                                                                                     | Decision plan's tier table now names the real command (with the BF-0.2 dependency and today's `hexagen report --handoff` fallback) and the correct 5-label/6-entry set; this doc's S1 wireframe dropped the specific "6-file" claim in favor of the label list alone, since a user doesn't need the exact count |
| R-30 | CodeRabbit | The parent plan's NDJSON event list (`stage-start\|stage-complete\|stage-telemetry`) and this doc's use of `chunk`/`error` frames look like two different contracts                                                              | **Accepted, low severity** — both events already exist in the hook's real parsed union; nothing was invented, but the parent plan's abbreviated list read as a mismatch                                                                                                                                              | Parent plan's S2 line now states the full 8-event union once and names which subset S2 actually uses                                                                                                                                                                                                            |
| R-31 | CodeRabbit | The two docs assign different fields to `BootstrapAnswers` (this doc's `{system, scope, architecture, contexts[]}` vs the parent plan's version, which folds in `stdinJson`/`force`/`skipLayout`)                                | **Accepted — real factual error in the parent plan.** Those three fields belong to `BootstrapOptions` (CLI invocation controls), not the answers payload; this doc already had it right                                                                                                                              | Parent plan's S4 line corrected to separate the payload from the invocation options, and to say the API route sets the options server-side                                                                                                                                                                      |
| R-32 | CodeRabbit | The parent plan requires a `findings.json` file with `{rule, file, specifier, layer}`; this doc's F-04 only carries four of the six `hexagen-lint --json` categories, dropping `introduced`/`baselineGrowth` without explanation | **Accepted — the parent plan's CLI-1 description was stale fiction, predating the exploration that found the real `--json` contract.** This doc's four-field choice was already correct and deliberate — `introduced`/`baselineGrowth` are PR-diff-only fields with no base branch to diff against on a first import | Parent plan's CLI-1 row rewritten to match the verified `hexagen-lint --json` shape and explain why the two PR-diff fields are excluded from the scan envelope, rather than silently differing from this doc                                                                                                    |
