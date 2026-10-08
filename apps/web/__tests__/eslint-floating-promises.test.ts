import { afterAll, beforeAll, describe, it } from "vitest";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, "..");

const TARGET_RULES = new Set([
  "@typescript-eslint/no-floating-promises",
  "@typescript-eslint/no-misused-promises",
  "@typescript-eslint/await-thenable",
]);

const MY_RULE = "hexagen-ui/no-promise-in-untyped-position";

// Each case gets its OWN probe file. TypeScript's project service is a
// process-wide singleton (not owned by the ESLint instance), so reusing one
// path for two cases can lint the second case against the first case's
// on-disk content — the actual CI failure. Writing every probe once in
// `beforeAll` and linting them in a single `lintFiles` call builds one program
// and removes any ordering dependency between cases.
const probes = {
  floating: {
    rel: "lib/platform/__lint_probe_floating__.ts",
    code: "async function f() {} ; f();",
  },
  condition: {
    rel: "lib/platform/__lint_probe_condition__.ts",
    code: "async function ok(): Promise<boolean> { return true } ; async function g() { if (ok()) { return 1 } return 0 }",
  },
  awaitable: {
    rel: "lib/platform/__lint_probe_await__.ts",
    code: "async function f() { await 1; }",
  },
  scope: {
    rel: "features/__lint_probe_scope__.ts",
    code: "async function f() {} ; f();",
  },
  typed_invalid: {
    rel: "lib/platform/__lint_probe_typed_invalid__.ts",
    code: [
      "async function check(): Promise<boolean> { return true; }",
      "async function takesUnknown(x: unknown) {}",
      "async function takesAny(arr: any) {}",
      "async function go() {",
      "  void takesUnknown({ initialized: check() });",
      "  void takesAny([check()]);",
      "  void takesUnknown(check());",
      "  `${check()}`;",
      "}",
      "void go();",
    ].join("\n"),
  },
  typed_valid: {
    rel: "lib/platform/__lint_probe_typed_valid__.ts",
    code: [
      "async function check(): Promise<boolean> { return true; }",
      "async function takesUnknown(x: unknown) {}",
      "async function takesAny(arr: any) {}",
      "async function takesPromise(o: { initialized: Promise<boolean> }) {}",
      "async function identity<T>(x: T): T { return x; }",
      "async function go() {",
      "  void takesUnknown({ initialized: await check() });",
      "  void takesAny([await check()]);",
      "  void `${await check()}`;",
      "  void takesUnknown(await check());",
      "  void Promise.all([check(), check()]);",
      "  const tasks: Promise<boolean>[] = [check()];",
      "  void takesPromise({ initialized: check() });",
      "  void check();",
      "  const r = identity(check());",
      "}",
      "void go();",
    ].join("\n"),
  },
};

const PROBE_PATTERN = "__lint_probe";
let results: ESLint.LintResult[] = [];

function removeProbes() {
  const dirs = [
    path.join(WEB_ROOT, "lib", "platform"),
    path.join(WEB_ROOT, "features"),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(PROBE_PATTERN)) {
        fs.rmSync(path.join(dir, name), { force: true });
      }
    }
  }
}

beforeAll(async () => {
  removeProbes();
  const es = new ESLint({ cwd: WEB_ROOT, cache: false });
  for (const p of Object.values(probes)) {
    fs.writeFileSync(path.join(WEB_ROOT, p.rel), p.code);
  }
  const paths = Object.values(probes).map((p) => path.join(WEB_ROOT, p.rel));
  results = await es.lintFiles(paths);
  assert.equal(
    results.length,
    probes_count(),
    `expected ${probes_count()} results, got ${results.length}`,
  );
});

afterAll(() => {
  removeProbes();
});

function targetErrors(result: ESLint.LintResult) {
  return result.messages.filter(
    (m) => m.severity === 2 && TARGET_RULES.has(m.ruleId ?? ""),
  );
}

function messagesOf(result: ESLint.LintResult) {
  return result.messages.map((m) => ({
    line: m.line,
    ruleId: m.ruleId,
    message: m.message.slice(0, 120),
  }));
}

