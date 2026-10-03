# @hexagen-monaco/sync

> The Hexagen-Monaco sync engine — a CLI that generates and maintains modular, Hexagonal-architecture monorepos from a single `manifest.yaml`.

---

## Installation

```bash
npm install @hexagen-monaco/sync
# or
yarn add @hexagen-monaco/sync
# or
pnpm add @hexagen-monaco/sync
```

`@hexagen-monaco/sync` ships as a self-contained ESM package with only two runtime
dependencies (`commander`, `js-yaml`). All internal Hexagen-Monaco packages
(`@hexagen/governance`, `@hexagen/project-configuration`,
`@hexagen/shared`, `@hexagen/visualization`) are bundled into the published
artifact — consumers never see them in their `node_modules`.

---

## CLI Usage

The package installs a single binary, `hexagen`:

```bash
# Show top-level help
npx hexagen --help

# Run the sync engine against your manifest
npx hexagen sync

# Manage the architecture manifest
npx hexagen arch --help
```

### Typical Workflow

```bash
# 1. Add a bounded context to your manifest
npx hexagen arch context add billing --type=core

# 2. Declare a port on that context
npx hexagen arch port add --context=billing --name=InvoiceRepository --direction=out

# 3. Run sync to regenerate the monorepo artifacts
npx hexagen sync
```

Consult `npx hexagen arch --help` for the full list of manifest operations.

### `hexagen grant issue`

Mints a signed Grant — the file `hexagen_accept_transaction` trusts as its
`grant` argument (see `docs/kernel/GRANT.md`). Local, no server:

```bash
npx hexagen grant issue \
  --principal martin \
  --agent lane-ow3b \
  --paths .architecture/,packages/billing/ \
  --tools hexagen_accept_transaction,hexagen_create_port \
  --mode write \
  --expires-in 4h \
  --out .hexagen/grants/<id>.json
```

Signs with an HMAC-SHA256 key. Which key, and where it lives, depends on the
mode, and `hexagen_accept_transaction`'s server resolves it the same way
(one shared resolver), in this order:

1. `--key-file <path>`
2. `HEXAGEN_GRANT_KEY_FILE`
3. **Repo mode** (`.architecture/manifest.yaml` exists): `.hexagen/grant-signing.key`,
   created on first use if missing, with a `.gitignore` entry added for it.
   Never commit it. **Brownfield** (no manifest, a client repo you do not
   control): `~/.hexagen/keys/<engagement>.key`, never inside the repo. There
   is no fallback to an in-repo key.

The key must be a full 32-byte hex value, so a hand-edited or truncated key
file is rejected by the issuer and denied by the server rather than silently
used. Keys are shown by path and
fingerprint (first 16 hex chars of the SHA-256 of the key bytes), never
printed.

#### Brownfield: `grant key init` and `--engagement`

```bash
npx hexagen grant key init --engagement acme-q3 [--key-file <path>]
```

The only command that mints a key outside repo mode. It writes 32 random bytes
as hex at mode 0600 in `~/.hexagen/keys/` (0700, tightened if it was loose),
refuses to overwrite an existing key (exit 1), and accepts engagement ids
matching `^[A-Za-z0-9._-]{1,64}$` with no `..`. `grant issue` in a repo with no
manifest never mints and never edits `.gitignore`:

- The engagement id is `--engagement <id>`, or the `id` of a valid
  `.hexagen/slice.json`. Without either, exit 2.
- `--paths` defaults to the slice's paths; every entry must be a valid slice
  path inside the slice, and no slice exclude may sit beneath a directory entry
  (grants carry no excludes, so issue narrower paths; exit 2). `--contexts` is
  refused (exit 2), and the grant omits `contexts`.
- The root is the git toplevel of the current directory when the discovered
  manifest root lies outside it, so a client repo nested under a directory with
  a manifest is still brownfield. A manifest at or below the toplevel keeps repo
  mode. `--workspace-root` overrides both.
- `--out` must be a new file under `<root>/.hexagen/` (symlink escapes are
  refused, exit 2; an existing file is never overwritten, exit 1) and is written
  via a temp file plus a hard link.
- `.hexagen/` is added to `.git/info/exclude`. When a write is pending (the
  `--out` file or an exclude change) the preflight lists it and `--yes` is
  required; otherwise exit 2 without writing. With nothing to write, `--yes`
  is not needed.
