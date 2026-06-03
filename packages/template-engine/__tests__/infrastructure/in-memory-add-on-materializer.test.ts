import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileSystemTemplateRegistry } from "../../src/infrastructure/template-registry.adapter.js";
import { createFileSystemTemplateFileLoader } from "../../src/infrastructure/file-system-template-file-loader.js";
import { InMemoryAddOnMaterializer } from "../../src/infrastructure/in-memory-add-on-materializer.js";
import { isOutputEnabled, outputPath } from "../../src/domain/index.js";
import type {
  TemplateManifest,
  TemplateQuestion,
  AnswerMap,
} from "../../src/domain/index.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

const registry = new FileSystemTemplateRegistry(TEMPLATES_DIR);
const materializer = new InMemoryAddOnMaterializer(
  registry,
  createFileSystemTemplateFileLoader(TEMPLATES_DIR),
);

/** The answers a manifest would resolve to under its declared defaults. */
function defaultAnswers(questions: TemplateQuestion[]): AnswerMap {
  const map: AnswerMap = {};
  for (const q of questions) {
    if (q.type === "multiselect") map[q.id] = q.default ?? [];
    else if (q.type === "boolean") map[q.id] = q.default ?? false;
    else if (q.type === "select") map[q.id] = q.default ?? q.options[0] ?? "";
    else if (q.type === "text") map[q.id] = q.default ?? "";
    // "auto" questions are derived by the use case — no answer supplied here.
  }
  return map;
}

function enabledOutputs(
  manifest: TemplateManifest,
  answers: AnswerMap,
): string[] {
  return manifest.outputs
    .filter((o) => isOutputEnabled(o, answers))
    .map(outputPath);
}

async function manifestFor(id: string): Promise<TemplateManifest> {
  const m = await registry.loadOne(id);
  assert.ok(m, `template ${id} not found in registry`);
  return m;
}

describe("InMemoryAddOnMaterializer", () => {
  it("returns nothing when no add-ons are selected", async () => {
    const { files, warnings, errors } = await materializer.materialize({});
    assert.equal(files.size, 0);
    assert.deepStrictEqual(warnings, []);
    assert.deepStrictEqual(errors, []);
  });

  it("materializes a template's outputs with interpolated content", async () => {
    const manifest = await manifestFor("rate-limiting");
    const answers = defaultAnswers(manifest.questions);

    const { files, warnings } = await materializer.materialize({
      "rate-limiting": answers,
    });

    for (const rel of enabledOutputs(manifest, answers)) {
      assert.ok(files.has(rel), `expected emitted file ${rel}`);
      assert.ok(
        (files.get(rel) ?? "").length > 0,
        `${rel} should have non-empty content`,
      );
    }
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
      "fully-answered template should leave no unresolved variables",
    );
  });

  it("co-emits the files of required templates", async () => {
    const manifest = await manifestFor("llm-adapter"); // requires env-setup, error-handling
    const answers = defaultAnswers(manifest.questions);

    const { files } = await materializer.materialize({
      "llm-adapter": answers,
    });

    const own = enabledOutputs(manifest, answers);
    for (const rel of own) {
      assert.ok(files.has(rel), `expected llm-adapter output ${rel}`);
    }
    const fromDeps = [...files.keys()].filter((k) => !own.includes(k));
    assert.ok(
      fromDeps.length > 0,
      "expected files co-emitted from required templates",
    );
  });

  it("defaults unanswered questions and records a warning", async () => {
    const { files, warnings } = await materializer.materialize({
      "llm-adapter": {},
    });

    assert.ok(files.size > 0, "should still emit using defaults");
    assert.ok(
      warnings.some((w) => w.includes("No answer supplied")),
      "expected a defaulting warning for the unanswered questions",
    );
  });

  it("surfaces an unknown add-on as an error instead of throwing", async () => {
    const { files, errors } = await materializer.materialize({
      "no-such-template": {},
    });
    assert.equal(files.size, 0);
    assert.ok(
      errors.length > 0,
      "expected a validation error for the unknown template id",
    );
  });
});
