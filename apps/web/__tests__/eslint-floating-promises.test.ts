import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, "..");
const PROBE_PATH = path.join(WEB_ROOT, "lib", "platform", "__lint_probe__.ts");

const TARGET_RULES = new Set([
  "@typescript-eslint/no-floating-promises",
  "@typescript-eslint/no-misused-promises",
  "@typescript-eslint/await-thenable",
]);

// Type-aware rules only report on a real file on disk that the project service
// can map to a tsconfig: it attaches type information by globbing the
// filesystem, so a virtual (non-existent) path has no program and
// `no-floating-promises` cannot fire. Positive cases therefore write a real
// probe under lib/platform/ and lint it with `lintFiles` (a fresh ESLint
// instance per case so the program is built after the probe exists); the
// negative case is .tsx, which is outside the server-scoped block and never
// type-aware, so `lintText` with a virtual path suffices there.
function targetErrors(result: ESLint.LintResult) {
  return result.messages.filter(
    (m) => m.severity === 2 && TARGET_RULES.has(m.ruleId ?? ""),
  );
}

async function lintProbe(code: string): Promise<ESLint.LintResult> {
  fs.writeFileSync(PROBE_PATH, code);
  const es = new ESLint({ cwd: WEB_ROOT, cache: false });
  const results = await es.lintFiles([PROBE_PATH]);
  assert.equal(results.length, 1, `expected one result, got ${results.length}`);
  const result = results[0];
  if (!result) throw new Error("no lint result returned for probe");
  return result;
}

afterEach(() => {
  if (fs.existsSync(PROBE_PATH)) fs.unlinkSync(PROBE_PATH);
});

describe("server floating-promises lint block", () => {
  it("flags a floating promise under lib/platform (no-floating-promises)", async () => {
    const result = await lintProbe("async function f() {} ; f();");
    const rules = targetErrors(result).map((m) => m.ruleId);
    assert.ok(
      rules.includes("@typescript-eslint/no-floating-promises"),
      `expected no-floating-promises; got ${JSON.stringify(rules)}`,
    );
  });

  it("flags a promise used as a condition (no-misused-promises)", async () => {
    const result = await lintProbe(
      "async function ok(): Promise<boolean> { return true } ; async function g() { if (ok()) { return 1 } return 0 }",
    );
    const rules = targetErrors(result).map((m) => m.ruleId);
    assert.ok(
      rules.includes("@typescript-eslint/no-misused-promises"),
      `expected no-misused-promises; got ${JSON.stringify(rules)}`,
    );
  });

  it("does not apply the server rules to a .tsx outside the block", async () => {
    const es = new ESLint({ cwd: WEB_ROOT, cache: false });
    const results = await es.lintText("async function f() {} ; f();", {
      filePath: "features/x/__lint_probe__.tsx",
    });
    const result = results[0];
    if (!result) throw new Error("no lint result returned");
    const rules = targetErrors(result).map((m) => m.ruleId);
    assert.equal(
      rules.length,
      0,
      `expected no target-rule errors; got ${JSON.stringify(rules)}`,
    );
  });
});
