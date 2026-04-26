import type { Manifest } from "../manifest-schema/manifest-schema";

export interface DiffEntry {
  type: "port" | "context";
  operation: "add" | "remove" | "modify";
  contextName?: string;
  name?: string;
  direction?: "in" | "out";
  details?: string;
}

export interface ManifestDiff {
  portsAdded: DiffEntry[];
  portsRemoved: DiffEntry[];
  contextsAdded: DiffEntry[];
  contextsRemoved: DiffEntry[];
  contextsModified: DiffEntry[];
}

function diffPorts(
  current: Manifest,
  previous: Manifest,
): { added: DiffEntry[]; removed: DiffEntry[] } {
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];

  const currentPorts = new Map<
    string,
    { context: string; direction: "in" | "out" }
  >();
  const previousPorts = new Map<
    string,
    { context: string; direction: "in" | "out" }
  >();

  for (const ctx of current.bounded_contexts ?? []) {
    const appPorts = ctx.layers?.application?.ports;
    for (const dir of ["in", "out"] as const) {
      for (const port of appPorts?.[dir] ?? []) {
        currentPorts.set(`${ctx.name}/${dir}:${port}`, {
          context: ctx.name,
          direction: dir,
        });
      }
    }
  }

  for (const ctx of previous.bounded_contexts ?? []) {
    const appPorts = ctx.layers?.application?.ports;
    for (const dir of ["in", "out"] as const) {
      for (const port of appPorts?.[dir] ?? []) {
        previousPorts.set(`${ctx.name}/${dir}:${port}`, {
          context: ctx.name,
          direction: dir,
        });
      }
    }
  }

  for (const [key, val] of currentPorts) {
    if (!previousPorts.has(key)) {
      added.push({
        type: "port",
        operation: "add",
        contextName: val.context,
        name: key.split(":")[1],
        direction: val.direction,
      });
    }
  }

  for (const [key, val] of previousPorts) {
    if (!currentPorts.has(key)) {
      removed.push({
        type: "port",
        operation: "remove",
        contextName: val.context,
        name: key.split(":")[1],
        direction: val.direction,
      });
    }
  }

  return { added, removed };
}

function diffContexts(
  current: Manifest,
  previous: Manifest,
): { added: DiffEntry[]; removed: DiffEntry[]; modified: DiffEntry[] } {
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const modified: DiffEntry[] = [];

  const currentContexts = new Map(
    (current.bounded_contexts ?? []).map((c) => [c.name, c]),
  );
  const previousContexts = new Map(
    (previous.bounded_contexts ?? []).map((c) => [c.name, c]),
  );

  for (const [name, ctx] of currentContexts) {
    if (!previousContexts.has(name)) {
      added.push({ type: "context", operation: "add", contextName: name });
    } else {
      const prev = previousContexts.get(name)!;
      if (ctx.type !== prev.type || ctx.description !== prev.description) {
        const changes: string[] = [];
        if (ctx.type !== prev.type)
          changes.push(`type: ${prev.type} → ${ctx.type}`);
        if (ctx.description !== prev.description) {
          changes.push(
            `description: "${prev.description}" → "${ctx.description}"`,
          );
        }
        modified.push({
          type: "context",
          operation: "modify",
          contextName: name,
          details: changes.join(", "),
        });
      }
    }
  }

  for (const [name] of previousContexts) {
    if (!currentContexts.has(name)) {
      removed.push({ type: "context", operation: "remove", contextName: name });
    }
  }

  return { added, removed, modified };
}

export function computeDiff(
  current: Manifest,
  previous: Manifest,
): ManifestDiff {
  const portDiff = diffPorts(current, previous);
  const contextDiff = diffContexts(current, previous);

  return {
    portsAdded: portDiff.added,
    portsRemoved: portDiff.removed,
    contextsAdded: contextDiff.added,
    contextsRemoved: contextDiff.removed,
    contextsModified: contextDiff.modified,
  };
}

export function formatDiff(diff: ManifestDiff): string {
  const lines: string[] = [];

  if (
    diff.portsAdded.length === 0 &&
    diff.portsRemoved.length === 0 &&
    diff.contextsAdded.length === 0 &&
    diff.contextsRemoved.length === 0 &&
    diff.contextsModified.length === 0
  ) {
    return "✅ No changes detected";
  }

  if (diff.contextsAdded.length > 0) {
    lines.push("Contexts added:");
    for (const c of diff.contextsAdded) {
      lines.push(` [+] ${c.contextName}`);
    }
  }

  if (diff.contextsRemoved.length > 0) {
    lines.push("Contexts removed:");
    for (const c of diff.contextsRemoved) {
      lines.push(` [-] ${c.contextName}`);
    }
  }

  if (diff.contextsModified.length > 0) {
    lines.push("Contexts modified:");
    for (const c of diff.contextsModified) {
      lines.push(` [*] ${c.contextName}: ${c.details}`);
    }
  }

  if (diff.portsAdded.length > 0) {
    lines.push("Ports added:");
    for (const p of diff.portsAdded) {
      lines.push(` [+] ${p.contextName}/${p.direction}:${p.name}`);
    }
  }

  if (diff.portsRemoved.length > 0) {
    lines.push("Ports removed:");
    for (const p of diff.portsRemoved) {
      lines.push(` [-] ${p.contextName}/${p.direction}:${p.name}`);
    }
  }

  const total =
    diff.portsAdded.length +
    diff.portsRemoved.length +
    diff.contextsAdded.length +
    diff.contextsRemoved.length +
    diff.contextsModified.length;

  lines.push(`\nTotal: ${total} change(s)`);

  return lines.join("\n");
}
