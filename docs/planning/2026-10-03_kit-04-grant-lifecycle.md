# Kit plan 4: grant lifecycle commands

**Date:** 2026-10-03
**Status:** plan, mostly shipped, with the review applied. Checked against `origin/main` at `951acf1d`. One command is missing.
**Kernel object written:** Grant (read-only listing; no change to the object).
**Type of output:** command spec and acceptance tests.

## 1. Goal

An FDE can see every grant in a client repo, whether each is live, expired or revoked, and revoke one, without opening JSON by hand.

## 2. What is on main (verified)

My thread proposal listed `show`, `list` and `revoke` as missing. Two of the three exist:

- `hexagen grant issue`, `show`, `check`, `revoke` and `key init` are registered (`packages/sync/src/commands/grant/issue.ts` lines 429, 484, 511, 553; `key-init.ts` line 85).
- `show` prints id, principal, agent, contexts, paths, tools, mode, `max_files`, `expires_at`, `revoked_at`, the window status and whether the signature verifies. Exit 0 verified, 1 not verified, 2 bad input (`packages/sync/README.md`).
- `revoke` re-signs with `revoked_at`, refuses a grant that does not verify, writes atomically, and holds `<grant>.lock` (`packages/sync/src/commands/grant/revoke.ts`).
- In a client repo the key lives outside the repo at `~/.hexagen/keys/<engagement>.key` (`packages/shared/src/node/grant-key.ts:71`); in a monaco-style repo it is `.hexagen/grant-signing.key` (same file, line 64).

Not built, confirmed by reading `packages/sync/src/commands/grant/`: a `list` command. Grants are files under `.hexagen/grants/`, so listing means opening each.

### Two enumerators of `.hexagen/grants/` already exist

- `packages/sync/src/commands/workbook/export.ts`: `listDir` at 225-232, the grants-and-proposals walk at 341-393, and `readAllowed` at 130-174 — lstat (138), `isFile` (140), realpath containment (145-148), a refusal of the home keys directory (149-153), a size cap (159), and an `O_NOFOLLOW` read through `safeReadBytes` (165).
- `apps/tui/src/brownfield/read-files.ts:174-202` `listGrantFiles`: readdir, a `.json` filter, realpath containment, and a counter for the ones it drops.

`list` reuses the first; it does not become a third copy. The extraction is lane 4A (§11). The window status is never recomputed by `list`: it comes from `checkGrantWindow` (`packages/shared/src/types/grant-checks.ts:58-93`), the same call `show` and `check` make (`show.ts:59`, `check.ts:119`). Shape and signature come from `parseGrant` and `verifyGrantSignature` (`packages/sync/src/commands/grant/verify.ts`), the same two the export uses (`export.ts:26,363,368`).

Also not built: the `extraPaths` review listing. `docs/kernel/GRANT.md` line 91 says extras are "listed on the grant a human reviews", but `git grep -n extraPaths` reaches only `docs/kernel/GRANT.md` (lines 84 and 91), the spike (`docs/kernel/spike/grant.ts:55,66`) and this plan — no CLI flag, no schema field, no consumer. `grep -rn "extraPaths" packages/sync/src` exits 1. Decided: drop it from `GRANT.md` (§10).

### Preconditions this plan inherits

Every writer calls `ensureExcluded(root, ".hexagen/")` to add `.hexagen/` to `.git/info/exclude` when needed: `slice init` (`packages/sync/src/commands/slice/index.ts:112`), `contract add-rule` and `contract --baseline` (`contract/index.ts:98`), `observe` (`observe/index.ts:739`) and `grant issue` (`grant/issue.ts:384`). This excludes untracked files but does not untrack existing ones: `.hexagen/evidence/.gitkeep`, `.hexagen/grant.schema.json` and `.hexagen/trace.schema.json` are tracked on main (`git ls-tree -r --name-only origin/main -- .hexagen`). Nothing under `.hexagen/grants/` is tracked, so a fresh checkout has no `grants/` at all, which `list` reports as exit 2 rather than as "no grants".

