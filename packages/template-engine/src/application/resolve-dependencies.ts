import type { TemplateManifest } from "../domain/index.js";

export class CyclicDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Cyclic dependency detected: ${cycle.join(" → ")}`);
    this.name = "CyclicDependencyError";
  }
}

export class MissingTemplateError extends Error {
  constructor(
    public readonly templateId: string,
    public readonly requiredBy: string,
  ) {
    super(
      `Template '${requiredBy}' requires '${templateId}', which is not in the registry`,
    );
    this.name = "MissingTemplateError";
  }
}

export class ConflictError extends Error {
  constructor(
    public readonly a: string,
    public readonly b: string,
  ) {
    super(
      `Templates '${a}' and '${b}' conflict and cannot be applied together`,
    );
    this.name = "ConflictError";
  }
}

/**
 * Given a set of requested template IDs and the full registry, returns the
 * ordered list of template IDs that must be applied (including auto-resolved
 * dependencies), in topological order (dependencies first).
 *
 * Throws CyclicDependencyError, MissingTemplateError, or ConflictError if the
 * graph is invalid.
 */
export function resolveDependencies(
  requested: string[],
  registry: Map<string, TemplateManifest>,
): string[] {
  // Build the full set needed (requested + all transitive requirements).
  // parent tracks who directly required each dep so error messages are accurate
  // even for transitive missing templates.
  const needed = new Set<string>();
  const parent = new Map<string, string>();
  const stack: string[] = [...requested];

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (needed.has(id)) continue;
    needed.add(id);

    const manifest = registry.get(id);
    if (!manifest) {
      throw new MissingTemplateError(id, parent.get(id) ?? id);
    }

    for (const dep of manifest.requires) {
      if (!needed.has(dep)) {
        parent.set(dep, id);
        stack.push(dep);
      }
    }
  }

  // Check conflicts
  for (const id of needed) {
    const manifest = registry.get(id)!;
    for (const conflictId of manifest.conflicts) {
      if (needed.has(conflictId)) {
        throw new ConflictError(id, conflictId);
      }
    }
  }

  // Topological sort (DFS, Kahn-style post-order)
  const sorted: string[] = [];
  const state = new Map<string, "visiting" | "done">();

  function visit(id: string, path: string[]): void {
    const s = state.get(id);
    if (s === "done") return;
    if (s === "visiting") {
      const cycleStart = path.indexOf(id);
      throw new CyclicDependencyError([...path.slice(cycleStart), id]);
    }

    state.set(id, "visiting");
    const manifest = registry.get(id)!;
    for (const dep of manifest.requires) {
      if (needed.has(dep)) visit(dep, [...path, id]);
    }
    state.set(id, "done");
    sorted.push(id);
  }

  for (const id of needed) {
    visit(id, []);
  }

  return sorted;
}
