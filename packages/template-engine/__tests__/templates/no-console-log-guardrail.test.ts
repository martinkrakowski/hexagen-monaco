import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guardrail: no template payload should ship a raw `console.log` (the lazy default
// that becomes technical debt — no level, no correlation id, no redaction). Logging
// must go through the structured logger; the only sanctioned console sites are the
// ones the `eslint-no-console` template exempts. A deliberate console.log must carry
// an explicit `// eslint-disable-next-line no-console`.
//
// Keep the exempt list in sync with templates/eslint-no-console/files/eslint.no-console.mjs.

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

const EXEMPT_SEGMENTS = [
  `${path.sep}infrastructure${path.sep}logging${path.sep}`,
  `${path.sep}server${path.sep}startup${path.sep}`,
  `${path.sep}scripts${path.sep}`,
  ".config.",
];

function isExemptPath(rel: string): boolean {
  if (EXEMPT_SEGMENTS.some((seg) => rel.includes(seg))) return true;
  return path.basename(rel).startsWith("smoke-");
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

describe("templates — no raw console.log debt (no-console guardrail)", () => {
  it("every console.log in a template payload is exempt-path or eslint-disabled", async () => {
    const files = await walk(TEMPLATES_DIR);
    const violations: string[] = [];

    for (const file of files) {
      const rel = path.relative(TEMPLATES_DIR, file);
      // Only scan emitted payloads: templates/<id>/files/**.
      if (!rel.includes(`${path.sep}files${path.sep}`)) continue;
      if (isExemptPath(rel)) continue;

      const lines = (await fs.readFile(file, "utf-8")).split("\n");
      const blockDisabled = lines.some((l) =>
        /eslint-disable\b(?!-next-line|-line).*no-console/.test(l),
      );

      lines.forEach((line, i) => {
        if (!/console\.log\(/.test(line)) return;
        const prev = lines[i - 1] ?? "";
        const disabled =
          /eslint-disable(-next-line|-line)?.*no-console/.test(line) ||
          /eslint-disable-next-line.*no-console/.test(prev) ||
          blockDisabled;
        if (!disabled) violations.push(`${rel}:${i + 1}`);
      });
    }

    assert.deepStrictEqual(
      violations,
      [],
      `Raw console.log in a template payload — route through the logger, or (if deliberate) add // eslint-disable-next-line no-console:\n  ${violations.join("\n  ")}`,
    );
  });
});
