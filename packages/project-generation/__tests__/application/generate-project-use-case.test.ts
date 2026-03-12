import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { GenerateProjectUseCase } from "../../src/application/generate-project-use-case.js";
import { InMemoryProjectGeneratorDouble } from "../doubles/in-memory-project-generator.double.js";
import { InMemoryZipCreatorDouble } from "../doubles/in-memory-zip-creator.double.js";
import type { Manifest } from "@hexagen/sync";

describe("GenerateProjectUseCase", () => {
  let generator: InMemoryProjectGeneratorDouble;
  let zipCreator: InMemoryZipCreatorDouble;
  let useCase: GenerateProjectUseCase;
  let manifest: Manifest;

  beforeEach(() => {
    generator = new InMemoryProjectGeneratorDouble();
    zipCreator = new InMemoryZipCreatorDouble();
    useCase = new GenerateProjectUseCase(generator, zipCreator);
    manifest = { system: "test-system" };
  });

  it("generates project with files format", async () => {
    const result = await useCase.execute({
      targetRoot: "/tmp/test",
      manifest,
      outputFormat: "files",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(generator.getCallCount(), 1);
    assert.strictEqual(zipCreator.getCallCount(), 0);
  });

  it("generates project with zip format", async () => {
    const result = await useCase.execute({
      targetRoot: "/tmp/test",
      manifest,
      outputFormat: "zip",
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;

    assert.strictEqual(generator.getCallCount(), 1);
    assert.strictEqual(zipCreator.getCallCount(), 1);
    assert.ok(result.value.zipBuffer);
    assert.ok(result.value.project.files.size > 0);
  });

  it("propagates generator failure", async () => {
    generator.setFailure({
      code: "GENERATION_FAILED",
      message: "Generation failed",
    });

    const result = await useCase.execute({
      targetRoot: "/tmp/test",
      manifest,
      outputFormat: "files",
    });

    assert.strictEqual(result.success, false);
    if (result.success) return;

    assert.strictEqual(result.error.message, "Generation failed");
  });

  it("propagates zip failure when generator succeeds", async () => {
    generator.reset();
    zipCreator.setFailure({
      code: "ZIP_CREATION_FAILED",
      message: "Zip creation failed",
    });

    const result = await useCase.execute({
      targetRoot: "/tmp/test",
      manifest,
      outputFormat: "zip",
    });

    assert.strictEqual(result.success, false);
    if (result.success) return;

    assert.strictEqual(result.error.message, "Zip creation failed");
  });

  it("returns project with correct properties", async () => {
    const result = await useCase.execute({
      targetRoot: "/tmp/test",
      manifest,
      outputFormat: "files",
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;

    assert.ok(result.value.project.id);
    assert.strictEqual(result.value.project.name, "test-system");
    assert.ok(result.value.project.files.size > 0);
  });
});