- It prints the workspace root, key path and fingerprint on stderr. If
  `--key-file` points somewhere the server would not look by default, it warns
  with both paths and fingerprints (likewise when `--engagement` differs from the
  slice's id). The grant is validated and signed before `.git/info/exclude` is
  touched. The MCP server takes `--key-file` and
  `--engagement` too, and logs the same line at startup.

`--contexts <name[,name...]>` is a monaco-only convenience (repo mode): it
looks each name up in `manifest.yaml` and expands it to `packages/<name>/`,
appended to `--paths`.

`hexagen_accept_transaction`'s enforcement (`checkMutationAgainstGrant`)
requires `grant.contexts` to independently name every context a mutation
targets — a grant's `paths` alone never satisfies that check, and an empty
`contexts` denies everything. So the CLI also reverse-matches any
`packages/<name>/` prefix already present in `--paths` against the
manifest, folding matching names into `grant.contexts` automatically
(`--contexts` can usually be omitted when `--paths` already names the
context's package directory, as in the example above). Symmetrically,
`.architecture/` — the one path every manifest mutation actually writes
through — is always added to the grant's `paths` whenever it authorizes any
context, so `--contexts` alone is enough without repeating
`.architecture/` in `--paths`. This reconciliation only works where a
manifest exists: a grant that names no context at all (no manifest to
derive contexts from, and no `--contexts` given) is paths-only in the
literal sense, but since every manifest-mutation tool's enforcement
requires a context match, such a grant cannot authorize any of those seven
tools — it is scoped only for a future, generic Field Kit adapter that
doesn't check `contexts`, not for `hexagen_accept_transaction` as it exists
today. Prints the grant JSON to stdout, or to `--out <file>` if given.

### `hexagen grant show` and `hexagen grant check`

```bash
npx hexagen grant show .hexagen/grants/<id>.json
npx hexagen grant check .hexagen/grants/<id>.json \
  --tool hexagen_propose_patch --path src/a.ts src/b.ts
```

Both resolve the verification key exactly as `grant issue` and the MCP server
do (`--key-file`, then `HEXAGEN_GRANT_KEY_FILE`, then the engagement from
`.hexagen/slice.json` or `--engagement`, or the in-repo key in repo mode), and
print the workspace root, the key path and its fingerprint, never the key.

- `show` pretty-prints id, principal, agent, contexts (when present), paths,
  tools, mode, `max_files`, `expires_at` and `revoked_at`, the window status,
  and whether the signature verifies. Exit 0 verified, 1 not verified (the
  reason is printed), 2 bad input. A revoked or expired grant with a valid
  signature still exits 0; `check` enforces the window.
- `check` verifies the signature, then the window, then the tool, the paths
  and `max_files` (`checkWriteAgainstGrant`). It never runs the mode check, so
  a propose-only grant is allowed. In a client repo (no manifest) it also
  denies a path outside the slice or inside its excludes, even if the grant
  allows it, and with no `.hexagen/slice.json` it denies (the slice bounds every
  write). Paths are judged by text only; the MCP propose tool also checks the
  on-disk spelling. `--path` may be repeated or list several paths, and every one is checked.
  The Field Kit form is for client repos; in a repo with a manifest it exits 2.
  The root is the git toplevel unless `--workspace-root` is given. Exit 0
  allow, 1 deny, 2 bad input (including an invalid `.hexagen/slice.json` or
  timestamp, which `show` also rejects). A missing or weak key, or a
  signature made under another key, is a denial; with `--key-file` or
  `--engagement` it names both keys' fingerprints.
- The monaco form, `grant check <grant-file> <transaction-id>`, is not built:
  pending transactions live in the MCP server's memory. It exits 2.
- `revoke` sets `revoked_at` and re-signs the grant:
  `hexagen grant revoke .hexagen/grants/<id>.json [--at <iso>] --yes`. It
  verifies the grant under the resolved key first and refuses one that does not
  verify (exit 1). It previews the write and needs `--yes`; the file is replaced
  by a temp file and an atomic rename; in a client repo it must be under
  `.hexagen/`. Revoking again is a no-op ("already revoked at ..."), except an
  earlier `--at` moves the date earlier. Hand-editing `revoked_at` breaks the
  signature, so `check` denies the grant as a signature failure; `revoke`
  re-signs it, so `check` reports `grant_revoked`. Deleting the engagement key
  revokes every grant in that engagement (an emergency stop).
  A future `--at` schedules the revocation (the grant stays valid until then,
  and the preflight warns); a value at or after `expires_at` has no effect. In
  a repo with a manifest it re-signs with the in-repo key.
  Concurrent revokes are serialised by `<grant>.lock` (a held lock exits 2, never
  auto-broken), and `--key-file`/`--engagement` pointing at a key other than the
  server default produces a warning naming both keys.

### `hexagen grant list`

```bash
npx hexagen grant list                # every grant under .hexagen/grants/, as a table
npx hexagen grant list --status live  # only the live rows
npx hexagen grant list --json         # the same rows as a JSON array on stdout
```

A read-only listing of every `*.json` under `.hexagen/grants/` — there is no
`--dir` and no other directory — so you can see what is live, expired or revoked
without opening JSON by hand. Two lines come first, the directory it read and the
time the window was judged at, then the resolved key by path and fingerprint
(never the key), then the table and its summary:

```text
file                   status   id         principal  agent   mode     expires_at            revoked_at            signature
grants/g-live.json     live     g-live     martin     lane-1  propose  2026-10-01T18:00:00Z  -                     verified
grants/g-revoked.json  revoked  g-revoked  martin     lane-1  propose  2026-10-01T18:00:00Z  2026-10-01T10:00:00Z  verified
grants/g-expired.json  expired  g-expired  martin     lane-1  propose  2026-10-01T11:00:00Z  -                     verified
3 entries: 1 live, 1 expired, 1 revoked, 0 invalid
```

The columns are file, status, id, principal, agent, mode, `expires_at`,
`revoked_at` and the signature verdict; rows are sorted by `expires_at`
descending, then id. The status is the shared `checkGrantWindow` answer, never a
second implementation of the window, and it is computed at call time and printed
with that time. The verification key is resolved once for the whole listing and
named exactly as `grant issue`, `show` and `check` resolve it. It works in a repo
with a manifest too, reading the in-repo key.

- Every entry in the directory becomes a row, including every refusal and every
  error one raises: a symlink is `invalid: symlink` and is never read, and so are
  an off-allow-list name, a name the key/env pattern forbids, unparseable JSON, a
  JSON value that is not a grant, a file over the 32 MiB per-file cap, and an
  entry that vanishes mid-read (`invalid: vanished before it could be read`). One
  unreadable grant never hides the others — the deliberate difference from
  `workbook export`, which fails the whole call instead. The reads go through the
  same sidecar guards the export uses, so `.hexagen/grants/` has one enumerator,
  not three.
- Exit 0 only if at least one grant was read, every grant read verifies and no
  row is invalid. Exit 1 if no grant was read, any row is invalid, or any grant
  read fails its signature — including one `--status` filtered out of the printed
  rows. Exit 2 for bad input (an unknown `--status`, an unresolvable workspace
  root, an unreadable directory) or a missing `.hexagen/` or `.hexagen/grants/`.
  A fresh checkout has no `grants/` directory at all, so stage the grant files
  first with `hexagen workbook export --stage .hexagen/grants/<id>.json --yes`.
- `--status live|expired|revoked|invalid|all` (default `all`) filters the printed
  rows and nothing else. The summary always totals the whole directory, so an
  invalid entry, or a signature failure the filter dropped, is still on screen
  next to the exit code it caused — with `--status live` over a directory that
  also holds one invalid entry, one row is printed and the summary reads:
  `1 shown (--status live); all 4 entries: 1 live, 1 expired, 1 revoked, 1 invalid`.
  `--json` prints the array of rows on stdout, with the key line, the summary and
  the note on stderr.
- A `revoked_at` edited by hand breaks the signature, so the row reads `revoked`
  and `not verified` — the same split `grant check` reports. `live` is the window
  alone, at the timestamp printed beside it: read the signature column before
  trusting a row. A listing is a snapshot, and a grant can be revoked a second
  later.

### `hexagen observe`

A read-only scan of a repo you do not control. It reports what is already
there, in the repo's own names, and never runs `adopt`, `bootstrap`, `sync`
or `hexagen-lint`:

```bash
npx hexagen observe --root ../client-repo                    # JSON to stdout
npx hexagen observe --root ../client-repo \
  --out .hexagen/observed.json --yes                         # write the file
npx hexagen observe --dont-touch src/legacy/ vendor-patches/ # report-only
```

- `--root <dir>` is used exactly as given (default: cwd); it is never searched
  upward, and it must be the repo top level (exit 2 otherwise, naming the
  top level git reports). The directory must be a git checkout with at least one
  commit, whose `HEAD` is recorded in `repo.commit`. Credentials, query and fragment in the `origin` URL are stripped.
- `--out <file>` must resolve under `<root>/.hexagen/` (symlinks included);
  anything else exits 2, as does a `.hexagen` that is a regular file. It
  prints a `will write:` line for `observed.json` and one for the exclude file,
  and writes only with `--yes` (without it, exit 2). The report is written as a
  temp file plus rename. `.hexagen/` is then kept out of `git status` by
  appending it, if absent, to the file `git rev-parse --git-path info/exclude`
  prints (correct in linked worktrees and submodules); the tracked
  `.gitignore` is never edited, and `git add -f` can still stage the
  directory. If that update fails, the command exits 2 before writing the
  report.
- `--max-files <n>` (default 50000) and `--max-ms <n>` (default 30000) cap the
  walk. A tripped cap marks `packages`, `languages`, `build` and `generated` as
  `collected: false` with the reason, and sets `limits.truncated`.
- The output validates against `ObservedReport` (`docs/kernel/observed.schema.json`)
  and has no `type`, layer, plane or context key.
- `--max-import-files <n>` (default 20000: the pass refuses to run when there
  are more than `n` JS/TS files), `--max-import-bytes <n>` (default 268435456)
  and `--max-import-ms <n>` (default 30000) cap the import pass. It has its own
  clock, started when it begins, and runs after `generated` is collected, so it
  cannot use up the time `--max-ms` gives the walk and `generated`. A tripped
  cap sets `edges` and `unresolved` to `collected: false` with the reason, and
  sets `limits.truncated`; the other sections keep what they collected. If the
  walk itself was truncated, the pass does not run and both sections carry the
  walk's reason.

What it reads:

- **Walk.** Skips `node_modules`, `vendor`, `bower_components`, `jspm_packages`,
  `.yarn`, `.git`, `.hg`, `.svn` and `.hexagen`,
  does not follow symlinks, and honours the root `.gitignore` and nested
  `.gitignore` files (not `info/exclude` or `core.excludesFile`). A path that
  fails the slice-path rules (a backslash or control character) is skipped
  with a note.
- **Import pass (`edges`, `unresolved`).** A lexical scan of `.ts .tsx .mts
.cts .js .jsx .mjs .cjs` files from the same walk. It is a tokenizer, not a
  parser, and never uses ts-morph or the TypeScript compiler API. It reads
  `import … from 'x'`, `import 'x'`, `export … from 'x'`, `import('x')`,
  `require('x')` (also `require?.('x')` and `(require)('x')`) and
  `import x = require('x')`; comments, strings and
  template literals (including `${…}` contents) are skipped. Source files and
  tsconfigs are opened without following a symlink in the last path component
  (`O_NOFOLLOW`; on Windows an `lstat` check instead), and the size limit and the
  read both use the opened handle. Bytes read from tsconfigs count toward
  `--max-import-bytes`, and the time cap is checked while they load. Only files
  up to
  1 MiB are read. A larger or unreadable file is skipped, noted in
  `limits.reasons` (the notes are capped at 50), and given its own `unresolved`
  row, so its missing edges never read as clean. The scan is linear in the file
  size. Known limits: JSX text with an apostrophe opens a string that ends at the
  line end; a regex literal right after `)` (`if (x) /re/.test(y)`) is read as
  division, so a specifier-shaped string inside it can appear as a phantom
  import; a wrong regex or string guess can swallow a backtick and misread the
  template state until the next one; and a `/` after `>` starts a regex (so
  `x => /re/.test(x)` works) but after `<` it does not (`</p>`); a postfix
  `++`/`--` followed by an unbalanced `[` in a divisor string can make the line
  guard hide a later quote-bearing regex on the same line
  (`x = i++ / "["; y = /it's/.test(s);`); a block statement after a
  semicolon-less non-literal `require(x)` (ASI only) is dropped. A class method named `require` or `import`
  (`require(id) {}`) is not reported.
  - **Resolution order, per specifier:** (1) a relative specifier (`./`, `../`)
    against the walked files: the exact file, then `.js`→`.ts/.tsx`
    (`.jsx`→`.tsx`, `.mjs`→`.mts`, `.cjs`→`.cts`), then each extension, then
    `/index.*` (a trailing slash, `.` and `..` name a directory and match only
    its `index.*`; `C:/x` and `C:\x` are `outside-repo`; `.\x` is `not-found`); (2) a workspace package name, exactly as declared including
    scope, mapped to that package's root (`"."` for the root package); (3) the
    nearest `tsconfig.json` at or above the file, within the repo:
    `compilerOptions.paths` (longest matching prefix wins) and `baseUrl`,
    following `extends` only to repo-relative files, at most 5 levels past the
    nearest file, with a note on a cycle, an unreadable or over-1-MiB file or an
    `extends` that leaves the repo; for an `extends` array only the last entry
    is followed (noted), not TypeScript's merge of all of them;
    (4) a `#` specifier (package `imports`). A tsconfig further up the tree is
    not consulted when the nearest one has no `paths`/`baseUrl`.
  - **`edges[]`** are `{from, to, specifier}` with `to` a file or a package
    root, deduplicated.
  - **`unresolved[]`** are `{from, specifier, reason}`. Reasons:
    `not-found` (a relative or alias target that is not in the walk),
    `exports-subpath` (`@scope/pkg/sub`, when no tsconfig `paths` alias matches it;
    `exports` maps are not read),
    `non-literal` (`import(x)`, `require(a + b)`, and an escaped or empty static
    specifier such as `import '\u0061'`; recorded as `import(<non-literal>)`,
    `require(<non-literal>)`, `import <non-literal>` or `export <non-literal>`), `outside-repo` (the
    target leaves the repo root, or is an absolute or drive path),
    `package-imports` (a `#` specifier) and `not-scanned` (the file itself was
    skipped: the specifier reads `<not scanned: larger than 1 MiB>` or
    `<not scanned: unreadable>`).
  - **External specifiers** (node builtins, `node:` URLs, dependencies) are
    neither edges nor unresolved. They are counted in one note in
    `limits.reasons`.
  - **`edgesComplete`.** `edges.unreadLanguages` lists the file extension of
    every counted language the pass does not read (`go`, `py`, `rs`, `vue`, …).
    These are extensions, whereas `languages[].name` holds display names
    (`Go`, `Python`); a consumer must join on the extension, not the name.
    A non-empty list makes `edgesComplete(edges)` false, so an empty edge list
    for such a repo never reads as a clean bill. Consumers must call
    `edgesComplete`, never read `collected` alone.
- **Metadata files** (`package.json`, `pnpm-workspace.yaml`, `.gitattributes`,
  `CODEOWNERS`) are never read through a symlink; a link is noted and skipped.
- **Packages.** Every `package.json` the walk reaches is a package: a repo with no
  workspaces has one at `"."`. Names are exactly as written, scope included; a
  manifest with no `name` is reported under its directory path (the root
  directory's basename for `"."`). Workspace `!` exclusions from `workspaces`
  (array or `{packages}`) and `pnpm-workspace.yaml` are honoured, with full glob
  syntax (`*`, `**`, `?`, `[..]`, `{a,b}`); include globs add nothing the walk
  has not already found.
- **Languages** by extension (file counts), **build markers** (`package.json`,
  `nx.json`, `turbo.json`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle*`,
  `pyproject.toml`, `Makefile`).
- **Generated** paths: root `.gitattributes` `linguist-generated`, `@generated`
  in the first 5 lines of a source file, and gitignored `dist/` or `build/`.
- **dontTouch**: `--dont-touch` plus literal anchored `CODEOWNERS` paths
  (`.github/CODEOWNERS`, then `CODEOWNERS`, then `docs/CODEOWNERS`; the first found is read), reported with their
  owners and never turned into a rule. Glob and unanchored CODEOWNERS patterns
  cannot be a path, so they are skipped and noted in `limits.reasons`.
  `limits.reasons` may carry `note:` lines (an unreadable directory, an
  unnamed package, a pattern that does not compile) while `truncated` is
  `false`; only a tripped cap sets `truncated`.

### `hexagen slice` and `hexagen contract`

Bind work to part of a repo you do not control, then gate it. Both read the
`.hexagen/observed.json` that `hexagen observe` wrote, so run `observe` first
(and again after the repo moves). Neither runs `adopt`, `bootstrap`, `sync` or
`hexagen-lint`, and neither needs a manifest. Every command takes
`--root <dir>` (default cwd, never searched upward, must be the repo top level).

```bash
npx hexagen observe --out .hexagen/observed.json --yes
npx hexagen slice init --path src/billing/ --exclude src/billing/generated/ --yes
npx hexagen slice check                      # drift report
npx hexagen contract propose                 # candidate rules; writes nothing
npx hexagen contract propose --closed        # one candidate `closed` rule instead
npx hexagen contract add-rule --kind forbid --from src/billing/ --to src/auth/ --yes
npx hexagen contract add-rule --kind closed --except src/auth/ --yes  # close the slice, except one crossing
npx hexagen contract check                   # gate; exit 1 on a new violation
npx hexagen contract check --baseline --yes  # record today's violations
npx hexagen contract check --base <base-sha>  # pinned PR base; exit 1 on growth
npx hexagen contract check --base <base-sha> --allow-growth --reason "<why>"
```

**`slice`** writes `.hexagen/slice.json`.

- `slice init --path <p>… [--exclude <p>…] [--id <id>] [--by <who>]`. Each entry
  must pass the slice-path rules (a trailing `/` is a directory prefix, anything
  else is one file). `--id` matches `[A-Za-z0-9._-]{1,64}` without `..` and
  defaults to a random slug. `repo.commit` is `HEAD` and `repo.remote` is
  `origin` with credentials stripped. `createdBy` is `--by`, else
  `git config user.email`. It never overwrites an existing slice.
- `slice show` prints the slice.
- `slice check` reports drift (exit 1): a `paths` entry that matches no file; a
  file under the slice changed between `repo.commit` and `HEAD` (`excludes`
  applied; uncommitted working-tree edits are not drift, only commits since
  `repo.commit` are); and incomplete edges (`edgesComplete` is false: an unread
  language, or edges not collected), which are never clean. An `excludes` entry
  that matches no file only gets a `note:` line. Observed edges that cross the
  slice boundary are always listed (`leaves` and `enters`, with counts; a
  package-root target is judged with excludes first, under both spellings) but
  fail the check only with `--closed`. `--strict` is described below.

**`contract`** writes `.hexagen/contract.json`, whose `sliceId` comes from
`slice.json`.

- `contract propose [--closed]` prints each pair of slice `paths` entries joined by
  an in-slice edge (both ends inside the slice, different entries) as a candidate
  `forbid` rule. With `--closed` it prints one candidate `closed` rule instead,
  whose `except` list names every crossing `observed.json` already makes, each
  target emitted exactly as `slice check` prints it: the file path for a file
  target, the package root for a package root, deduplicated, never widened to a
  bare directory name (an `except` entry without a trailing `/` is an exact file,
  so `lib` excepts nothing). Delete the entries you do not accept, and widen a
  file to its directory by hand. A crossing no `except` can accept — a
  root-package target (`.`), a target an `excludes` entry denies, or a target
  spelled as a directory — is reported as `not proposed:` with the advice that
  would accept it, because a rule naming one would still fail, or would accept
  far more than the crossing observed. Both printed `add-rule` lines — the
  cross-prefix one and the `--closed` one — are quoted for a POSIX shell, so
  `sh`, `bash` or `zsh` can run either as it stands; `cmd.exe` does not read
  those quotes, so do not paste one there. The cross-prefix line names the
  slice's own prefixes in `--from`/`--to`, and a prefix is a repo path, so a
  space or a `;` in one would otherwise split the command or run what follows.
  With `--closed`, an
  `observed.json` whose edges were not collected refuses (exit 2) and prints no
  command at all: nothing is known about the crossings, so "no edge leaves the
  slice" would be a claim the report cannot make. An incomplete edge list is a
  `note:` line, not a refusal. It writes nothing and takes no write flag.
- `contract add-rule --kind forbid|allow-only --from <prefix> --to <prefix>
[--severity error|warn] [--id <id>]` appends a rule (`error` by default). A
  `closed` rule takes `--except <prefix>…` and neither `--from` nor `--to`: the
  slice is the `from` side and `except[]` is the only escape hatch, so several
  accepted crossings out of one source are one rule. `--except` may be given with
  no prefixes at all, which accepts no crossing. Each kind refuses the other
  kinds' flags by name, and every `--from`, `--to` and `--except` entry must
  pass the slice-path rules, so a bare directory name (`libs/shared`) is an exact
  path and excepts nothing — write `libs/shared/`. The built-in id
  `unresolved-import`, an id outside `A-Za-z0-9._-` (1-64 chars, no `..`), a
  duplicate id, and a missing `--kind` are refused, the last as exit 2 like every
  other usage error.
- `contract show` prints the contract, and warns when **one** `closed` rule's
  `except` list covers every observed package root outside the slice: that rule
  then accepts every crossing it could have refused, so the slice is not closed.
  Rules are not pooled — two rules that between them cover the whole repo leave
  each edge one rule still to fail, which is what a closed slice wants. Coverage
  is asked per package root, so `--except apps/` covers `apps/web` and
  `apps/admin`, while `--except apps/web/ui/` covers neither the rest of its own
  package nor any sibling; a bare `apps` covers nothing. A package the slice
  occupies and one an `excludes` entry denies are not units to cover, and the
  root package (`.`) never is. A contract with no `closed` rule reads no scan at
  all, and a missing `slice.json`/`observed.json` is a `note:` line, not a
  refusal.
- `contract check [--baseline] [--base <ref>] [--allow-growth --reason <text>]`
  evaluates the rules against the observed edges whose `from` is inside the slice.
  A `forbid` rule fails on an edge from its
  `from` prefix to its `to` prefix. An `allow-only` rule fails on an edge from
  its `from` prefix to anywhere that is neither its `to` prefix nor its own
  `from` prefix. A `warn` rule is printed but does not fail the check. The
  built-in rule `unresolved-import` fails on **every** `unresolved` row whose
  `from` is in the slice (including `not-scanned`, `package-imports` and
  `non-literal`) and on every in-slice file whose extension is in
  `edges.unreadLanguages` (`go`, `py`, … joined on the extension, never on the
  display name), so a green result never means "the pass could not see the
  imports". If edges were not collected at all the check cannot be clean (exit
  code 1) and cannot be baselined. `--baseline` writes the current failing violations
  to `knownViolations` (keeping any `reason`/`expires` already there) and needs
  `--yes`; without it, any violation not in the baseline names its rule, file
  and specifier and exits 1. A known violation is matched on rule, file and
  specifier, and an entry whose `expires` date has passed (inclusive to the end
  of that UTC day) no longer hides its violation. A root-package target (`.`)
  is never inside a `to` prefix, so it always violates an `allow-only` rule.

  A `closed` rule fails on any edge from inside the slice to a target that is
  neither inside the slice nor under one of its `except` prefixes, so one rule
  holds every accepted crossing out of the slice: the prefix kinds admit exactly
  one. A package root is judged under both spellings, so
  `--except libs/shared/` covers `libs/shared` and `libs/shared/x.ts`, and an
  entry with no trailing `/` is an exact path. A root-package target (`.`) is
  never inside an `except` prefix, so it always violates a `closed` rule, exactly
  as it always violates an `allow-only` one. An edge whose source is inside an
  `excludes` entry is not judged at all, and under a `closed` rule an `excludes`
  entry creates violations instead of suppressing them: an except cannot re-open
  an excluded target, so an edge into one still fails even under an `except` that
  covers it. `--except src/` accepts every crossing out of `src/`, so read the
  list before you commit it.

**The `--base` ratchet.** `contract check --base <ref>` also reads
`.hexagen/contract.json` and `.hexagen/slice.json` **at** `<ref>` with `git show`,
and fails when the working tree has made the slice's gate weaker than the
contract there. It is a detection, not a write-time refusal: the change is already
committed, and each finding is printed as `growth: …` with the hash the base was
read at. Growth is:

- a `knownViolations` entry the base never had for that rule + file + specifier;
  an edit to the `file` or `specifier` of an entry the base did have;
- an `expires` pushed later from another `expires`, or dropped;
- a rule gone from the tree; a rule's `kind`, `from` or `to` changed, in either
  direction; a `closed` rule's `except` prefix added or widened; a rule's
  `severity` moved `error` → `warn`;
- a `slice.json` `excludes` entry the base did not have; a `paths` entry removed;
  a `paths` entry replaced by a strictly longer prefix.

**Not** growth: an entry removed, an `expires` shortened, an `expires` added where
the base had none, a `reason` added, a rule added, an exclude removed, a `paths`
entry added or widened, a duplicate baseline entry, two rules that share an id
swapped, an `except` prefix removed or narrowed, and a `severity` raised from
`warn` to `error`. Rules are matched by value, so two rules sharing an id are
compared as a multiset, and entries are matched on rule + file + specifier,
strongest cover first, so a duplicate that already carries no `expires` is not
reported as a dropped date.

`--allow-growth --reason <text>` accepts the growth, prints the reason beside the
finding and into the log, and the check then continues — so its exit code is
still the plain check's, not automatically 0. `--reason` on its own does nothing.

Both files must be staged for a base to exist: every writer of `.hexagen/` adds
it to the exclude file, so `git show` cannot tell "never staged" from "the commit
that first added it", and the command reports the absence instead of passing.
Stage them with `hexagen workbook export --stage` on
`.hexagen/slice.json` and `.hexagen/contract.json`, plus `--yes` (or plain
`git add -f`). Pass the pinned PR base, never a
PR-supplied ref: `--base` is client-supplied, so a workflow that lets a PR pick
its own base compares the head with itself and passes. The one PR that first
stages the sidecars has a base that predates them — that is the bootstrap case,
judged on violations alone, and the
[CI recipe](../../docs/ci/brownfield-gate-recipe.md) runs the plain check for it.
The guard runs after the slice-id and contract parse and **before**
`observed.json` is loaded, so growth is still reported when `observed.json` is
missing or stale. One gap it cannot close: `contract check --baseline --yes`
rewrites `knownViolations` with no base in sight, so it can drop an `expires` the
guard would otherwise have reported — `--base` and `--baseline` are refused
together.

**Concurrent edits.** `add-rule` and `check --baseline` (with `--yes`) hold
`.hexagen/contract.json.lock`, created exclusively with the process id inside,
while they read and rewrite `contract.json`, and remove it when they finish. If
the lock is already there they exit 2 ("another contract command is running").
A lock left behind by a killed command is never broken automatically: delete
the file yourself. A `knownViolations[].expires` that is not a real calendar
date is refused at load (exit 2).

**Writes.** `slice init`, `contract add-rule` and `contract check --baseline`
print a `will write:` line for each file, including the git exclude file when
`.hexagen/` is not yet in it, and write nothing without `--yes` (exit 2). The
exclude is updated first (a failure stops the command), then the file is written
as a temp file plus a link (a new file, never replacing one) or a rename (an
update of `contract.json`). The client's `.gitignore` is never edited, and
`git add -f` can still stage `.hexagen/`.

**Stale inputs.** `observed.json` must exist and its `repo.commit` must be the
slice's `repo.commit` or a descendant of it. If it was read at a commit other
than `HEAD` the commands warn, and with `--strict` fail.

**Exit codes** (`slice check`, `contract check`, `contract propose`):

| Code | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Clean (`slice check`, `contract check`), or growth accepted with `--allow-growth` **and** the plain check clean, or the command succeeded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 1    | Drift (`slice check`), or a violation not in the baseline, or incomplete edges, or growth against `--base` (`contract check`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2    | Bad input or refused: a missing or invalid file, a bad path or id, a refused overwrite, no `--yes`, a slice commit not in the repository, a stale `observed.json`, `--strict` and a different HEAD, an unresolvable `--base` (a shallow clone that never fetched it), a `.hexagen/` file absent at `--base` because it was never staged, a `.hexagen/` file at `--base` that exists but cannot be read, a base file that is not valid JSON or does not match its schema, an inconsistent base (the contract at `--base` names another slice than the slice there), `--allow-growth` without `--reason`, `--allow-growth` without `--base`, `--base` with `--baseline` |

`init`, `add-rule`, `show` and `--baseline` return 0 on success and 2 otherwise.

---

### `hexagen workbook export`

Two separate modes:

- `--out` creates one new file under `.hexagen/` in the working tree. It changes
  nothing else.
- `--stage` changes the git index and nothing else: it writes no file and
  never commits.

```bash
# the bundle: one new file under .hexagen/, never overwritten
npx hexagen workbook export --out .hexagen/workbook.zip [--root <dir>] [--key-file <path>] [--engagement <id>]

# the only way anything from .hexagen/ reaches the client's history (BW-D1)
npx hexagen workbook export --stage .hexagen/slice.json .hexagen/contract.json        # prints the diff, stages nothing
npx hexagen workbook export --stage .hexagen/slice.json .hexagen/contract.json --yes  # git add -f on exactly those files
```

**Bundle.** `bundle.json` (the index, with an HMAC from the engagement key,
resolved the same way as `grant` and `evidence pack`), `observed.json`,
`slice.json`, `contract.json` (the last two optional; `slice.json` is required),
`grants/<id>.json` (every grant in `.hexagen/grants/`, byte for byte, each
signature verified first), `proposals/<id>.patch` and `<id>.json`, the packed
evidence (`evidence/trace.jsonl`, `evidence/verdicts.json`, with the denials in
`verdicts.json`) and `tip.json`. Export runs the `evidence pack` logic, so a
broken chain, a truncated tail or a bad grant fails the export (exit 1, nothing
written) and the anchored tip advances as it does for `evidence pack`, even when
the final bundle write then fails.

**Allow-list.** The bundle is built from named files only; nothing else in
`.hexagen/` is read. A key or env file is never included: `grant-signing.key`,
any `*.key`, anything under `keys/` or `~/.hexagen/keys/`, any `.env*`. The
check runs on the source path and again on the bundle path. A key or env file
found inside `.hexagen/grants/` or `.hexagen/proposals/` refuses the whole
export (exit 2); a symlink there is refused too.

**`--out`** must resolve under `<root>/.hexagen/`, not under `evidence/`, and must
not exist; the bundle is written to a temporary file and hard-linked.

**`--stage`** accepts only allow-listed `.hexagen/` files (`observed.json`,
`slice.json`, `contract.json`, `grants/*.json`, `proposals/*.patch|json`,
`evidence/trace.jsonl`, `evidence/tip.json`). Without `--yes` it prints the
unified diff and stages nothing. With `--yes` it runs `git add -f` on exactly
those files; it never commits. One refused path (a key, a file off the list, a
path outside `.hexagen/`, a symlink) refuses the whole call and stages nothing.

| Code | Meaning                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- |
| 0    | Bundle written, or the stage diff printed / files staged                                     |
| 1    | A grant signature, the trace chain or the anchored tip is invalid; nothing written           |
| 2    | Bad input or refused: a bad `--out`, an existing file, a key or off-list path, no slice, ... |

---

### `hexagen evidence verify`

```text
hexagen evidence verify --since <git-ref> [--until <git-ref>]
                        --grant <file>... [--root <dir>]
                        [--key-file <path>] [--engagement <id>]
                        [--allow-empty]
```

A synopsis, not a runnable line: `[…]` marks an optional flag and `<…>` a value you
supply.

Names every changed file the kit governs — inside the slice (minus its excludes)
or inside any `--grant`'s `paths` — that no trace line appended after `--since`
covers. It is found after the fact, not refused: it reads only, never writes
`.hexagen/`, and never stops a write.

It reads the range `<since>..<until>` (default `HEAD`) with `git diff`, taking
the slice at **`<since>`** and the trace, the tip and the proposals at
**`<until>`**, so a range cannot widen its own scope or its own evidence.
`<since>` must be an ancestor of `<until>`. It then verifies the trace exactly as
`evidence pack` does — chain, line shape, the four Rules of
`docs/kernel/TRACE.md`, and the anchored tip — and joins each changed file to the
line that claims it. `tip.json` is **required** here, and only a line at or below
`tip.seq` covers anything: the chain binds each line to the one above it, but only
a key-holder's `pack` binds the head to the engagement key. A change that a line
would have covered on paper alone is still reported unaccounted, naming the seq to
pack. Every grant the trace cites must be supplied as a `--grant`, and the
engagement key comes from `--key-file`, then `HEXAGEN_GRANT_KEY_FILE`, then the
engagement — in CI that is a secret written outside the checkout, never a key in
the tree.

No Trace field carries the paths: the join reads them back from
`.hexagen/proposals/<id>.json` by its `traceSeq` and `grantId`, and recomputes
`result_digest` over `JSON.stringify({halt_reason, proposal_id, paths})`, so a
`paths` entry edited after the line was written breaks the digest instead of being
believed. Only a line whose `seq` is above the last `seq` in the trace as of
`<since>` can cover anything, read with `git show`; a checkout where the trace was
not tracked at `<since>`, or where that line is not the one the trace held there,
exits 2 rather than trusting a clock.

It prints the unaccounted paths on stdout and, on stderr, each one with the
nearest candidate line plus how many changes it skipped as outside the slice and
every grant. Exit 0 when nothing is unaccounted, 1 when something is, 2 for bad
input or bad state: an unresolvable `--since` or `--until` (a shallow clone that
never fetched it says so), a `--since` that is not an ancestor of `--until`, a
missing or unreadable slice at `<since>`, a missing or empty trace at `<until>`, a
missing or unverified `tip.json`, an unsound trace, a proposal that does not
reproduce its line's `result_digest`, a grant that does not verify, a trace not
tracked at `<since>`, a `--root` that is not the repo top level, and an empty
diff without `--allow-empty`.

Two limits worth stating: it proves an authorized line covering a path exists, not
that the line is true; and until Trace carries paths itself, a change applied
through `hexagen_accept_transaction` is unaccounted here, because that writer
leaves no path list behind. Coverage needs the `.hexagen/` evidence committed, so
stage it first — and in CI, pack before verify:

```bash
hexagen workbook export --stage .hexagen/slice.json \
  .hexagen/evidence/trace.jsonl \
  .hexagen/evidence/tip.json \
  .hexagen/grants/<id>.json \
  .hexagen/proposals/<id>.json \
  --yes
```

---

### The brownfield CI gate

A client repo holds only `.hexagen/` and no manifest, so the generated
conformance gate has nothing to run there. Copy
[`docs/ci/brownfield-gate.yml`](../../docs/ci/brownfield-gate.yml) into the client
repo's `.github/workflows/` and edit its one `EDIT SPOT`: the
`HEXAGEN_VERSION` pin. `contract check --base` (step 3) and `evidence verify`
(step 4b) first ship in 0.14.0, so that is the **minimum** the gate needs rather
than a published release — release tags are the owner's to cut. Set it to a
version you can install and bump it deliberately; `hexagen --help` is the check
that the pin exists, because an older CLI's command parser refuses those two
flags and the job then fails at step 3 for a reason that has nothing to do with
the change under review.

`evidence pack` and `evidence verify` are the two halves of the gate, and the
recipe is a document rather than a template:
[`docs/ci/brownfield-gate-recipe.md`](../../docs/ci/brownfield-gate-recipe.md).
Every step's `run:` script is read out of that workflow and executed against the
built CLI on a fixture client repo by
`__tests__/contract/brownfield-gate.contract.test.ts`, so the recipe cannot drift
from what the job does. The one exception is `Install the hexagen CLI`: the
fixture already holds the artifact that install fetches — the built dist, copied
into the consumer's `node_modules/@hexagen-monaco/sync` — so the install is the
only step the suite does not run. Every kit command, and every step that can
decide the job, does run.

- `evidence pack <trace> --grant <file>... --out <zip>` checks the whole trace and
  writes an HMAC'd bundle: 0 packed, 1 the evidence is invalid and nothing was
  written, 2 usage or a failed precondition (no key, `--out` outside `.hexagen/`,
  an `--out` that already exists). It is step 4, and it is also the only command
  that anchors a line — so it runs even where nothing needs the bundle, because
  step 4b counts only what a `pack` anchored.
- `evidence verify --since <ref> --grant <file>...` is step 4b and writes
  nothing. It is documented under
  [`hexagen evidence verify`](#hexagen-evidence-verify) above.

Fail-fast and in order, every step printing `step <n> exit <code>` — 1 is a
violation, 2 is bad input or stale state — and step 2 the one non-blocking
drift report. The steps are: the staged `.hexagen/` paths are tracked
(`git ls-files --error-unmatch`, exit 2 otherwise), `observe --out … --yes`,
`slice check --strict`, `contract check --base` against the pinned PR base SHA,
`evidence pack` into a disposable path under `.hexagen/`, then `evidence verify`
against the same base. Step 3 asks what the base holds and there are three
answers, not two: both sidecar files (compare, and let violations and growth
fail), neither (the PR that first stages them, judged on violations alone), or
exactly one — which it refuses with exit 2 rather than compare half a baseline.
Step 4b is skipped on exactly one PR, the bootstrap whose base carries no slice;
a base with a slice but no trace runs it and lets it exit 2.

The gate needs no manifest, no `apps/web` and no workbench package: the published
CLI is the only dependency. The engagement key is injected from a CI secret into
`$RUNNER_TEMP` at mode 0600 and read through `HEXAGEN_GRANT_KEY_FILE`, never
from the checkout. A missing or weak key is a denial, never a skip — and
because the job is fail-fast, only the first step that reads the key reports
it: the injection step exits 2 on an empty secret, while a non-empty but weak
key is caught by `evidence pack` in step 4, which exits 2 too.
`evidence verify` never runs in either case, because the job stopped first. The
bundle's HMAC is symmetric, so the CI secret can forge it and the FDE and CI
cannot be told apart.

---

## Programmatic Usage

> **The supported contract of this package is the `hexagen` binary.** The root
> barrel below is **provisional under 0.x** (ADR-0056): names may be withdrawn,
> and a withdrawal rides a **minor** — never a patch — and is listed by name in
> that release's `CHANGELOG.md` section. Programmatic use is permitted and
> unsupported. Prefer the CLI unless you are embedding the engine.
>
> _(Before 0.10.0 this section documented a `runSync` function. No such export
> has ever existed — the example was wrong for the life of the package.)_

The barrel exposes the engine the CLI drives. Types ship alongside the bundle.

```ts
import { SyncEngine, type LoggerPort } from "@hexagen-monaco/sync";

const logger: LoggerPort = {
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
  errorWithException: (err, message) => console.error(message, err),
};

const dryRun = false;

const engine = new SyncEngine(
  {
    mode: "external", // 'external' honours the workspace root you give it
    dryRun,
    force: false,
    forceRoot: false,
    allowDirty: false,
    strict: false,
    logger,
  },
  { targetRoot: process.cwd() },
);

const summary = await engine.run();

// `run()` RESOLVES when a generator fails soft — it does not throw. Check the
// count, or a partial tree reads as success.
if (summary.errors > 0) {
  throw new Error(`sync finished with ${summary.errors} generator failure(s)`);
}

// Only needed if you set `dryRun: true`. A missing
// `.architecture/manifest.yaml` REJECTS `run()` on a real run, but a dry run
// tolerates it by synthesizing an empty manifest — which plans ops against
// nothing and still resolves with `errors: 0`. That is the same fact the CLI
// gates `--check` on.
if (dryRun && summary.manifestMissing) {
  throw new Error("no .architecture/manifest.yaml in the target workspace");
}
```

The package is ESM-only (`"type": "module"`). Consumers that still use
CommonJS must use dynamic `import()` or transpile via their bundler.

### Workspace resolution modes

How the engine locates the workspace root depends on `mode`:

| Mode         | Root resolution                                                       | Used by                                          |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------ |
| `external`   | The explicit `workspaceRoot` you pass (typically `process.cwd()`).    | The published CLI run inside a consumer project. |
| `self-regen` | The workspace of the **package the engine lives in** — _not_ the cwd. | The hexagen monorepo regenerating itself.        |

> **Monorepo footgun (issue #179).** `self-regen` deliberately ignores the
> current directory and walks up from the engine's own location. This is
> correct for the published CLI (installed into your project's `node_modules`,
> it resolves _your_ project) and for the monorepo regenerating itself. But it
> means running the monorepo's **built `dist/cli.js` from an unrelated
> directory targets the monorepo, not that directory** — it will happily
> rewrite the monorepo's files. To operate on another project, always use
> `mode: "external"` with an explicit `workspaceRoot`, never the in-tree
> `dist` CLI. The capstone harness relies on this distinction and guards it.

---

## Requirements

| Requirement | Version                              |
| ----------- | ------------------------------------ |
| Node.js     | ≥ 20                                 |
| Module kind | ESM (`"type": "module"` in consumer) |

---

## What's Bundled

When `@hexagen-monaco/sync` is published, the tarball contains the sync engine
plus four inlined workspace packages:

| Bundled package                  | Purpose                                    |
| -------------------------------- | ------------------------------------------ |
| `@hexagen/governance`            | Linter report schemas and invariant rules  |
| `@hexagen/project-configuration` | Manifest + project spec schemas            |
| `@hexagen/shared`                | Shared value objects, logger, result types |
| `@hexagen/visualization`         | Architecture graph schemas                 |

Bundling is handled at build time by [`tsup`](https://tsup.egoist.dev/) and
is codified in [`.architecture/decisions/ADR-0068-published-cli-bundling.md`](../../.architecture/decisions/ADR-0068-published-cli-bundling.md).

### Runtime Dependencies (not bundled)

| Package     | Version   | Why it stays external                  |
| ----------- | --------- | -------------------------------------- |
| `commander` | `^14.0.3` | Stable CLI arg parser; semver-stable   |
| `js-yaml`   | `^4.1.0`  | Manifest parsing; widely-consumed peer |

Both are pulled in transitively through standard `npm install` resolution
when `@hexagen-monaco/sync` is installed.

---

## For Maintainers — Publishing

`@hexagen/sync` uses a publish staging flow to avoid contaminating the
source manifest with publish-time mutations. The flow:

```bash
# 1. Build the package (tsup + tsc --emitDeclarationOnly + fix-esm-barrels)
yarn workspace @hexagen/sync build

# 2. Stage the publishable artifact into packages/sync/publish/
yarn workspace @hexagen/sync pack:prepare

# 3. Inspect the staged manifest before packing (optional but recommended)
cat packages/sync/publish/package.json

# 4. Create the tarball from the staging dir
cd packages/sync/publish
npm pack

# 5. (When ready) Publish
npm publish  # reads publish/package.json, not source
```

The staging script (`scripts/prepare-publish-package.js`) is shared and
parameterized — it works for any workspace package that adopts this
pattern.

### What the Staging Script Strips

From the published `package.json`, the script removes:

- `private` (prevents npm publish)
- `devDependencies` (never shipped to consumers)
- `scripts` (reference dev-only paths like `../../scripts`)
- `workspaces`, `packageManager`, `resolutions` (monorepo-only fields)
- Any `dependencies` using the `workspace:*` protocol (they're bundled
  into the output JS at build time)

The source `packages/sync/package.json` is never mutated by this process.

---

## Links

- **HexaGen Monaco repository:** https://github.com/martinkrakowski/hexagen-monaco
- **Architecture Decision Record:** [`ADR-0068`](../../.architecture/decisions/ADR-0068-published-cli-bundling.md) — CLI Bundling Strategy
- **Manifest schema:** `@hexagen/project-configuration`
- **Brownfield CI gate recipe:** [`docs/ci/brownfield-gate-recipe.md`](../../docs/ci/brownfield-gate-recipe.md) — the gate a client repo runs when the workbench is gone
- **Issue tracker:** https://github.com/martinkrakowski/hexagen-monaco/issues

---

## License

Licensed under the Source-Available Evaluation License. See [LICENSE](./LICENSE).

The Hexagen-Monaco name is a trademark of Krakowski Cloud Solutions, LLC.
