import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { GenerateProjectUseCase } from "../../src/application/generate-project-use-case.js";
import { InMemoryProjectGeneratorDouble } from "../doubles/in-memory-project-generator.double.js";
import { InMemoryGitHubExporterDouble } from "../doubles/in-memory-github-exporter.double.js";
import { InMemoryZipProjectExporterDouble } from "../doubles/in-memory-project-exporter.double.js";
import type { Manifest } from "@hexagen/sync";
import type { ExportConfig } from "../../src/application/ports/out/project-exporter.port.js";

describe("GenerateProjectUseCase", () => {
  let generator: InMemoryProjectGeneratorDouble;
  let zipExporter: InMemoryZipProjectExporterDouble;
  let githubExporter: InMemoryGitHubExporterDouble;
  let manifest: Manifest;

  beforeEach(() => {
    generator = new InMemoryProjectGeneratorDouble();
    zipExporter = new InMemoryZipProjectExporterDouble();
    githubExporter = new InMemoryGitHubExporterDouble();
    manifest = { system: "test-system" };
  });

  it("generates project with zip format", async () => {
    const useCase = new GenerateProjectUseCase(generator, zipExporter);
    const result = await useCase.execute({
      manifest,
      exportConfig: {
        destination: "archive",
      },
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    assert.strictEqual(generator.getCallCount(), 1);
    assert.strictEqual(zipExporter.getCallCount(), 1);
    assert.ok(result.value.project.files.size > 0);
  });

  it("generates project with GitHub format", async () => {
    const useCase = new GenerateProjectUseCase(generator, githubExporter);
    const result = await useCase.execute({
      manifest,
      exportConfig: {
        destination: "github",
        github: {
          token: "test-token",
          owner: "test-owner",
          repoName: "test-repo",
          isPrivate: false,
        },
      },
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    assert.strictEqual(generator.getCallCount(), 1);
    assert.strictEqual(githubExporter.getCallCount(), 1);
    const exportedConfig = githubExporter.getExportedConfigs()[0];
    assert.strictEqual(exportedConfig.config.destination, "github");
    assert.strictEqual(exportedConfig.config.github?.token, "test-token");
    assert.strictEqual(exportedConfig.config.github?.repoName, "test-repo");
  });

  it("propagates generator failure", async () => {
    generator.setFailure({
      code: "GENERATION_FAILED",
      message: "Generation failed",
    });

    const useCase = new GenerateProjectUseCase(generator, zipExporter);
    const result = await useCase.execute({
      manifest,
      exportConfig: {
        destination: "archive",
      },
    });

    assert.strictEqual(result.success, false);
    if (result.success) return;
    assert.strictEqual(result.error.message, "Generation failed");
  });

  it("propagates exporter failure when generator succeeds", async () => {
    generator.reset();
    zipExporter.setFailure("Export failed");

    const useCase = new GenerateProjectUseCase(generator, zipExporter);
    const result = await useCase.execute({
      manifest,
      exportConfig: {
        destination: "archive",
      },
    });

    assert.strictEqual(result.success, false);
    if (result.success) return;
    assert.strictEqual(result.error.message, "Export failed");
  });

  it("returns project with correct properties", async () => {
    const useCase = new GenerateProjectUseCase(generator, zipExporter);
    const result = await useCase.execute({
      manifest,
      exportConfig: {
        destination: "archive",
      },
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    assert.ok(result.value.project.id);
    assert.strictEqual(result.value.project.name, "test-system");
    assert.ok(result.value.project.files.size > 0);
  });
});
