import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TEMPLATE_E } from "../../src/fix-brief/template-text.js";

/**
 * The drift test. The template's own `references/briefs.md` is the canonical
 * home of Template E — it is the file `hexagen add orchestration` emits — and
 * this tool's raw string must be byte-identical to its body. The repository's
 * mirror under `.agents/` is a copy and is not read here.
 *
 * From a published package that path does not exist. The case then SKIPS, and
 * says why; a missing file must never read as a pass.
 */
const CANONICAL = resolve(
  import.meta.dirname,
  "../../../../packages/template-engine/templates/orchestration/files/.agents/skills/orchestrate-wave/references/briefs.md",
);

const HEADING = "## Template E — Fix-round brief for a commit-only lane";

/**
 * The lines strictly between the first fence after the heading and the next
 * fence of the same length. The fence length is read, not assumed: the body
 * carries a three-backtick fence of its own.
 */
export function templateEBody(markdown: string): string {
  const from = markdown.indexOf(HEADING);
  if (from === -1) throw new Error(`no "${HEADING}" heading`);
  const open = /^(`{3,})markdown\n/m.exec(markdown.slice(from));
  if (open === null) throw new Error("no markdown fence after the heading");
  const fence = open[1]!;
  const start = from + open.index + open[0].length;
  const end = markdown.indexOf(`\n${fence}\n`, start);
  if (end === -1) throw new Error("the Template E fence never closes");
  return markdown.slice(start, end);
}

describe("Template E drift", () => {
  it.skipIf(!existsSync(CANONICAL))(
    "the tool's template is byte-identical to the template copy's Template E",
    () => {
      expect(TEMPLATE_E).toBe(templateEBody(readFileSync(CANONICAL, "utf8")));
    },
  );

  it("the extractor reads the body between same-length fences, and refuses what it cannot find", () => {
    const md = `${HEADING}\n\n\`\`\`\`markdown\nA\n\`\`\`\ninner\n\`\`\`\nB\n\`\`\`\`\n`;
    expect(templateEBody(md)).toBe("A\n```\ninner\n```\nB");
    expect(() => templateEBody("nothing")).toThrow(/heading/);
    expect(() => templateEBody(`${HEADING}\n`)).toThrow(/fence/);
    expect(() => templateEBody(`${HEADING}\n\`\`\`\`markdown\nx\n`)).toThrow(
      /never closes/,
    );
  });

  it("the canonical path is where the template lives in this checkout, or this run is a published package", () => {
    // Guards the skip: if the repository layout is present (the template
    // directory exists) the canonical file must exist too.
    const templateDir = resolve(
      import.meta.dirname,
      "../../../../packages/template-engine/templates/orchestration",
    );
    if (existsSync(templateDir)) expect(existsSync(CANONICAL)).toBe(true);
  });
});
