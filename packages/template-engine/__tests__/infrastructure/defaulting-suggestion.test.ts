import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createInMemoryMaterializer } from "../../src/in-memory.js";
import type { SelectSuggestion } from "../../src/in-memory.js";

/**
 * U-C (Jev): the optional SelectSuggestion callback only annotates the warning
 * of a defaulted `select` — the default always still applies, the answer value
 * never changes, and with no callback the behaviour is byte-identical to the
 * un-parametrised factory.
 */

const ADD_ONS = { "env-setup": {} };

describe("createInMemoryMaterializer({ suggest })", () => {
  it("appends the suggestion to the warning and keeps the default answer", async () => {
    const suggest: SelectSuggestion = async (input) => {
      assert.equal(input.projectName, "demo-app");
      assert.equal(
        input.prompt,
        "Env loader? (next.js-built-in for Next.js/Nitro — they parse .env natively; pick dotenv/dotenv-expand only for plain Node entrypoints)",
      );
      assert.deepStrictEqual(input.options, [
        "next.js-built-in",
        "dotenv",
        "dotenv-expand",
      ]);
      return { index: 2, confidence: 0.867 };
    };
    const { files, warnings, errors } = await createInMemoryMaterializer({
      suggest,
    }).materialize(ADD_ONS, { projectName: "demo-app" });

    assert.deepStrictEqual(errors, []);
    const dotenv = warnings.filter((w) => w.includes("'dotenv_tool'"));
    assert.equal(dotenv.length, 1);
    assert.ok(
      dotenv[0].startsWith(
        "No answer supplied for 'dotenv_tool'; used its default.",
      ),
      "warning keeps its existing prefix",
    );
    assert.ok(
      dotenv[0].endsWith("suggested: dotenv-expand (0.87)"),
      "suggestion appended with confidence to 2 dp",
    );
    // The default still applies: load-env.ts is emitted only when the answer
    // is dotenv / dotenv-expand, so it must NOT be emitted.
    assert.ok(
      ![...files.keys()].some((f) => f.includes("config/load-env")),
      "answer value must remain the default (next.js-built-in)",
    );
    // The framework question is also defaulted without the callback ever
    // being allowed to change it.
    assert.ok(warnings.some((w) => w.includes("'framework'")));
    assert.ok(files.size > 0);
  });

  it("leaves the warning unchanged when the callback rejects", async () => {
    const baseline = await createInMemoryMaterializer().materialize(ADD_ONS, {
      projectName: "demo-app",
    });
    const { warnings } = await createInMemoryMaterializer({
      suggest: () => Promise.reject(new Error("jev down")),
    }).materialize(ADD_ONS, { projectName: "demo-app" });
    assert.deepStrictEqual(warnings, baseline.warnings);
  });

  it("leaves the warning unchanged on an out-of-range or undefined result", async () => {
    const baseline = await createInMemoryMaterializer().materialize(ADD_ONS, {
      projectName: "demo-app",
    });
    const outOfRange = await createInMemoryMaterializer({
      suggest: () => Promise.resolve({ index: 99, confidence: 0.9 }),
    }).materialize(ADD_ONS, { projectName: "demo-app" });
    assert.deepStrictEqual(outOfRange.warnings, baseline.warnings);

    const noAdvice = await createInMemoryMaterializer({
      suggest: () => Promise.resolve(undefined),
    }).materialize(ADD_ONS, { projectName: "demo-app" });
    assert.deepStrictEqual(noAdvice.warnings, baseline.warnings);
  });

  it("is byte-identical to today with no callback arguments", async () => {
    const noArgs = await createInMemoryMaterializer().materialize(ADD_ONS, {
      projectName: "demo-app",
    });
    const emptyArg = await createInMemoryMaterializer({}).materialize(ADD_ONS, {
      projectName: "demo-app",
    });
    assert.deepStrictEqual(emptyArg.files, noArgs.files);
    assert.deepStrictEqual(emptyArg.warnings, noArgs.warnings);
    assert.deepStrictEqual(emptyArg.errors, noArgs.errors);
  });
});
