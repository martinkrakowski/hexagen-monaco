import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { GenerateProjectUseCase } from "../../src/application/generate-project-use-case.js";
import { InMemoryProjectGeneratorDouble } from "../doubles/in-memory-project-generator.double.js";
import { InMemoryGitHubExporterDouble } from "../doubles/in-memory-github-exporter.double.js";
import { InMemoryZipProjectExporterDouble } from "../doubles/in-memory-project-exporter.double.js";
import { InMemoryAddOnMaterializerDouble } from "../doubles/in-memory-add-on-materializer.double.js";
import { RecordingExporterDouble } from "../doubles/recording-exporter.double.js";
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

describe("GenerateProjectUseCase — add-on materialization", () => {
  let generator: InMemoryProjectGeneratorDouble;
  let materializer: InMemoryAddOnMaterializerDouble;
  let recorder: RecordingExporterDouble;
  const manifest: Manifest = { system: "test-system" };
  const archive: ExportConfig = { destination: "archive" };

  beforeEach(() => {
    generator = new InMemoryProjectGeneratorDouble();
    materializer = new InMemoryAddOnMaterializerDouble();
    recorder = new RecordingExporterDouble();
  });

  it("merges add-on files into project.files AND the temp dir (template-overrides-core)", async () => {
    // The generator double emits README.md; the add-on overrides it + adds a file.
    materializer.setResult({
      files: new Map([
        ["README.md", "# From add-on"],
        ["src/feature.ts", "export const feature = true;"],
      ]),
    });

    const useCase = new GenerateProjectUseCase(
      generator,
      recorder,
      materializer,
    );
    const result = await useCase.execute({
      manifest,
      exportConfig: archive,
      addOnsAnswers: { "rate-limiting": {} },
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;

    // Code view (project.files): override won + new file present.
    assert.strictEqual(
      result.value.project.files.get("README.md"),
      "# From add-on",
    );
    assert.strictEqual(
      result.value.project.files.get("src/feature.ts"),
      "export const feature = true;",
    );

    // Temp dir (what ZIP/GitHub capture): the add-on README OVERWROTE the core
    // README the generator wrote to disk ("# Test Project"), and the new file
    // reached disk too — proving template-overrides-core on disk, not just in-mem.
    const onDisk = recorder.getCapturedFiles();
    assert.strictEqual(onDisk.get("README.md"), "# From add-on");
    assert.strictEqual(
      onDisk.get("src/feature.ts"),
      "export const feature = true;",
    );

    // The override of a generated file is reported as a warning.
    assert.ok(
      result.value.warnings?.some((w) => w.includes("README.md")),
      "expected an override warning mentioning README.md",
    );
    assert.strictEqual(materializer.getCallCount(), 1);
    // Warnings (overrides) get no sidecar — that's reserved for errors.
    assert.strictEqual(
      result.value.project.files.has("HEXAGEN-ADDON-NOTICES.md"),
      false,
    );
  });

  it("passes a bad selection through as errors (no throw) and still ships the core project", async () => {
    materializer.setResult({
      errors: ["conflict: rate-limiting vs no-rate-limiting"],
    });

    const useCase = new GenerateProjectUseCase(
      generator,
      recorder,
      materializer,
    );
    const result = await useCase.execute({
      manifest,
      exportConfig: archive,
      addOnsAnswers: { "rate-limiting": {}, "no-rate-limiting": {} },
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    assert.deepStrictEqual(result.value.errors, [
      "conflict: rate-limiting vs no-rate-limiting",
    ]);
    // No add-on files merged; the core project still generated and exported.
    assert.strictEqual(result.value.project.files.has("src/feature.ts"), false);
    assert.strictEqual(
      result.value.project.files.get("README.md"),
      "# Test Project",
    );
    assert.strictEqual(recorder.getCallCount(), 1);
    // A1: the failure is explained in an in-artifact notices file — present in
    // project.files (code view) AND on disk (what ZIP/GitHub capture).
    assert.ok(
      result.value.project.files
        .get("HEXAGEN-ADDON-NOTICES.md")
        ?.includes("conflict: rate-limiting vs no-rate-limiting"),
      "notices file should explain the failed selection",
    );
    assert.ok(
      recorder.getCapturedFiles().has("HEXAGEN-ADDON-NOTICES.md"),
      "notices file should reach the temp dir before export",
    );
  });

  it("is a no-op when addOnsAnswers is empty (materializer never called)", async () => {
    const useCase = new GenerateProjectUseCase(
      generator,
      recorder,
      materializer,
    );
    const result = await useCase.execute({
      manifest,
      exportConfig: archive,
      addOnsAnswers: {},
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    assert.strictEqual(materializer.getCallCount(), 0);
    assert.strictEqual(result.value.warnings, undefined);
    assert.strictEqual(result.value.errors, undefined);
  });

  it("behaves as before when no materializer is injected", async () => {
    const useCase = new GenerateProjectUseCase(generator, recorder); // 2-arg
    const result = await useCase.execute({
      manifest,
      exportConfig: archive,
      addOnsAnswers: { "rate-limiting": {} }, // present, but nothing wired
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    assert.strictEqual(materializer.getCallCount(), 0);
    assert.strictEqual(result.value.warnings, undefined);
    assert.strictEqual(result.value.errors, undefined);
  });

  it("rejects an add-on file whose path escapes the project root", async () => {
    materializer.setResult({
      files: new Map([["../escape.ts", "export const x = 1;"]]),
    });
    const useCase = new GenerateProjectUseCase(
      generator,
      recorder,
      materializer,
    );
    await assert.rejects(
      () =>
        useCase.execute({
          manifest,
          exportConfig: archive,
          addOnsAnswers: { "rate-limiting": {} },
        }),
      /escapes project root/,
    );
  });
});
