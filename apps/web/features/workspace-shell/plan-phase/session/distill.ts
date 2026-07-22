import type { ProjectLayerTurn } from "@hexagen/shared";

/**
 * Finalize step (decided open question Q4): ONE chat call distills the
 * converged session into importable spec text. The prompt targets the Hexagen
 * `contexts:` manifest dialect because that is the fully DETERMINISTIC import
 * path (detectInputMode routes it to structured-config via the shared
 * isManifestDialect predicate — no LLM loose-spec conversion in the middle).
 */
export function buildDistillPrompt(input: {
  readonly seed: string;
  readonly turns: readonly ProjectLayerTurn[];
}): string {
  const { seed, turns } = input;
  const finalProposal = findLast(turns, (t) => t.role === "proposer");

  return [
    `Convert the following converged architecture proposal into a Hexagen project spec.`,
    `Output ONLY a YAML document — no prose, no markdown fences.`,
    `Use this exact dialect:`,
    "",
    "name: <project-name>",
    "contexts:",
    "  - name: <context-name>",
    "    description: <one line>",
    "    responsibilities:",
    "      - <responsibility>",
    "    layers:",
    "      application:",
    "        ports:",
    "          in: [<DrivingPort>]",
    "          out: [<DrivenPort>]",
    "      infrastructure:",
    "        adapters: [<Adapter>]",
    "",
    `Every context in the proposal must appear. Derive ports/adapters from the proposal's stated integrations; omit a section rather than inventing content.`,
    "",
    `## Brief`,
    seed.trim(),
    "",
    `## Converged proposal`,
    (finalProposal?.content ?? "").trim(),
  ].join("\n");
}

/**
 * Strip a markdown code fence if the model wrapped the YAML despite the
 * instruction — the import flow parses raw YAML.
 */
export function stripYamlFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:ya?ml)?\s*\n([\s\S]*?)\n```$/m.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

function findLast<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return items[i];
  }
  return undefined;
}