function resultFor(rel: string): ESLint.LintResult {
  const r = results.find((x) => x.filePath.endsWith(rel));
  if (!r) {
    throw new Error(
      `no result for ${rel}; got ${JSON.stringify(results.map((x) => x.filePath))}`,
    );
  }
  return r;
}

function probes_count() {
  return Object.keys(probes).length;
}

function myRuleMessages(result: ESLint.LintResult) {
  return result.messages.filter((m) => m.ruleId === MY_RULE);
}

describe("server floating-promises lint block", () => {
  it("flags a floating promise under lib/platform (no-floating-promises)", () => {
    const r = resultFor(probes.floating.rel);
    const rules = targetErrors(r).map((m) => m.ruleId);
    assert.ok(
      rules.includes("@typescript-eslint/no-floating-promises"),
      `expected no-floating-promises; got ${JSON.stringify(messagesOf(r))}`,
    );
  });

  it("flags a promise used as a condition (no-misused-promises)", () => {
    const r = resultFor(probes.condition.rel);
    const rules = targetErrors(r).map((m) => m.ruleId);
    assert.ok(
      rules.includes("@typescript-eslint/no-misused-promises"),
      `expected no-misused-promises; got ${JSON.stringify(messagesOf(r))}`,
    );
  });

  it("flags an await of a non-thenable (await-thenable)", () => {
    const r = resultFor(probes.awaitable.rel);
    const rules = targetErrors(r).map((m) => m.ruleId);
    assert.ok(
      rules.includes("@typescript-eslint/await-thenable"),
      `expected await-thenable; got ${JSON.stringify(messagesOf(r))}`,
    );
  });

  it("does not apply the server rules to a .tsx under features/", async () => {
    const es = new ESLint({ cwd: WEB_ROOT, cache: false });
    const out = await es.lintText("async function f() {} ; f();", {
      filePath: "features/x/__lint_probe__.tsx",
    });
    const result = out[0];
    if (!result) throw new Error("no lint result for .tsx probe");
    const rules = targetErrors(result).map((m) => m.ruleId);
    assert.equal(
      rules.length,
      0,
      `expected no target-rule errors; got ${JSON.stringify(messagesOf(result))}`,
    );
  });

  it("does not apply the server rules to a .ts probe under features/", () => {
    const r = resultFor(probes.scope.rel);
    const rules = targetErrors(r).map((m) => m.ruleId);
    assert.equal(
      rules.length,
      0,
      `expected no target-rule errors; got ${JSON.stringify(messagesOf(r))}`,
    );
  });
});

describe("no-promise-in-untyped-position rule", () => {
  it("reports all four invalid cases with the rule id", () => {
    const r = resultFor(probes.typed_invalid.rel);
    const msgs = myRuleMessages(r);
    assert.ok(
      msgs.length >= 4,
      `expected >= 4 reports, got ${msgs.length}: ${JSON.stringify(messagesOf(r))}`,
    );
    for (const m of msgs) {
      assert.equal(
        m.ruleId,
        MY_RULE,
        `expected ruleId ${MY_RULE}; got ${m.ruleId}`,
      );
    }
  });

  it("covers all four position kinds in the invalid probe", () => {
    const r = resultFor(probes.typed_invalid.rel);
    const positions = myRuleMessages(r).map((m) => m.message);
    const has = (substr: string) => positions.some((s) => s.includes(substr));
    assert.ok(has("object-property"), "expected object-property report");
    assert.ok(has("array-element"), "expected array-element report");
    assert.ok(has("call-argument"), "expected call-argument report");
    assert.ok(has("template-literal"), "expected template-literal report");
  });

  it("does not report any valid case", () => {
    const r = resultFor(probes.typed_valid.rel);
    const msgs = myRuleMessages(r);
    assert.equal(
      msgs.length,
      0,
      `expected 0 reports, got ${msgs.length}: ${JSON.stringify(messagesOf(r))}`,
    );
  });
});
