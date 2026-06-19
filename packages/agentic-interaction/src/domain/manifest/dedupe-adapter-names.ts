import type { AdapterBindings } from "../value-objects/pipeline-state";
import { toPascalCase } from "./normalize-draft";

export interface RenamedAdapter {
  contextName: string;
  from: string;
  to: string;
}

/**
 * Make adapter names globally unique (R12: "No two contexts share the same
 * adapter name") deterministically, before the manifest and the Stage-6 prompt
 * are built — so the generated manifest can't carry a code-generation collision
 * (adapter names map to files/classes/DI tokens) and the LLM reviewer has no R12
 * to flag.
 *
 * Keeps the first occurrence of each name and context-prefixes later duplicates
 * (`${PascalContext}${name}`), falling back to an integer suffix if the prefixed
 * name also collides. Only `AdapterBinding.name` changes — `implements` (the port
 * reference the R04/R05/R06 grounding keys on) is untouched.
 *
 * "First occurrence" relies on `adapterBindings.contexts` being in a stable order:
 * Stage 4 streams contexts in arrival order and the merge preserves it, so the
 * result is deterministic across runs of the same input.
 *
 * Pure: returns augmented copies (no input mutation) plus the list of renames for
 * advisory surfacing. Returns the input unchanged when nothing needs renaming.
 */
export function dedupeAdapterNames(adapterBindings: AdapterBindings): {
  adapterBindings: AdapterBindings;
  renamed: RenamedAdapter[];
} {
  const used = new Set<string>();
  const renamed: RenamedAdapter[] = [];

  const contexts = adapterBindings.contexts.map((ctx) => {
    const prefix = toPascalCase(ctx.contextName);
    const adapters = ctx.adapters.map((adapter) => {
      const unique = claimUniqueName(adapter.name, prefix, used);
      used.add(unique);
      if (unique === adapter.name) return adapter;
      renamed.push({
        contextName: ctx.contextName,
        from: adapter.name,
        to: unique,
      });
      return { ...adapter, name: unique };
    });
    return { ...ctx, adapters };
  });

  // Nothing collided — hand back the original reference (no churn for the common
  // case, where every adapter name is already unique).
  if (renamed.length === 0) {
    return { adapterBindings, renamed };
  }
  return { adapterBindings: { contexts }, renamed };
}

/**
 * Pick a free name for `name`: prefer it as-is, else context-prefix it, else
 * append the smallest free integer to the prefixed form. `used` holds names
 * already claimed earlier in the walk; the loop terminates because `used` is
 * finite and `n` strictly increases.
 *
 * Read-only on `used` — the caller MUST `used.add()` the returned name before the
 * next call, or two adapters could be handed the same "unique" name.
 */
function claimUniqueName(
  name: string,
  prefix: string,
  used: Set<string>,
): string {
  if (!used.has(name)) return name;
  const prefixed = `${prefix}${name}`;
  if (!used.has(prefixed)) return prefixed;
  let n = 2;
  while (used.has(`${prefixed}${n}`)) n += 1;
  return `${prefixed}${n}`;
}
