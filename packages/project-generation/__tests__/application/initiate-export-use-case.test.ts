import { describe, it, beforeEach } from "vitest";
import assert from "node:assert";
import { GenerateProjectUseCase } from "../../src/application/generate-project-use-case.js";
import { InitiateExportUseCase } from "../../src/application/use-cases/initiate-export.use-case.js";
import { InMemoryProjectGeneratorDouble } from "../doubles/in-memory-project-generator.double.js";
import { RecordingExporterDouble } from "../doubles/recording-exporter.double.js";
import { InMemoryAddOnMaterializerDouble } from "../doubles/in-memory-add-on-materializer.double.js";
import type { Manifest } from "@hexagen/sync";

describe("InitiateExportUseCase — add-on threading", () => {
  let generator: InMemoryProjectGeneratorDouble;
  let recorder: RecordingExporterDouble;
  let materializer: InMemoryAddOnMaterializerDouble;
  const manifest: Manifest = { system: "test-system" };

  beforeEach(() => {
    generator = new InMemoryProjectGeneratorDouble();
    recorder = new RecordingExporterDouble();
    materializer = new InMemoryAddOnMaterializerDouble();
  });

  it("threads ExportIntent.addOnsAnswers into materialize() so the export includes add-ons", async () => {
    materializer.setResult({
      files: new Map([["src/added.ts", "export const x = 1;"]]),
    });
    const factory = () =>
      new GenerateProjectUseCase(generator, recorder, materializer);
    const useCase = new InitiateExportUseCase(factory);

    const result = await useCase.initiateExport({
      target: "github",
      workspaceRef: { projectId: "p1", manifest },
      repoConfig: { token: "t", owner: "o", repoName: "r", isPrivate: false },
      addOnsAnswers: { "rate-limiting": { enabled: true } },
    });

    assert.strictEqual(result.success, true);
    // The intent's answers reached the materializer (so add-ons are included
    // in the export, not just the /api/generate code-view path).
    assert.deepStrictEqual(materializer.getCalls(), [
      { "rate-limiting": { enabled: true } },
    ]);
    // And the materialized add-on file was written to the temp dir the exporter
    // reads — i.e. it lands in the ZIP / GitHub output.
    assert.strictEqual(
      recorder.getCapturedFiles().get("src/added.ts"),
      "export const x = 1;",
    );
  });

  it("threads materialization errors out through the export result (+ sidecar on disk)", async () => {
    materializer.setResult({ errors: ["conflict: a vs b"] });
    const factory = () =>
      new GenerateProjectUseCase(generator, recorder, materializer);
    const useCase = new InitiateExportUseCase(factory);

    const result = await useCase.initiateExport({
      target: "github",
      workspaceRef: { projectId: "p1", manifest },
      repoConfig: { token: "t", owner: "o", repoName: "r", isPrivate: false },
      addOnsAnswers: { a: {}, b: {} },
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    // Data-flow gap closed: errors reach the export result, so
    // /api/export/github can surface them...
    assert.deepStrictEqual(result.value.errors, ["conflict: a vs b"]);
    // ...and the A1 sidecar reached the exported tree.
    assert.ok(recorder.getCapturedFiles().has("HEXAGEN-ADDON-NOTICES.md"));
  });

  it("omits add-ons when the intent carries none (materializer not called)", async () => {
    const factory = () =>
      new GenerateProjectUseCase(generator, recorder, materializer);
    const useCase = new InitiateExportUseCase(factory);

    const result = await useCase.initiateExport({
      target: "github",
      workspaceRef: { projectId: "p1", manifest },
      repoConfig: { token: "t", owner: "o", repoName: "r", isPrivate: false },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(materializer.getCallCount(), 0);
  });
});
