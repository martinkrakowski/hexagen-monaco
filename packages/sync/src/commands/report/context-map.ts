import type { Manifest } from "../../types/manifest.js";
import { extractPorts } from "../../types/manifest.js";
import type { BoundedContext } from "../../types/manifest.js";

function contextsOf(manifest: Manifest): BoundedContext[] {
  return (
    (manifest.bounded_contexts as BoundedContext[] | undefined) ??
    (manifest.boundedContexts as BoundedContext[] | undefined) ??
    []
  );
}

/**
 * Context map as Mermaid text. Mirrors the accept-view classDiagram
 * (ports in/out) plus a flowchart of `depends_on`. No Next.js import.
 */
export function generateContextMapMermaid(manifest: Manifest): string {
  const contexts = contextsOf(manifest);
  const lines: string[] = ["flowchart LR"];

  if (contexts.length === 0) {
    lines.push('  empty["(no bounded contexts)"]');
    return `${lines.join("\n")}\n`;
  }

  const idMap = new Map<string, string>();
  contexts.forEach((ctx, i) => idMap.set(ctx.name, `ctx${i}`));
  function getId(name: string) {
    return idMap.get(name) || `unknown_${name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  }
  function escapeLabel(text: string) {
    return text.replace(/"/g, "#quot;");
  }

  for (const ctx of contexts) {
    const id = getId(ctx.name);
    const type = ctx.type ? `\\n<${ctx.type}>` : "";
    lines.push(`  ${id}["${escapeLabel(ctx.name)}${type}"]`);
  }

  const seen = new Set<string>();
  for (const ctx of contexts) {
    const from = getId(ctx.name);
    for (const dep of ctx.depends_on ?? []) {
      const edge = `${from}-->${getId(dep)}`;
      if (seen.has(edge)) continue;
      seen.add(edge);
      lines.push(`  ${from} --> ${getId(dep)}`);
    }
    for (const rel of ctx.relationships ?? []) {
      const edge = `${from}-->${getId(rel.context)}`;
      if (seen.has(edge)) continue;
      seen.add(edge);
      const label = rel.pattern ? `|${rel.pattern}|` : "";
      lines.push(`  ${from} -->${label} ${getId(rel.context)}`);
    }
  }

  lines.push("");
  lines.push("classDiagram");
  for (const ctx of contexts) {
    const id = getId(ctx.name);
    const { inPorts, outPorts } = extractPorts(ctx);
    lines.push(`  class ${id} {`);
    lines.push("    <<Bounded Context>>");
    if (ctx.type) lines.push(`    <<${ctx.type}>>`);
    for (const p of inPorts) lines.push(`    +${p}`);
    for (const p of outPorts) lines.push(`    -${p}`);
    lines.push("  }");
  }

  return `${lines.join("\n")}\n`;
}

export function contextCount(manifest: Manifest): number {
  return contextsOf(manifest).length;
}

export function systemNameOf(manifest: Manifest): string {
  return typeof manifest.system === "string" && manifest.system.length > 0
    ? manifest.system
    : "(unnamed)";
}
