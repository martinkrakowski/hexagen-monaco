# ADR-0068: Published CLI Bundling Strategy

**Date:** 2026-04-25  
**Status:** ✅ Accepted  
**Renumbered:** from ADR-0009 on 2026-08-23 — the number was shared with ADR-0009 (Driver-Context Wiring Strategy, 2026-04-05), which is older and keeps it.  
**Supersedes:** None  
**Superseded By:** None  
**Drivers:** `@hexagen/sync` npm publishing requirement  
**Related:** AGENTS.md §Module Resolution; Phase 6 work plan

---

## Problem Statement

`@hexagen/sync` is scheduled for npm publication and consumption by generated HexaGen projects:

```bash
npm install @hexagen/sync
npx hexagen …  # from generated project
```

At publication and consumption, Node.js ESM module resolution takes over. Two architectural approaches exist:

### Approach 1: Monorepo-Wide NodeNext Migration

- Flip `tsconfig.base.json`: `moduleResolution: bundler` → `nodeNext`
- Add `.js` extensions to ~900 source files across 28 packages
- Transitive dependencies (`@hexagen/governance`, `@hexagen/project-configuration`, etc.) published separately
- Consumers `npm install` 5+ `@hexagen/*` packages
- Aligns with "all TypeScript should use the same module resolution"

**Concerns:**

- Reverses AGENTS.md policy (codifies `bundler` for app-consumed packages)
- No rationale in AGENTS.md for reversal (would require new ADR)
- 28-package divergence creating per-package extension hygiene burden
- Transitive dependency fragility (consumers might have version mismatches)
- Massive blast radius (900 files); high review risk
- Solves a theoretical "consistency" problem, not a runtime problem

### Approach 2: Targeted Bundling with `tsup` (Selected)

- Keep `moduleResolution: bundler` for app-consumed packages
- Use `tsup` to bundle `@hexagen/sync` (+ its workspace deps) into single artifact
- Publish one package: `@hexagen/sync` (no `@hexagen/governance`, etc. exposed)
- Zero source-file modifications; 1 package tooling change
- Consumers install one bundle; transitive deps hidden inside

**Benefits:**

- Preserves AGENTS.md dual-resolution policy
- Industry standard: Vercel AI SDK, Biome, Drizzle, Vitest, Astro CLI, Turborepo all do this
- Simplifies consumer experience (1 package, not 5)
- Version stability (bundled at build-time)
- Smaller supply-chain surface

---

## Decision

**We adopt Approach 2: Targeted Bundling with `tsup`.**

### Rationale

1. **Deployment Reality:** The monorepo has two runtime profiles:
   - `apps/web` (Next.js) → webpack bundles everything; `bundler` resolution is correct
   - `@hexagen/sync` (CLI) → direct Node execution; publishing requires ESM-valid bundle

   Approach 1 optimizes for a consistency impulse over deployment reality.

2. **AGENTS.md Alignment:** The existing Module Resolution policy is architecturally sound:

   ```
   | Package    | Resolution | Why                                    |
   | ---------- | ---------- | -------------------------------------- |
   | sync (CLI) | bundler    | Source stays bundler; tsup emits ESM   |
   | All others | bundler    | Consumed via bundled webpack context |
   ```

   Footnote (2026-08-17): an earlier draft of this table listed `sync (CLI) | NodeNext`. That row described Approach 1, which this ADR rejected. The selected approach keeps **source** at `moduleResolution: bundler` / `module: Preserve` (`packages/sync/tsconfig.json`); NodeNext remains only on `packages/sync/tsconfig.test.json`, plus the other Node-executed workspaces `apps/tui` and `tools/arch-linter` (see the 2026-08-17 amendment on ADR-0050). AGENTS.md's Module Resolution appendix is the same policy.

   Reversing this requires new architecture justification. We have none.

3. **Industry Precedent:** Published TypeScript CLIs universally use bundling strategies
   (esbuild, tsup, webpack, swc) rather than source-level module-resolution config. This
   is how the TS ecosystem solved the "how do we publish one CLI?" problem.

