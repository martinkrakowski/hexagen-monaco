import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TEMPLATE_A } from "../../src/brief-new/template-text.js";

/**
 * The drift test. The template's own `references/briefs.md` is the canonical
 * home of Template A and its lane-host variant: it is the file `hexagen add
 * orchestration` emits, and this tool's raw string must be byte-identical to
 * its body. The repository's mirror under `.agents/` is a copy and is not read.
 *
 * From a published package that path does not exist. The case then SKIPS, and
 * says why; a missing file must never read as a pass.
 */
const CANONICAL = resolve(
  import.meta.dirname,
  "../../../../packages/template-engine/templates/orchestration/files/.agents/skills/orchestrate-wave/references/briefs.md",
);

const HEADING = "## Template A — Lane brief (implementer)";
const VARIANT_START = "Lane-host variant. ";
const VARIANT_END = "ignore this paragraph.\n";

/** The lines strictly between the first fence after the heading and the next fence of the same length. */
export function templateABody(markdown: string): string {
  const from = markdown.indexOf(HEADING);
  if (from === -1) throw new Error(`no "${HEADING}" heading`);
  const open = /^(`{3,})markdown\n/m.exec(markdown.slice(from));
  if (open === null) throw new Error("no markdown fence after the heading");
  const fence = open[1]!;
  const start = from + open.index + open[0].length;
  const end = markdown.indexOf(`\n${fence}\n`, start);
  if (end === -1) throw new Error("the Template A fence never closes");
  return markdown.slice(start, end);
}

function variantOf(body: string): string {
  const start = body.indexOf(VARIANT_START);
  const end = body.indexOf(VARIANT_END, start);
  if (start === -1 || end === -1) throw new Error("no lane-host variant");
  return body.slice(start, end + VARIANT_END.length);
}

describe("Template A drift", () => {
  it("the tool's template is byte-identical to the template copy's Template A, lane-host variant included", (ctx) => {
    if (!existsSync(CANONICAL)) {
      ctx.skip(
        "published package: the template's briefs.md is not on disk here, so there is nothing to compare against",
      );
    }
    const canonical = templateABody(readFileSync(CANONICAL, "utf8"));
    expect(TEMPLATE_A).toBe(canonical);
    expect(variantOf(TEMPLATE_A)).toBe(variantOf(canonical));
  });

  it("the extractor reads the body between same-length fences, and refuses what it cannot find", () => {
    const md = `${HEADING}\n\n\`\`\`\`markdown\nA\n\`\`\`\ninner\n\`\`\`\nB\n\`\`\`\`\n`;
    expect(templateABody(md)).toBe("A\n```\ninner\n```\nB");
    expect(() => templateABody("nothing")).toThrow(/heading/);
    expect(() => templateABody(`${HEADING}\n`)).toThrow(/fence/);
    expect(() => templateABody(`${HEADING}\n\`\`\`markdown\nx\n`)).toThrow(
      /never closes/,
    );
  });

  it("the tool's template carries the variant paragraph the renderer cuts at", () => {
    expect(variantOf(TEMPLATE_A)).toMatch(/gate: targeted-only/);
  });

  it("the canonical path exists wherever the repository layout does, so the skip above can never hide a moved or deleted file", () => {
    const sentinel = resolve(
      import.meta.dirname,
      "../../../../packages/template-engine/package.json",
    );
    if (existsSync(sentinel)) expect(existsSync(CANONICAL)).toBe(true);
  });
});
