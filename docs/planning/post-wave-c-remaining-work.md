# Post–Wave C: Remaining Work

**Status date:** 2026-06-12
**Context:** The sync-toolchain remediation arc (Waves A → B → C) is complete — #319 (C2), #320 (C1), #321 (C3), #322 (C4) are all merged to `main` (`c9100b1f`). No open PRs in this repo.

**Scope of this plan:** every remaining hexagen-monaco item **except** the campaign-foundry consumer work (its `^0.7.x` bump, CI gates, and its own Actions/Node-24 update — tracked separately in that repo). hexagen-monaco's own workflows are already on `actions/*@v5` + `action-gh-release@v2`, so the June-16 Node-24 runner deprecation is **not** a task here.

Tracks, in rough priority order:

- **A — Release**: publish Wave C (gated).
- **B — Wave C fix-forward**: the review nits surfaced during #319–#322, now on `main`.
- **C — Next feature work**: LLM PR-6/PR-7, staged-pipeline A4.
- **D — Deferred backlog**: long-standing items (currency to confirm when picked up).

---

## Track A — Release Wave C (hexagen-monaco)

### A1 · Publish `0.7.1` with the Wave C toolchain — **gated on Martin's tag go-ahead**

- **What:** cut `0.7.1` so the C1–C4 improvements (leaf `.gitkeep`, `schemaVersion` gate + `manifest migrate`, linter `depends_on`, loadable ownership registry / truthful template docs) are available on npm. `main` is currently unreleased past `0.7.0` (Waves A+B).
- **Why:** Wave C lives on `main` but no consumer can install it until it's published. (The consumer rollout itself is out of scope per above; this is just making it available.)
- **Release-notes must carry:** the **C1 schema-version skew warning** — older _published_ CLIs/linters strict-reject manifests carrying the new `schemaVersion` key; only freshly-scaffolded or explicitly-migrated projects get the stamp, nothing existing is rewritten without an operator running `migrate`.
- **Constraint:** pushing a `vX.Y.Z` tag triggers a **live npm co-publish** — never without explicit go-ahead.
- **Recommendation:** land the substantive Track-B fixes (B1, B6) first so `0.7.1` is clean, then tag.
- **Size:** S (release mechanics + notes) · **Risk:** Med (live publish) · **Deps:** ideally after B1/B6.

---

## Track B — Wave C fix-forward (review follow-ups, now on `main`)

These came out of the #319–#322 review rounds. Two are substantive (B1, B6); the rest are small/doc. Suggested grouping noted per item.

### B1 · `sync --check` false-greens on a manifest-less cwd — **substantive**

- **What:** when no manifest resolves, `--check` hits the `"Manifest not found — using empty for dry-run"` arm (`packages/sync/src/sync-engine-init.ts:116`) and exits **0**.
- **Why:** C2's cwd-first root resolution made a _wrong-root_ result reachable by simply standing in the wrong directory; the drift gate then passes on an empty manifest. A drift gate that reports green on a missing manifest is the worst failure mode (silent pass).
- **Fix:** make `--check` **hard-fail** (exit 1, clear message) on an unresolvable/missing manifest. Decide whether plain `--dry-run` (non-check) keeps the "empty" tolerance or also fails — they need distinguishing at the arm.
- **Acceptance:** `sync --check` with no resolvable manifest exits 1 and names the cause; tests for both the `--check` and plain-`--dry-run` arms.
- **Size:** S–M · **Risk:** Med (branch is shared by check/dry-run) · **Group:** with B4 (same file).

### B2 · `reap` can't remove a de-configured keep-only dir

- **What:** `reap` requires a `readdir`-empty directory (`reap.ts`), and generator-emitted `.gitkeep`s are never deleted by design — so a layer dir dropped from config lingers forever with just its keep.
- **Fix:** either let `reap` remove a dir whose only content is a generator-emitted keep once the dir is de-configured, or document the limitation in `reap`'s doc.
- **Acceptance:** decision recorded; if behavioral, a test for the de-configured-keep-only case.
- **Size:** S · **Risk:** Low.

### B3 · Canary doc overstatement (#319) — **doc-only**

