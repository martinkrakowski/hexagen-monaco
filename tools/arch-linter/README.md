# @hexagen-monaco/arch-linter

> Architecture linter for HexaGen Monaco projects — validates your
> `.architecture/manifest.yaml` and enforces Hexagonal-architecture boundaries
> across a generated monorepo.

`@hexagen-monaco/arch-linter` is the companion linter to
[`@hexagen-monaco/sync`](https://www.npmjs.com/package/@hexagen-monaco/sync).
Where `sync` _generates_ the architecture, the linter _guards_ it: it parses
your TypeScript with [`ts-morph`](https://ts-morph.com/) and fails when an
import crosses a layer or context boundary the manifest forbids.

---

## Installation

```bash
npm install --save-dev @hexagen-monaco/arch-linter
# or
yarn add --dev @hexagen-monaco/arch-linter
```

It installs a single binary, `hexagen-lint`.

---

## Usage

Run it from anywhere inside a HexaGen project:

```bash
npx hexagen-lint
```

The linter discovers the project root by walking up from the current directory
to the nearest `.architecture/manifest.yaml`. You can override that:

```bash
# Point at a specific project root
npx hexagen-lint --root ./path/to/project

# ...or via an environment variable
HEXAGEN_ROOT=./path/to/project npx hexagen-lint

# Validate against a specific manifest file
npx hexagen-lint --manifest ./.architecture/manifest.yaml

# Use a baseline file other than .architecture/arch-lint-baseline.json.
# A relative path resolves from the project root (--root/HEXAGEN_ROOT), not the
# current directory, so this names the same file wherever the run starts from.
npx hexagen-lint --baseline ./ci/arch-lint-baseline.json

# (Re)write the baseline from the current run instead of enforcing against it
npx hexagen-lint --update-baseline

# Explicit ratchet (the default when a baseline file is present).
# 0.10.0 unpublished contract — not on the published 0.9.0 tarball:
#   --pr-diff           only this PR's new findings vs the base-branch baseline
#   --base-ref <ref>    git ref for --pr-diff (or GITHUB_BASE_REF)
#   --staged            only findings on git-staged files
#   --json              machine-readable partition on stdout
#   --comment-file PATH write a PR comment body (empty when clean)
npx hexagen-lint --ratchet --pr-diff
```

Each baseline entry may carry optional `reason` and `expires` (`YYYY-MM-DD`).
Unknown fields are a parse error. An expired suppression fails the gate.

It exits non-zero on violations, so it drops straight into CI:

```yaml
- run: npx hexagen-lint
```

### Exit codes

| Code | Meaning                                                                  |
| ---- | ------------------------------------------------------------------------ |
| `0`  | Ran to completion; the tree is compliant (the run names what it checked) |
| `1`  | Ran to completion; found violations that are not in the baseline         |
| `2`  | **Could not run** — nothing was checked, so trust nothing                |

`2` covers every fail-closed abort: no project root, a missing or unloadable
manifest, a `layer-rules.yaml` / `linter-config.yaml` / baseline that exists but
will not parse, a `--baseline` with no value, and — via the `yarn lint:arch`
launcher in this repo (`bin/lint-arch.mjs`) — an unbuilt linter. It is a separate
code from `1` on purpose: a caller that cannot tell "the gate found problems"
from "the gate never ran" is one reordered build step away from a green check
over an empty run.

If you also use `@hexagen-monaco/sync`, `hexagen sync` runs the linter for you —
invoking `hexagen-lint` directly is for standalone or CI checks.

---

## What it checks

Reading your manifest and the optional invariant files, the linter enforces:

| Check                          | Source                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Manifest validity**          | `.architecture/manifest.yaml` (schema-validated; split manifests merged)                                                                                                                                                                                                                                                                                                                              |
| **Layer access rules**         | `layer-rules.yaml` → `layers[*].allowed_imports` — which layers may import which                                                                                                                                                                                                                                                                                                                      |
| **Cross-package import rules** | `linter-config.yaml` → `package_rules` (`allowed_imports` / `cannot_import` / `restricted_to`)                                                                                                                                                                                                                                                                                                        |
| **Global whitelist**           | `linter-config.yaml` → `global_whitelist` — packages/subpaths importable from anywhere. Patterns are exact-match unless they end in `/**`. The **scaffold** writes `@{scope}/shared` + `@{scope}/shared/**` (kernel root **and** its subpaths). With **no `linter-config.yaml`**, the linter's built-in fallback is only `@{scope}/shared` (the kernel root — subpaths need an explicit `/**` entry). |
| **Server/client boundaries**   | `linter-config.yaml` → `subpath_conventions` — `server`/`client` subpath markers + allowed consumers                                                                                                                                                                                                                                                                                                  |

TypeScript analysis resolves sources via `tsconfig.base.json` at the project
root.

### Layer purity

Beyond `allowed_imports`, `domain/` and `application/` files are held to three
purity rules (ADR-0054 §2):

| Rule                          | What fails                                                                      | Layers              |
| ----------------------------- | ------------------------------------------------------------------------------- | ------------------- |
| `cross-layer-relative-import` | a relative import that resolves into a different layer the rules do not allow   | domain, application |
| `node-builtin-in-layer`       | `node:fs`, `fs`, `path`, … — Node builtins have no business inside these layers | domain, application |
| `npm-package-in-domain`       | a bare npm package specifier, unless allowlisted for that bounded context       | domain only         |

Same-layer relative imports are always legal, and a relative import whose target
sits in no layer at all is not this rule's business. Application-layer npm
packages are deliberately unrestricted — application is the composition seam.

Declare an exception for the third rule in `linter-config.yaml`:

```yaml
domain_package_allowlist:
  - package: manifest-generation # bounded context ('*' for all)
    allowed_packages:
      - js-yaml
```

The list is **empty by default**: a scaffolded project inherits no exceptions.

### The ratchet baseline

An existing project rarely starts clean, so the linter fails only on violations
that are **not** already recorded in a committed baseline
(`.architecture/arch-lint-baseline.json` by default):

- seed it once with `hexagen-lint --update-baseline`, then commit it;
- every later run fails on any violation missing from the file — that is a
  regression;
- as violations get fixed, the run names the entries that no longer reproduce so
  the fixing change can delete its own lines. The file is expected to shrink and
  never to grow; when it is empty, delete it and the linter is strict.

No baseline file means everything is enforced. A baseline that exists but cannot
be parsed is a fatal error, for the same reason a malformed config is.

---

## Required project files

| Path                                          | Required | Purpose                                                                                                          |
| --------------------------------------------- | :------: | ---------------------------------------------------------------------------------------------------------------- |
| `.architecture/manifest.yaml`                 |    ✅    | The architecture definition the linter validates against                                                         |
| `tsconfig.base.json`                          |    ✅    | Resolves TypeScript sources and path aliases                                                                     |
| `.architecture/invariants/layer-rules.yaml`   | optional | Per-layer access rules + shared-kernel layer allowance                                                           |
| `.architecture/invariants/linter-config.yaml` | optional | Cross-package `package_rules`, `global_whitelist`, `domain_package_allowlist`, subpath/server-marker conventions |
| `.architecture/arch-lint-baseline.json`       | optional | Accepted, pre-existing violations — the ratchet only fails on new ones                                           |

A project scaffolded by `@hexagen-monaco/sync` already ships all of these.

**"Optional" means absent, not broken.** A missing `layer-rules.yaml` /
`linter-config.yaml` warns and falls back to built-in defaults. A file that
exists but cannot be read or parsed is a **fatal error** (exit 2) — defaulting
there would silently disable every rule that file declares while the run still
reported "Architecture is compliant". An empty or comments-only file parses
cleanly and is treated as a legitimate empty config, not an error.

---

## Requirements

| Requirement | Version                              |
| ----------- | ------------------------------------ |
| Node.js     | ≥ 20                                 |
| Module kind | ESM (`"type": "module"` in consumer) |

---

## Links

- **`@hexagen-monaco/sync`** — the generator this linter pairs with: https://www.npmjs.com/package/@hexagen-monaco/sync
- **Repository:** https://github.com/martinkrakowski/hexagen-monaco
- **Issues:** https://github.com/martinkrakowski/hexagen-monaco/issues

---

## License

Licensed under the Functional Source License, Version 1.1, Apache 2.0 Future License (FSL-1.1-Apache-2.0). See [LICENSE](./LICENSE). Internal use — including commercial internal use — is permitted; competing use is not. Each published version converts to Apache-2.0 two years after it is made available. Published tarballs ≤0.9.0 remain under the evaluation license forever.

The Hexagen-Monaco name is a trademark of Krakowski Cloud Solutions, LLC.
