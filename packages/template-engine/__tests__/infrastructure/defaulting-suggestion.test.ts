import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createInMemoryMaterializer } from "../../src/in-memory.js";
import type { SelectSuggestion } from "../../src/in-memory.js";

/**
 * U-C (Jev): the optional SelectSuggestion callback only annotates the warning
 * of a defaulted `select` — the default always still applies, the answer value
 * never changes, and with no callback the behaviour is byte-identical to the
 * un-parametrised factory.
 */

const ADD_ONS = { "env-setup": {} };

/**
 * Today's output for ADD_ONS, recorded from main before this lane (no
 * suggestion code): the warnings and a sha256 over the sorted file map.
 */
const TODAY = {
  warnings: [
    "No answer supplied for 'framework'; used its default.",
    "No answer supplied for 'strict_validation'; used its default.",
    "No answer supplied for 'dotenv_tool'; used its default.",
  ],
  filesSha256:
    "094b14b7d786fac810271967302e555cf608eb7a0903a3ada8bacd84d3da93c3",
  fileCount: 7,
};

function filesDigest(files: Map<string, unknown>): string {
  const h = createHash("sha256");
  for (const k of [...files.keys()].sort()) {
    h.update(k);
    h.update("\0");
    h.update(String(files.get(k)));
    h.update("\0");
  }
  return h.digest("hex");
}

async function expectToday(
  suggest?: SelectSuggestion,
  timeoutMs?: number,
): Promise<void> {
  const r = await createInMemoryMaterializer(
    suggest === undefined
      ? undefined
      : {
          suggest,
          ...(timeoutMs === undefined ? {} : { suggestTimeoutMs: timeoutMs }),
        },
  ).materialize(ADD_ONS, { projectName: "demo-app" });
  assert.deepStrictEqual(r.warnings, TODAY.warnings);
  assert.deepStrictEqual(r.errors, []);
  assert.equal(r.files.size, TODAY.fileCount);
  assert.equal(filesDigest(r.files), TODAY.filesSha256);
}

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

  it("is byte-identical to today (recorded from main) with no callback", async () => {
    await expectToday();
  });

  it.each<[string, SelectSuggestion]>([
    ["rejects", () => Promise.reject(new Error("jev down"))],
    [
      "throws synchronously",
      () => {
        throw new Error("boom");
      },
    ],
    ["returns undefined", () => Promise.resolve(undefined)],
    [
      "returns an out-of-range index",
      () => Promise.resolve({ index: 99, confidence: 0.9 }),
    ],
    [
      "returns a fractional index",
      () => Promise.resolve({ index: 1.5, confidence: 0.9 }),
    ],
    [
      "returns a string index",
      () => Promise.resolve({ index: "0", confidence: 0.9 } as never),
    ],
    ["returns no confidence", () => Promise.resolve({ index: 0 } as never)],
    [
      "returns a NaN confidence",
      () => Promise.resolve({ index: 0, confidence: Number.NaN }),
    ],
    [
      "returns a string confidence",
      () => Promise.resolve({ index: 0, confidence: "0.9" } as never),
    ],
  ])(
    "leaves today's output unchanged when the callback %s",
    async (_label, suggest) => {
      await expectToday(suggest);
    },
  );

  it("handles a rejection that arrives after the deadline", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expectToday(
        () =>
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error("late")), 40),
          ),
        10,
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.deepStrictEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("does not hang on a callback that never settles", async () => {
    await expectToday(() => new Promise(() => undefined), 20);
  });
});
