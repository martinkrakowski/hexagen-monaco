import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ValidateTemplatesUseCase } from "../../src/application/use-cases/validate-templates.use-case.js";
import { FileSystemTemplateConfigStore } from "../../src/infrastructure/template-config-store.adapter.js";
import { FileSystemProjectFilePresence } from "../../src/infrastructure/project-file-presence.adapter.js";
import { ProcessEnvironmentReader } from "../../src/infrastructure/environment-reader.adapter.js";
import { conflictFilePath } from "../../src/domain/index.js";
import type {
  TemplateManifest,
  TemplateConfig,
} from "../../src/domain/index.js";
import type { TemplateRegistryPort } from "../../src/application/ports/template-registry.port.js";

function makeManifest(
  id: string,
  outputs: TemplateManifest["outputs"],
): TemplateManifest {
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

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-validate-test-"));
    projectRoot = path.join(tmpDir, "project");
    await fs.mkdir(projectRoot, { recursive: true });
  });

  afterAll(async () => {
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
      new FileSystemProjectFilePresence(),
      new ProcessEnvironmentReader(),
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

  it("does not report a gated-off output as missing", async () => {
    // Output gated on orm=true; the install answered orm=false, so the file was
    // never emitted and must not be flagged missing.
    const manifest = makeManifest("gated", [
      { path: "drizzle/client.ts", when: { answer: "orm", equals: true } },
    ]);
    const config: TemplateConfig = {
      schemaVersion: "1",
      templates: {
        gated: {
          installedAt: new Date().toISOString(),
          version: "1.0.0",
          answers: { orm: false },
          generatedFiles: [],
        },
      },
    };

    const configStore = new FileSystemTemplateConfigStore();
    await configStore.save(projectRoot, config);

    const useCase = new ValidateTemplatesUseCase(
      stubRegistry([manifest]),
      configStore,
      new FileSystemProjectFilePresence(),
      new ProcessEnvironmentReader(),
    );
    const output = await useCase.execute(projectRoot);

    assert.equal(output.results.length, 1);
    assert.equal(output.results[0].missingFiles.length, 0);
    assert.equal(output.results[0].passed, true);
  });
});

describe("conflict-path derivation is unchanged by dropping node:path", () => {
  // The use case used to report
  //   path.relative(root, conflictFilePath(path.join(root, rel)))
  // and now reports conflictFilePath(rel) — the port takes the relative path
  // and joins on the infrastructure side. This pins that the two agree for
  // every path shape a template manifest declares, which is what backs the
  // "behaviour unchanged" claim for the conflictFiles strings.
  const root = path.join(path.sep, "workspace", "project");

  const cases = [
    "output.txt",
    "src/a.ts",
    "src/nested/deep/file.tsx",
    "Dockerfile",
    ".env",
    "config/.eslintrc.json",
    "app/api/auth/[...all]/route.ts",
    "app/admin/queues/[[...slug]]/route.ts",
    "scripts/build.config.mjs",
  ];

  for (const rel of cases) {
    it(`agrees for '${rel}'`, () => {
      const viaAbsolute = path.relative(
        root,
        conflictFilePath(path.join(root, rel)),
      );
      const viaRelative = conflictFilePath(rel);
      assert.equal(viaRelative, viaAbsolute.split(path.sep).join("/"));
    });
  }
});
