/**
 * GitHub Actions `run:` step bodies from a workflow document.
 *
 * Matches `- run:` and an indented `run:` after `- name:`.
 * Block scalars accept YAML chomp / indent indicators (`|`, `|-`, `|+`, `|2`, `|2-`).
 *
 * Not a full YAML parser. A `with: run:` action input would also match — no
 * current workflow hits that shape; if one appears, teach this helper rather
 * than widening it silently.
 */
export function extractWorkflowRunCommands(source: string): string[] {
  const commands: string[] = [];
  const lines = source.split("\n");
  const blockHeader = /^[|>](?:\d+[+-]?|[+-]\d*|[+-])?$/;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const rest = match[2];
    if (blockHeader.test(rest)) {
      const block: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === "") {
          block.push("");
          continue;
        }
        const nextIndent = (lines[j].match(/^(\s*)/) ?? ["", ""])[1].length;
        if (nextIndent <= indent) break;
        block.push(lines[j].slice(indent + 2));
      }
      commands.push(block.join("\n"));
      continue;
    }
    if (rest) commands.push(rest.replace(/^['"]|['"]$/g, ""));
  }
  return commands;
}