- Every test mints its own grants in a fixture. No lane in this plan reads a committed `.hexagen/`.
- To reproduce a listing in a client checkout, the client stages the grant files first: `hexagen workbook export --stage .hexagen/grants/<id>.json --yes`. `grants/*.json` is allow-listed (`workbook/allow-list.ts:18`, and the `--stage` list in `packages/sync/README.md`). That is the only staged file plan 4 needs: `list` reads `.hexagen/grants/` and nothing else.

## 3. The gap

1. No `grant list`.
2. Two enumerators of the grants directory, neither shared: the export's and the TUI's.
3. `extraPaths` is in `docs/kernel/GRANT.md` but in no CLI, schema or consumer. Decided: drop it (§10).

## 4. Command spec

```
hexagen grant list [--dir <path>] [--status live|expired|revoked|invalid|all]
                   [--root <dir>] [--key-file <path>] [--engagement <id>]
                   [--json]
```

1. Read every `*.json` under `<root>/.hexagen/grants/` (default `--dir`) through the enumerator extracted from `workbook/export.ts` in lane 4A, never a third implementation. Never search upward, never follow a symlink out of the directory.
2. For each: id, principal, agent, mode, `expires_at`, `revoked_at`, status, and whether the signature verifies under the resolved key, via `parseGrant`, `verifyGrantSignature` and `checkGrantWindow`. Status is computed at call time and printed with that time. `list` does not re-derive the window itself.
3. A file that cannot be read as a grant — unparseable, no `id`, off the allow-list, a symlink, or a name the key/env pattern forbids — is listed as `invalid` with the reason, a symlink as `invalid: symlink`, and is never read. Nothing is skipped silently: every refusal the enumerator returns becomes a row.
4. Default `--status` is all. Sort by `expires_at` descending, then id.
5. Exit 2 for bad input or a missing grants directory. Otherwise exit 0 only if at least one grant is read, every grant read verifies, and no entry is invalid. Exit 1 if no grant is read, any entry is invalid, or any grant read fails its signature, including one that `--status` filtered out of the printed rows. Invalid entries are still printed as rows.
6. Key resolution is the shared resolver `show` and `check` use. Prints the key path and fingerprint, never the key.
7. `--json` prints an array, one object per grant, same fields.

It reads only. One deliberate difference from the export: where the export refuses the whole call on a bad name in a bundle directory, `list` renders the problem as a row instead, because a listing is diagnostic and one unreadable grant must not hide the others.

## 5. Scope

In: the shared enumerator extraction (lane 4A), `list` (lane 4B), the README text, and the `extraPaths` removal from `docs/kernel/GRANT.md` (lines 84 and 91-97).
Out: grant renewal, a grant registry or database, remote issuance, any UI, and the TUI's own `listGrantFiles`: `apps/tui` does not depend on `@hexagen/sync` (its workspace deps are `@hexagen/agentic-interaction`, `@hexagen/mcp-server`, `@hexagen/shared`), so it cannot import the extracted helper and keeps its copy.

## 6. Acceptance tests

1. Three grants (live, expired, revoked) list with the right statuses at a fixed injected time.
2. A grant whose `revoked_at` was hand-edited lists as signature failure and exits 1.
3. A non-JSON file lists as `invalid`.
4. `--status revoked` filters.
5. A missing `.hexagen/grants/` exits 2.
6. A symlink in the directory pointing outside it is listed as `invalid: symlink`, gets its own row, and is never read.
7. A call exactly at `expires_at` lists as live; one millisecond after lists as expired; exactly at `revoked_at` lists as revoked. These match the expiry decision of record and the two branches in `checkGrantWindow` (`grant-checks.ts:77,85`).
8. With a missing or weak key, every grant reports signature not verified and the key is never printed.
9. `--status live` over a directory that also holds a hand-edited grant prints only the live rows and still exits 1.
10. The extracted enumerator keeps the export's verdicts: an off-allow-list name is noted and skipped (`export.ts:349-352`), a symlink, a path resolving outside `.hexagen` and a key or env file name are refused, and the export's own grant cases stay green.