4. **Risk Profile:** Approach 1 (900-file refactor) carries higher regression risk:
   - Edge cases in directory imports (`./dir` → `./dir/index.js`)
   - `package.json#exports` field interactions
   - Test runner configuration drift
   - Transitive TypeScript version issues

   Approach 2 (1-package bundler swap) is lower-risk, faster, reversible.

5. **Developer DX:** Approach 2 preserves the monorepo's _current_ development experience.
   Developers keep writing code as-is; only the build output changes. Approach 1 forces
   `.js` extension discipline across 900 files forever.

---

## Solution Design

### Scope

**In Scope:**

- Replace `@hexagen/sync` build: `tsc` → `tsup`
- Add `tsup.config.ts` with entry points (`cli`, `index`)
- Inline workspace dependencies into output
- Preserve binary redirection (`bin: hexagen → dist/cli.js`)
- Emit `.d.ts` bundle + source maps
- Update `AGENTS.md` Module Resolution appendix (reference this ADR)

**Out of Scope:**

- Flipping other packages to NodeNext
- Publishing to npm registry (separate CI job)
- Retiring `scripts/fix-esm-barrels.js` (proven post-build tool; keep for now)
- Modifying source code in dependency-tree packages

### Implementation

1. **Phase 6a:** Add `tsup` to `@hexagen/sync`; create `tsup.config.ts`; swap build script
2. **Phase 6b:** Validate `yarn workspace @hexagen/sync build` produces correct bundle
3. **Phase 6c:** Smoke test: `npm pack` → install in fixture → `npx hexagen --help`
4. **Phase 6d:** Document bundle layout in `packages/sync/README.md`
5. **Phase 6e:** Full CI validation; commit

### Key Config Decisions

| Setting     | Value    | Rationale                                              |
| ----------- | -------- | ------------------------------------------------------ |
| Format      | ESM only | Consumers expect `"type": "module"` in package.json    |
| Target      | `ES2022` | Matches monorepo `tsconfig.base.json`                  |
| Minify      | No       | Source maps + CI builds large; unnecessary for a CLI   |
| Source maps | Yes      | Aid debugging if consumers report issues               |
| dts bundler | true     | Single `index.d.ts` + `cli.d.ts`; easier for consumers |
| external    | `[]`     | Inline everything; `commander`, `js-yaml` bundled      |
| define      | —        | No runtime feature-flag requirements                   |

---

## Alternatives Considered

### Alternative 1: TypeScript-only + `tsc-alias` Post-Build

Keep `tsc`, run `tsc-alias` to fix imports. Similar to current `fix-esm-barrels.js`.

**Rejected:** Requires understanding which files need fixing; regex-based approach has edge-case fragility. Bundling is cleaner.

### Alternative 2: Dual CJS/ESM Publish

Ship both CommonJS and ESM bundles with conditional `exports`.

**Rejected:** Adds complexity (two build outputs, test matrix). Consumers almost universally prefer pure ESM for modern projects. Unnecessary.

### Alternative 3: Monorepo-Wide NodeNext (Original Plan)

See "Problem Statement."

**Rejected:** Reverses policy; 900-file blast radius; no deployment justification.

---

## Consequences

### Positive

✅ `@hexagen/sync` can be published to npm and consumed as a single, self-contained package  
✅ No reversal of AGENTS.md policy; no new architectural inconsistency  
✅ Zero impact on non-sync packages (bundler resolution unchanged)  
✅ Aligns with industry best practice for published CLIs  
✅ Smaller supply-chain surface for consumers (1 package vs. 5)  
✅ Version stability (bundled at build-time)  
✅ Reversible if `tsup` introduces issues (revert to `tsc` + post-build script)

### Negative

⚠️ Published bundle is opaque (harder to debug in consumer context) — mitigated by:

- Source maps included in tarball
- Clear documentation of bundled packages in README
- Running sync from source in dev (easier than publishing)

⚠️ Build script differs from other packages (special case) — mitigated by:

- Well-documented in ADR (this file)
- Marked in `AGENTS.md` as "published CLI exception"
- Isolated to one package (no contagion to others)

⚠️ If workspace deps must patch separately, consumers get stale transitive code — mitigated by:

- Bundling at publish-time pins exact versions
- Bug fixes require new `@hexagen/sync` version publish (standard practice)
- No worse than any other published package

---

