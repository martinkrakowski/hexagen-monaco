import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ValidateTemplatesUseCase } from "../../src/application/use-cases/validate-templates.use-case.js";
import { FileSystemTemplateConfigStore } from "../../src/infrastructure/template-config-store.adapter.js";
import { conflictFilePath } from "../../src/domain/index.js";
import type {
  TemplateManifest,
  TemplateConfig,
} from "../../src/domain/index.js";
import type { TemplateRegistryPort } from "../../src/application/ports/template-registry.port.js";

function makeManifest(id: string, outputs: string[]): TemplateManifest {
  return {
    id,
    name: id,
    description: "",
    version: "1.0.0",
    requires: [],
    conflicts: [],
    questions: [],
    envVars: [],
    outputs,
    checklist: [],
  };
}

function stubRegistry(manifests: TemplateManifest[]): TemplateRegistryPort {
  return {
    loadAll: async () => manifests,
    loadOne: async (id) => manifests.find((m) => m.id === id) ?? null,
  };
}

describe("ValidateTemplatesUseCase — conflict detection", () => {
  let tmpDir: string;
  let projectRoot: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-validate-test-"));
    projectRoot = path.join(tmpDir, "project");
    await fs.mkdir(projectRoot, { recursive: true });
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("detects a conflict file for an output never recorded in generatedFiles", async () => {
    const manifest = makeManifest("tpl", ["output.txt"]);

    // Simulate: template installed but output had a conflict → not in generatedFiles
    const config: TemplateConfig = {
      schemaVersion: "1",
      templates: {
        tpl: {
          installedAt: new Date().toISOString(),
          version: "1.0.0",
          answers: {},
          generatedFiles: [], // conflict path was never recorded
        },
      },
    };

    // Write the conflict file to disk as the emitter would have
    const conflictDest = conflictFilePath(path.join(projectRoot, "output.txt"));
    await fs.writeFile(conflictDest, "updated template content", "utf-8");

    const configStore = new FileSystemTemplateConfigStore();
    await configStore.save(projectRoot, config);

    const useCase = new ValidateTemplatesUseCase(
      stubRegistry([manifest]),
      configStore,
    );
    const output = await useCase.execute(projectRoot);

    assert.equal(output.results.length, 1);
    const result = output.results[0];
    assert.equal(
      result.conflictFiles.length,
      1,
      "should detect the unresolved conflict file",
    );
    assert.match(result.conflictFiles[0], /hexagen-update/);
    assert.equal(output.totalErrors > 0, true);
  });
});
