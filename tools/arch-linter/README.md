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
```

It exits non-zero on violations, so it drops straight into CI:

```yaml
- run: npx hexagen-lint
```

If you also use `@hexagen-monaco/sync`, `hexagen sync` runs the linter for you —
invoking `hexagen-lint` directly is for standalone or CI checks.

---

## What it checks

Reading your manifest and the optional invariant files, the linter enforces:

| Check                          | Source                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Manifest validity**          | `.architecture/manifest.yaml` (schema-validated; split manifests merged)                                                                                                                              |
| **Layer access rules**         | `layer-rules.yaml` → `layers[*].allowed_imports` — which layers may import which                                                                                                                      |
| **Cross-package import rules** | `linter-config.yaml` → `package_rules` (`allowed_imports` / `cannot_import` / `restricted_to`)                                                                                                        |
| **Global whitelist**           | `linter-config.yaml` → `global_whitelist` — packages/subpaths importable from anywhere (default `@{scope}/shared` and `@{scope}/shared/**`, so the shared kernel and its subpaths are always allowed) |
| **Server/client boundaries**   | `linter-config.yaml` → `subpath_conventions` — `server`/`client` subpath markers + allowed consumers                                                                                                  |

TypeScript analysis resolves sources via `tsconfig.base.json` at the project
root.

---

## Required project files

| Path                                          | Required | Purpose                                                                              |
| --------------------------------------------- | :------: | ------------------------------------------------------------------------------------ |
| `.architecture/manifest.yaml`                 |    ✅    | The architecture definition the linter validates against                             |
| `tsconfig.base.json`                          |    ✅    | Resolves TypeScript sources and path aliases                                         |
| `.architecture/invariants/layer-rules.yaml`   | optional | Per-layer access rules + shared-kernel layer allowance                               |
| `.architecture/invariants/linter-config.yaml` | optional | Cross-package `package_rules`, `global_whitelist`, subpath/server-marker conventions |

A project scaffolded by `@hexagen-monaco/sync` already ships all of these.

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

MIT