- **What:** with cwd-first working, the exit-codes canary no longer demonstrates a `__dirname`-only fallback regression on its own; the `published-layout.ts` header still implies it does.
- **Fix:** reword the header — the `lstat` (copy-not-symlink) assert in `createPublishedLayoutFixture` is now the front line; the canary catches host-leak end-to-end only when both probes regress.
- **Size:** XS · **Risk:** Low · **Group:** doc batch (B3+B5+B7).

### B4 · `findRootFrom` swallows real errors (#320)

- **What:** the upward walk's blanket `catch` (`sync-engine-init.ts`) treats EACCES / malformed-JSON the same as "not here," so the final throw always says _"no package.json with a workspaces array"_ even when a `package.json` existed but couldn't be read/parsed.
- **Fix:** ignore only `ENOENT`; thread the first non-ENOENT error into the final thrown message (keep walking on ENOENT).
- **Acceptance:** a walk hitting EACCES/malformed `package.json` surfaces that cause; ENOENT still continues the walk; test both.
- **Size:** S · **Risk:** Low · **Group:** with B1 (same file). Pairs with backlog D5 (arch-port swallow).

### B5 · Byte-identity comment misstated on `main` (#322) — **doc-only, mild irony**

- **What:** `architecture-files.ts:94` says _"the contested names so **collision-free** manifests stay byte-identical."_ Two reviewers showed the predicate is wrong: the pass-1 dedupe is a **second** (equally safe) divergence, so a collision-free manifest with a same-context same-stem pair _does_ change bytes (it was already an unloadable duplicate-key doc).
- **Fix:** _"collision-free"_ → _"**previously-loadable**"_; drop _"the contested branch is the only divergence."_ The behavior is correct — only the description is off, which is worth fixing in a PR whose whole thesis is governance truth. (The merged PR body is frozen; this is the code comment.)
- **Size:** XS · **Risk:** Low · **Group:** doc batch.

### B6 · Ownership-line **value** side is a bare scalar (#322) — **substantive-ish, dormant**

