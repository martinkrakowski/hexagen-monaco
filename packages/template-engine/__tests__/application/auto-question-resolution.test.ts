import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AddTemplateUseCase } from "../../src/application/use-cases/add-template.use-case.js";
import { FileSystemFileEmitter } from "../../src/infrastructure/file-emitter.adapter.js";
import { FileSystemTemplateConfigStore } from "../../src/infrastructure/template-config-store.adapter.js";
import type { TemplateManifest } from "../../src/domain/index.js";
import type { TemplateRegistryPort } from "../../src/application/ports/template-registry.port.js";
import type { QuestionEnginePort } from "../../src/application/ports/question-engine.port.js";

// Verifies the `auto + derivedFrom` mechanism end-to-end:
// install template A with a non-default answer, then install template B
// whose question is `type: "auto"` derived from A. The recorded answer in
// B's config must match A's, not B's default.
describe("AddTemplateUseCase — auto/derivedFrom answer resolution", () => {
  let tmpDir: string;
  let templatesDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-auto-test-"));
    templatesDir = path.join(tmpDir, "templates");

    // Template A — single text question, single output that interpolates it.
    await fs.mkdir(path.join(templatesDir, "a", "files"), { recursive: true });
    await fs.writeFile(
      path.join(templatesDir, "a", "files", "from-a.txt"),
      "cookie={cookie_name}",
      "utf-8",
    );

    // Template B — auto-typed question derived from A.cookie_name, single output
    // that interpolates the (derived) value.
    await fs.mkdir(path.join(templatesDir, "b", "files"), { recursive: true });
    await fs.writeFile(
      path.join(templatesDir, "b", "files", "from-b.txt"),
      "B sees cookie={cookie_name}",
      "utf-8",
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function manifests(): TemplateManifest[] {
    return [
      {
        id: "a",
        name: "A",
        description: "",
        version: "1.0.0",
        requires: [],
        conflicts: [],
        questions: [
          {
            id: "cookie_name",
            type: "text",
            prompt: "Cookie name?",
            default: "__default_cookie",
          },
        ],
        envVars: [],
        outputs: ["from-a.txt"],
        checklist: [],
      },
      {
        id: "b",
        name: "B",
        description: "",
        version: "1.0.0",
        requires: ["a"],
        conflicts: [],
        questions: [
          {
            id: "cookie_name",
            type: "auto",
            derivedFrom: "a.cookie_name",
          },
        ],
        envVars: [],
        outputs: ["from-b.txt"],
        checklist: [],
      },
    ];
  }

  function stubRegistry(ms: TemplateManifest[]): TemplateRegistryPort {
    return {
      loadAll: async () => ms,
      loadOne: async (id) => ms.find((m) => m.id === id) ?? null,
    };
  }

  // Question engine that never prompts — fail loudly if it's reached for an
  // auto question, since auto must be resolved without prompting.
  function silentQuestionEngine(): QuestionEnginePort {
    return {
      ask: async (q) => {
        throw new Error(
          `silentQuestionEngine.ask called for ${q.id} — auto questions must skip prompting`,
        );
      },
    };
  }

  async function freshProject(): Promise<string> {
    const dir = path.join(
      tmpDir,
      `project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  it("resolves auto questions from the source template's installed answers", async () => {
    const projectRoot = await freshProject();
    const useCase = new AddTemplateUseCase(
      stubRegistry(manifests()),
      silentQuestionEngine(),
      new FileSystemFileEmitter(templatesDir),
      new FileSystemTemplateConfigStore(),
    );

    // Install B (auto-resolves A) with A's cookie_name overridden to a non-default.
    const result = await useCase.execute({
      templateIds: ["b"],
      projectRoot,
      overrideAnswers: {
        a: { cookie_name: "__custom_cookie" },
      },
    });

    assert.deepEqual(result.applied.sort(), ["a", "b"]);

    // B's recorded answer must equal A's, not B's default ("").
    const config = await new FileSystemTemplateConfigStore().load(projectRoot);
    assert.equal(config.templates.a.answers.cookie_name, "__custom_cookie");
    assert.equal(config.templates.b.answers.cookie_name, "__custom_cookie");

    // The emitted files must have picked up the derived value.
    const fromB = await fs.readFile(
      path.join(projectRoot, "from-b.txt"),
      "utf-8",
    );
    assert.equal(fromB, "B sees cookie=__custom_cookie");
  });

  it("falls back to the auto question's own default when the source template has no record", async () => {
    const projectRoot = await freshProject();
    // Manifest B with a default fallback; A is in the registry but we won't
    // install it (and the test won't pre-seed its config record).
    const ms = manifests();
    const b = ms.find((m) => m.id === "b")!;
    // Drop B's require on A so it can install alone.
    b.requires = [];
    // Set a default for the auto question.
    b.questions[0] = {
      id: "cookie_name",
      type: "auto",
      derivedFrom: "a.cookie_name",
      default: "__fallback_cookie",
    };

    const useCase = new AddTemplateUseCase(
      stubRegistry(ms),
      silentQuestionEngine(),
      new FileSystemFileEmitter(templatesDir),
      new FileSystemTemplateConfigStore(),
    );

    await useCase.execute({ templateIds: ["b"], projectRoot });
    const config = await new FileSystemTemplateConfigStore().load(projectRoot);
    assert.equal(config.templates.b.answers.cookie_name, "__fallback_cookie");
  });
});
