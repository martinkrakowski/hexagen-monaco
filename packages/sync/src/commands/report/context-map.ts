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

function mermaidId(name: string): string {
  const id = name.replace(/[^a-zA-Z0-9_]/g, "_");
  return id.length > 0 ? id : "ctx";
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

  for (const ctx of contexts) {
    const id = mermaidId(ctx.name);
    const type = ctx.type ? ` (${ctx.type})` : "";
    lines.push(`  ${id}["${ctx.name}${type}"]`);
  }

  const seen = new Set<string>();
  for (const ctx of contexts) {
    const from = mermaidId(ctx.name);
    for (const dep of ctx.depends_on ?? []) {
      const edge = `${from}-->${mermaidId(dep)}`;
      if (seen.has(edge)) continue;
      seen.add(edge);
      lines.push(`  ${from} --> ${mermaidId(dep)}`);
    }
    for (const rel of ctx.relationships ?? []) {
      const edge = `${from}-->${mermaidId(rel.context)}`;
      if (seen.has(edge)) continue;
      seen.add(edge);
      const label = rel.pattern ? `|${rel.pattern}|` : "";
      lines.push(`  ${from} -->${label} ${mermaidId(rel.context)}`);
    }
  }

  lines.push("");
  lines.push("classDiagram");
  for (const ctx of contexts) {
    const id = mermaidId(ctx.name);
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
