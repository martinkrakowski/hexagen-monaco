# Kit plan 4: grant lifecycle commands

**Date:** 2026-10-03
**Status:** plan, mostly shipped. Checked against `origin/main` at `951acf1d`. One command is missing.
**Kernel object written:** Grant (read-only listing; no change to the object).
**Type of output:** command spec and acceptance tests.

## 1. Goal

An FDE can see every grant in a client repo, whether each is live, expired or revoked, and revoke one, without opening JSON by hand.

## 2. What is on main (verified)

My thread proposal listed `show`, `list` and `revoke` as missing. Two of the three exist:

- `hexagen grant issue`, `show`, `check`, `revoke` and `key init` are registered (`packages/sync/src/commands/grant/issue.ts` lines 429, 484, 511, 553; `key-init.ts` line 85).
- `show` prints id, principal, agent, contexts, paths, tools, mode, `max_files`, `expires_at`, `revoked_at`, the window status and whether the signature verifies. Exit 0 verified, 1 not verified, 2 bad input (`packages/sync/README.md`).
- `revoke` re-signs with `revoked_at`, refuses a grant that does not verify, writes atomically, and holds `<grant>.lock` (`packages/sync/src/commands/grant/revoke.ts`).
- In a client repo the key lives outside the repo at `~/.hexagen/keys/<engagement>.key`. In a monaco-style repo it is `.hexagen/grant-signing.key`.

Not built, confirmed by reading `packages/sync/src/commands/grant/`: a `list` command. Grants are files under `.hexagen/grants/`, so listing means opening each.

Also not built: the `extraPaths` review listing. `docs/kernel/GRANT.md` line 91 says extras are "listed on the grant a human reviews", but `extraPaths` exists only in the spike (`docs/kernel/spike/grant.ts`), not in `grant issue` or `show`. `GRANT.md` should be the reference; I have not found any current CLI flag that passes extras. Confirm with `grep -rn "extraPaths" packages/sync/src` (it returns nothing today) before spending time on it.

## 3. The gap

1. No `grant list`.
2. `extraPaths` is in the spec but not in the CLI. Decide whether it is still wanted: for a client repo, `--paths` already takes explicit prefixes, so extras may be moot.

## 4. Command spec

```
hexagen grant list [--dir <path>] [--status live|expired|revoked|invalid|all]
                   [--root <dir>] [--key-file <path>] [--engagement <id>]
                   [--json]
```

1. Read every `*.json` under `<root>/.hexagen/grants/` (default `--dir`). Never search upward, never follow symlinks out of the directory.
2. For each: id, principal, agent, mode, `expires_at`, `revoked_at`, status, and whether the signature verifies under the resolved key. Status is computed at call time and printed with that time.
3. A file that does not parse, or parses with no `id`, is listed as `invalid` with the reason, never skipped.
4. Default `--status` is all. Sort by `expires_at` descending, then id.
5. Exit 0 if every grant listed verifies. Exit 1 if any fails signature. Exit 2 for bad input or a missing grants directory.
6. Key resolution is the shared resolver `show` and `check` use. Prints the key path and fingerprint, never the key.
7. `--json` prints an array, one object per grant, same fields.

It reads only.

## 5. Scope

In: `list`, README text, and a one-line decision on `extraPaths` (drop from `GRANT.md` or add `--extra-paths` to `issue` so it prints on `show`).
Out: grant renewal, a grant registry or database, remote issuance, any UI.

## 6. Acceptance tests

1. Three grants (live, expired, revoked) list with the right statuses at a fixed injected time.
2. A grant whose `revoked_at` was hand-edited lists as signature failure and exits 1.
3. A non-JSON file lists as `invalid`.
4. `--status revoked` filters.
5. A missing `.hexagen/grants/` exits 2.
6. A symlink in the directory pointing outside it is not read.
7. A call exactly at `expires_at` lists as live; one millisecond after lists as expired; exactly at `revoked_at` lists as revoked. These match the expiry decision of record.
8. With a missing or weak key, every grant reports signature not verified and the key is never printed.

## 7. Risks

- `list` reporting "live" says only that the signature and window are good now. It is not a statement about what the agent did. Say so in the output footer.
- A listing is a snapshot; a grant can be revoked a second later.

## 8. Liveness proof (Step Zero)

The PR body shows the command run against a fixture directory with the three grant states, and its test run.

## 9. Order

Independent of the others. Small enough to do alongside plan 6.