## Validation Criteria

The decision is validated when:

1. ✅ `yarn workspace @hexagen/sync build` produces correct ESM bundle
2. ✅ `node packages/sync/dist/cli.js --help` executes successfully
3. ✅ `npm pack` → install in fixture → `npx hexagen --help` works
4. ✅ Fixture project has `@hexagen/sync` only (no transitive `@hexagen/*` packages)
5. ✅ Full monorepo CI (`build`, `typecheck`, `test`) passes
6. ✅ AGENTS.md policy remains dual-resolution (no reversal)

---

## Follow-Up Actions

### Immediate (Phase 6)

- Implement Phase 6a–6e as per work plan
- Update `AGENTS.md` with reference to this ADR

### Later (Separate Ticket)

- **Retire `scripts/fix-esm-barrels.js`?** After sync bundling is proven, evaluate whether
  `@hexagen/project-configuration` still needs the post-build fixer (unlikely if only
  used internally). Separate cleanup ticket.
- **npm publish pipeline:** Implement CI job to publish `@hexagen/sync` on git tag.
  Separate release engineering ticket.
- **Generated project integration tests:** End-to-end tests for `npx hexagen` in generated
  project context. Separate QA ticket.

---

## Amendment (2026-06 — second published package: `arch-linter`)

**Status:** ✅ Accepted · **Context:** installable-scaffold plan, Item 0

The original decision published exactly one artifact (`@hexagen/sync`, tsup-bundled).
This amendment permits a **second co-released package, `@hexagen-monaco/arch-linter`**.

**Why an exception is warranted.** A generated project's root scripts call
`hexagen arch validate`, which historically shelled out to
`yarn workspace @hexagen/arch-linter lint:arch` — impossible outside this
monorepo. The two clean options were (a) inline arch-linter into `@hexagen/sync`
or (b) publish it separately. (a) requires relocating the `Manifest` type out of
`sync` to break a circular import, reconciling `ts-morph` `^22` ↔ `^27`, and
absorbing `chalk`/`lodash`/`zod` into the sync bundle. (b) avoids all of that at
the cost of one more published package.

**Decision: (b).** ADR-0009's driver was avoiding _a wide internal workspace
graph_ published as many separately-versioned packages with coordinated bumps.
`arch-linter` is different in kind: it is a **devDependency** of generated
projects, off the runtime path of everyday `hexagen sync`, with its own `bin`
(`hexagen-lint`) and a narrow, stable purpose. One additional, **co-released**
package (shared version with `@hexagen-monaco/sync`, published together in
`publish.yml`) is a bounded exception, not a reversal of the single-graph rule.

**Constraints carried over.** `@hexagen-monaco/arch-linter` is itself
tsup-bundled (`noExternal: [/^@hexagen\//]`) so its private `@hexagen/*` deps
(`project-configuration`, `shared`) are inlined; only public third-party deps
(`ts-morph`, `chalk`, `lodash`, `js-yaml`, `zod`) remain external. Its
`import type { Manifest } from "@hexagen/sync"` is type-only and erased at build,
so no `sync` runtime dependency is introduced.

**Scope note.** Published under `@hexagen-monaco` (the `@hexagen` npm org was
unavailable). Monorepo package names are unchanged (`@hexagen/*`); the
`@hexagen-monaco` scope is applied only to the published name and the scaffold's
tooling devDependencies.

---

## References

- **AGENTS.md:** Section §Module Resolution (Appendix) — dual-resolution policy foundation
- **Phase 6 Work Plan:** `docs/phase-6-nodext-esm-summary.md`
- **tsup docs:** https://tsup.egoist.dev/
- **Industry precedent:**
  - Vercel AI SDK: https://github.com/vercel/ai/blob/main/packages/core/tsup.config.ts
  - Biome: https://github.com/biomejs/biome/blob/main/packages/@biomejs/cli-bin/tsup.config.ts
  - Drizzle ORM: https://github.com/drizzle-team/drizzle-orm (bundled CLI)
  - Vitest: Uses esbuild for test runner distribution

---

**Author:** Staff FE Engineer / Lead Architect  
**Approved By:** [Awaiting final acceptance post-Phase 6]  
**Effective Date:** 2026-04-25