- **What:** C4 hardened the _key_ side (quoted qualified keys) but the value is still bare: `` `      ${name}: ${context}` `` (`architecture-files.ts:111`). A YAML-hostile context name (leading `&`, `*`, `!`, `@`, `` ` ``, quotes…) would break the value the way the key used to break.
- **Why dormant:** bounded-context names are simple today; there's a validation hook but no surfaced charset regex.
- **Fix (pick one):** (a) symmetric quoting — quote the value when it's not a safe plain scalar; or (b) enforce a safe charset on `bounded_contexts[].name` at manifest validation with a clear rejection.
- **Acceptance:** a context with a YAML-hostile name either emits a quoted-safe value or is rejected at validation; regression test. Confirm no _existing_ context name would be newly rejected if going with (b).
- **Size:** S (quote) / M (validation) · **Risk:** Low–Med.

### B7 · ADR-0043 doc notes (#321) — **doc-only**

- **What:** two clarifications the review asked for. (a) `type: shared-kernel` is **self-asserted and ungated** — any context can declare it and become globally importable; the manifest is the source of truth and `cannot_import` is the per-edge backstop. State it so it reads as deliberate, not an oversight. (b) the default `global_whitelist` (`[${scope}/shared]`) is **exact-match only** — it doesn't cover `@scope/shared/domain` without a `/**` glob; document so it doesn't surprise.
- **Size:** XS · **Risk:** Low · **Group:** doc batch.

### B8 · `|| true` muffler + drifted fake (#320)

- **What:** the `@hexagen/project-configuration` test script's trailing `|| true` muffled 7 red tests (repaired in #320); a _separate_ pre-existing failure remains muffled — `validate-spec.test.ts`'s drifted `FakeValidateSpecPort` default. (Confirm exact script location.)
- **Fix:** repair the drifted fake, then remove `|| true` so the package suite fails loudly. Removing the muffler may surface other hidden failures — audit first.
- **Acceptance:** `validate-spec.test.ts` green; `|| true` removed; suite exits honestly.
- **Size:** S–M · **Risk:** Med (may reveal more) · **Deps/overlap:** D4.

**Suggested B batching:** doc-only **B3+B5+B7** → one trivial PR · **B1+B4** (`sync-engine-init.ts`) → one PR · **B6**, **B2**, **B8** individually (or a "Wave-C polish round 2").

---

## Track C — Next feature work

### C1 · LLM PR-6 — free tier

- **What:** the next PR in the LLM execution overhaul (#304, PR-1→PR-5 all merged). Free anonymous tier: **mercury-2** chat model, **anonymous-session + IP-based quotas** (≈10 generations/day, 100 chat/day), **SQLite** quota store.
- **Design surface to settle:** anon-session identity + IP fallback, the quota-store schema and enforcement seam, the chat-vs-generate accounting split, abuse bounds.
- **Size:** L · **Risk:** Med · **Deps:** none blocking.

### C2 · LLM PR-7 — **blocked**

- **What:** next LLM PR after PR-6; **blocked on Martin's HTML template**.
- **Action:** surface for Martin to unblock; no work until the template lands.

### C3 · A4 — delete the staged-generation stub

- **What:** now that the full 0→6 staged pipeline has been **100% in prod since 2026-06-11**, remove the stub path + the `selectPipeline` flag, brand `ArchitectureContext`, add the counts-helper. (The C1 migrate registry's `workspace_template→workspaceTemplate` example migration is currently a deliberate _fake_; A4-adjacent cleanup could revisit it.)
- **Caution:** `STAGED_GENERATION_PIPELINE=stub` is the **current prod rollback lever** — deleting the stub removes it. Land A4 only once the full pipeline is trusted enough to drop the lever (Martin's call on how long 100% must hold).
- **Size:** M · **Risk:** Med (removes rollback lever; branded type may ripple) · **Deps:** confidence in the full pipeline.

---

## Track D — Deferred backlog (long-standing; confirm currency when picked up)

Lower priority, carried forward. Several were re-confirmed live during the Wave C work (D11, D12); others are older.

| ID  | Item                                                   | Note                                                                                                                                                                      |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Root `typecheck:test` 15-error baseline                | `@hexagen/sync` ports drift; root bails first-fail. Clean so `typecheck:test` is green.                                                                                   |
| D2  | 3 agentic-interaction `@generated` barrels             | Hand-edited in the A2/A3 arc → perpetual self-sync dry-run drift (3 pending). Regenerate properly or suppress.                                                            |
| D3  | S-3 doubled dry-run lines                              | Duplicate dry-run log lines.                                                                                                                                              |
| D4  | `validate-spec.test.ts` drifted fake                   | `FakeValidateSpecPort` default drift (overlaps B8).                                                                                                                       |
| D5  | arch-port swallow                                      | Error-swallowing in an arch port (pairs with B4's catch hygiene).                                                                                                         |
| D6  | `validate-templates` counting                          | Count/report accuracy in the command.                                                                                                                                     |
| D7  | manifest-service atomic write                          | Non-atomic write in the manifest service (cf. the C1 migrate atomic-write idiom).                                                                                         |
| D8  | FileSystemPort injection                               | Inject the FS port rather than direct `fs` use at the flagged site.                                                                                                       |
| D9  | `git-operations.ts:46`                                 | Flagged spot (confirm current line).                                                                                                                                      |
| D10 | layer-rules `shared_kernels` plural/singular drift     | Schema/usage spelling drift.                                                                                                                                              |
| D11 | `YamlConfigAdapter` dead + shape-mismatched            | **C4-disclosed.** Only `generator.config.yaml` reader; dead (own test only) + reads top-level keys while the template nests under `generator:`. Wire correctly or delete. |
| D12 | `mergeSplitManifest` drops `monorepo`/`archInvariants` | **C4-disclosed.** Split-manifest rebuild omits `monorepo`, so the `archInvariants` override slot is dead for split repos like this one.                                   |

---

## Recommended sequence

1. **Doc batch** — B3 + B5 + B7 (one tiny PR; clears the misstatements the reviews surfaced).
2. **`sync-engine-init.ts` PR** — B1 (the `--check` false-green, the one real bug) + B4 (error-threading).
3. **Polish** — B6 (value-side hardening) + B2 (reap) + B8 (`|| true`/fake), individually or batched.
4. **A1 release `0.7.1`** once B1/B6 land — on your tag go-ahead.
5. **Big feature** — C1 (LLM PR-6) or C3 (A4), your priority. C2 stays blocked.
6. **Track D** — opportunistic / when adjacent code is touched.
