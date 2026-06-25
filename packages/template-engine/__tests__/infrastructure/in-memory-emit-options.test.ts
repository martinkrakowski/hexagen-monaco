import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { InMemoryFileEmitter } from "../../src/infrastructure/in-memory-file-emitter.adapter.js";
import { DefaultingQuestionEngine } from "../../src/infrastructure/defaulting-question-engine.adapter.js";
import { isTestOutput } from "../../src/domain/index.js";
import type {
  TemplateManifest,
  TemplateQuestion,
} from "../../src/domain/index.js";

const manifest = (outputs: string[]): TemplateManifest => ({
  id: "t",
  name: "T",
  description: "",
  version: "1.0.0",
  requires: [],
  conflicts: [],
  questions: [],
  envVars: [],
  outputs,
  checklist: [],
});

const loader =
  (contents: Record<string, string>) =>
  async (_id: string, rel: string): Promise<string | null> =>
    contents[rel] ?? null;

describe("isTestOutput", () => {
  it("matches *.test.* / *.spec.* across js/ts/x variants, nothing else", () => {
    for (const p of [
      "a.test.ts",
      "a.spec.ts",
      "x/y.test.tsx",
      "z.spec.js",
      "q.test.mjs",
    ]) {
      assert.equal(isTestOutput(p), true, `expected test: ${p}`);
    }
    for (const p of ["a.ts", "tests.ts", "a.testing.ts", "spec.ts", "a.test"]) {
      assert.equal(isTestOutput(p), false, `expected non-test: ${p}`);
    }
  });
});

describe("InMemoryFileEmitter — --with-tests gate", () => {
  it("skips *.test.* / *.spec.* outputs by default", async () => {
    const e = new InMemoryFileEmitter(
      loader({ "a.ts": "a", "a.test.ts": "t", "a.spec.ts": "s" }),
    );
    await e.emit(manifest(["a.ts", "a.test.ts", "a.spec.ts"]), {});
    const files = e.getFiles();
    assert.ok(files.has("a.ts"));
    assert.ok(
      !files.has("a.test.ts") && !files.has("a.spec.ts"),
      "test scaffolds are gated off by default",
    );
  });

  it("emits test scaffolds when withTests is set", async () => {
    const e = new InMemoryFileEmitter(
      loader({ "a.ts": "a", "a.test.ts": "t" }),
      { withTests: true },
    );
    await e.emit(manifest(["a.ts", "a.test.ts"]), {});
    assert.ok(
      e.getFiles().has("a.test.ts"),
      "test scaffold emitted under --with-tests",
    );
  });
});

describe("InMemoryFileEmitter — reserved interpolation vars", () => {
  it("interpolates {projectName} in file content", async () => {
    const e = new InMemoryFileEmitter(
      loader({ "x.ts": "name={projectName}" }),
      {
        reservedVars: { projectName: "acme" },
      },
    );
    await e.emit(manifest(["x.ts"]), {});
    assert.equal(e.getFiles().get("x.ts"), "name=acme");
  });

  it("reserved var overrides a same-named answer (can't be shadowed)", async () => {
    const e = new InMemoryFileEmitter(loader({ "x.ts": "{projectName}" }), {
      reservedVars: { projectName: "reserved" },
    });
    await e.emit(manifest(["x.ts"]), { projectName: "fromAnswer" });
    assert.equal(e.getFiles().get("x.ts"), "reserved");
  });

  it("resolves reserved-var placeholders inside string answer values", async () => {
    // A {projectName} arriving as an answer value (not via a question default)
    // still resolves — interpolate is single-pass, so the emitter pre-resolves
    // string answers before substituting them into files.
    const e = new InMemoryFileEmitter(loader({ "x.ts": "{name}" }), {
      reservedVars: { projectName: "acme" },
    });
    await e.emit(manifest(["x.ts"]), { name: "{projectName}" });
    assert.equal(e.getFiles().get("x.ts"), "acme");
  });
});

describe("DefaultingQuestionEngine — default interpolation", () => {
  const textQ: TemplateQuestion = {
    id: "server_name",
    type: "text",
    prompt: "?",
    default: "{projectName}",
  };
  const boolQ: TemplateQuestion = {
    id: "flag",
    type: "boolean",
    prompt: "?",
    default: false,
  };

  it("interpolates {projectName} in a text default", async () => {
    const e = new DefaultingQuestionEngine({ projectName: "acme" });
    assert.equal(await e.ask(textQ), "acme");
  });

  it("passes a boolean default through untouched", async () => {
    const e = new DefaultingQuestionEngine({ projectName: "acme" });
    assert.equal(await e.ask(boolQ), false);
  });

  it("leaves a default unchanged when no reserved var matches", async () => {
    const e = new DefaultingQuestionEngine();
    assert.equal(await e.ask(textQ), "{projectName}");
  });
});
