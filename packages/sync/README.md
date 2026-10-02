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
- **Issue tracker:** https://github.com/martinkrakowski/hexagen-monaco/issues

---

## License

Licensed under the Source-Available Evaluation License. See [LICENSE](./LICENSE).

The Hexagen-Monaco name is a trademark of Krakowski Cloud Solutions, LLC.
