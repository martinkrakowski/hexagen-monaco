export const CLASSIFY_CONTEXT_TYPE_SYSTEM_PROMPT = `You are a DDD context-type classifier. Given a bounded context's name, responsibility, aggregates, and value_objects, classify it as one of: "core", "supporting", "generic", "shared-kernel".

Definitions:
- core: Central business capability, primary revenue driver
- supporting: Augments a core context but is not the primary business
- generic: General-purpose capability usable across any domain (e.g., identity, billing)
- shared-kernel: Shared data contract or event vocabulary between contexts

Output JSON only: {"type": "core|supporting|generic|shared-kernel", "reasoning": "brief explanation"}
`;

export function compileClassifyContextTypePrompt(context: {
  name: string;
  responsibility?: string;
  aggregates?: string[];
  value_objects?: string[];
}): string {
  const parts: string[] = [];
  parts.push(`<context_name>${context.name}</context_name>`);
  if (context.responsibility) {
    parts.push(`<responsibility>${context.responsibility}</responsibility>`);
  }
  if (context.aggregates && context.aggregates.length > 0) {
    parts.push(`<aggregates>${context.aggregates.join(", ")}</aggregates>`);
  }
  if (context.value_objects && context.value_objects.length > 0) {
    parts.push(
      `<value_objects>${context.value_objects.join(", ")}</value_objects>`,
    );
  }
  return parts.join("\n");
}