## 7. Risks

- `list` reporting "live" says only that the signature and window are good now. It is not a statement about what the agent did. Say so in the output footer.
- A listing is a snapshot; a grant can be revoked a second later.
- The extracted helper now has two callers, so a change to it moves `workbook export` as well as `list`. That is the point, and it is why it is one shared module with one test file rather than a copy per command.

## 8. Liveness proof (Step Zero)

The implementation PR body must show the command run against a fixture directory with the three grant states, and its test run. The fixture must be minted by the test run rather than read from a committed `.hexagen/`, because `grant issue` excludes that directory (`grant/issue.ts:384`); see §2.

## 9. Order

Not independent of the review's order any more, and it has two lanes:

1. Lane 4A runs in parallel with 6A, 2A and 3A.
2. Lane 4B runs once 4A has merged, alongside 1A, 3B and 5A.

Lane 4B edits `packages/sync/README.md`, which plans 2 to 6 also touch, so those README edits are serialised and never parallel. Nothing in this plan waits on plan 1 or plan 2.

## 10. Decision for the owner

**Decided (owner, 2026-10-02): drop `extraPaths` from `docs/kernel/GRANT.md`.** Remove the `extraPaths?` parameter from the `compileGrant` signature at line 84 and the whole of step 3 at lines 91-97, so the compiled path list is exactly the named contexts expanded to `packages/<context>/`. Reason: `git grep -n extraPaths` reaches nothing outside `GRANT.md`, the spike and this plan, so the sentence promises a review affordance that no flag, schema or consumer provides. The capability is not lost, only the claim: in a client repo `--paths` already takes explicit prefixes.

Rejected alternatives, one line each:

- Add `--extra-paths` to `grant issue` and print it on `show`: rejected, it builds a flag for a spike's parameter that no client has asked for.
- Keep the sentence and mark extras as not implemented: rejected, `GRANT.md` is the document a reviewer trusts, and an unimplemented promise is the thing being removed.
- Change the spike too: rejected, `docs/kernel/spike/grant.ts` is a spike, not a shipped surface, and this plan writes no code.

## 11. Lanes

**4A — the shared grant enumerator.** Depends on nothing; runs in parallel with 6A, 2A and 3A. Moves `Refusal` (76-83), `Sidecar` and `openSidecar` (93-122), `readAllowed` (130-174) and `listDir` (225-232) out of `packages/sync/src/commands/workbook/export.ts` into `packages/sync/src/commands/shared/`, and points the export at them. No new subcommand, no README, no `GRANT.md`, no kernel schema. Targeted tests: `packages/sync/__tests__/commands/workbook/export.test.ts` (green, unchanged behaviour), `packages/sync/__tests__/commands/shared/grant-enumerator.test.ts` (new; the refusals of acceptance test 10), `packages/sync/__tests__/commands/grant/show-check.test.ts`.

**4B — `grant list`, the README, the `GRANT.md` edit.** Depends on 4A merged. Must not run in parallel with any other lane editing `packages/sync/README.md` (plans 2 to 6). It adds a CLI subcommand, so rebuild the package (`yarn workspace @hexagen/sync build`) before running the built-artifact suite: `__tests__/contract/exit-codes.contract.test.ts` spawns the real `dist/cli.js` and passes against a stale build. Targeted tests: `packages/sync/__tests__/commands/grant/list.test.ts` (new; acceptance tests 1-9), `packages/sync/__tests__/commands/grant/show-check.test.ts`, `packages/sync/__tests__/contract/exit-codes.contract.test.ts` after the rebuild, and `packages/sync/__tests__/contract/public-surface.contract.test.ts` if `packages/sync/src/commands/grant/index.ts` is touched: that barrel re-exports only `grantCommander` and `issueGrantCommand` from `./issue.js` and is imported by `cli.ts:28`, and the surface suite reads the root barrel `src/index.ts`, which names no grant export today, so the check stays green unless a name is added there.
