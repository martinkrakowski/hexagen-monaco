# YAML Editing Disciplines

**Status:** Accepted
**Context:** `.architecture/manifest.yaml` and `.architecture/invariants/linter-config.yaml`

---

## Problem

Agents repeatedly break these files by writing list items at the wrong indentation level,
producing:

```
YAML parse error: end of the stream or a document separator is expected
```

Root cause: when an edit tool inserts a replacement block, the agent must match surrounding
indentation exactly. YAML is whitespace-sensitive — a single missing space cascades.

---

## Canonical Indentation Contract

| File                 | Top-level key               | List item           | Nested map key                     | Nested list                                |
| -------------------- | --------------------------- | ------------------- | ---------------------------------- | ------------------------------------------ |
| `manifest.yaml`      | `bounded_contexts:` (col 0) | `  - name:` (col 2) | `    plane:` / `    file:` (col 4) | — (entries are flat maps; no nested lists) |
| `linter-config.yaml` | `package_rules:` (col 0)    | `  - name:` (col 2) | `    allowed_imports:` (col 4)     | `      - '@hexagen/shared'` (col 6)        |

---

## Mandatory Pre-Edit Steps

1. Run `grep -n "^  - name:\|^- name:" <file>` to confirm current indentation pattern.
2. When inserting a new list item, count the leading spaces on the **previous** list item
   and match exactly.
3. Use an `oldString` that includes at least one surrounding list item boundary so
   indentation context is unambiguous.
4. Never insert `- name:` at column 0 if the existing list uses `  - name:` (column 2).

---

## Mandatory Post-Edit Validation

```bash
python3 -c "import yaml; yaml.safe_load(open('.architecture/manifest.yaml'))" && echo OK
yarn lint:arch
```

If either fails — **STOP**. Do not proceed until both pass.

---

## Recovery Procedure

If `yaml.safe_load` fails with `expected <block end>, but found '-'`, a list item was
inserted at column 0 instead of column 2.

```python
# Re-indent the offending section:
# For every line from `- name: X` (col 0) to the next `  - name:` (col 2),
# prepend 2 spaces. Preserve blank lines.
with open('.architecture/manifest.yaml', 'r') as f:
    lines = f.readlines()

# Identify the malformed block by line number from the yaml error,
# then prepend '  ' to each line in that block.
```

---

## Style Constraint

Never use flow-style (`{ key: value }`) as a workaround for indentation problems unless
the original document already uses flow-style at that location.
