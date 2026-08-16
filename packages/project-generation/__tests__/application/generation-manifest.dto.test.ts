import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { Manifest } from "@hexagen/sync";
import type { Result } from "@hexagen/shared";
import type { GenerationManifest } from "../../src/application/generation-manifest.js";
import { GenerateProjectUseCase } from "../../src/application/generate-project-use-case.js";
import type {
  ExternalProjectGeneratorPort,
  GeneratorError,
} from "../../src/application/ports/out/external-project-generator.port.js";
import { Project } from "../../src/domain/entities/project.js";
import { InMemoryZipProjectExporterDouble } from "../doubles/in-memory-project-exporter.double.js";
import { InMemoryProjectWorkspacePortDouble } from "../doubles/in-memory-project-workspace.double.js";

/**
 * HEX-004 — the context-owned DTO has to stay a faithful *widening* of the
 * engine's manifest dialect, in both directions:
 *
 *   - engine `Manifest` → `GenerationManifest`, or every existing caller (the
 *     web export/generate routes hold an engine `Manifest`) would need a cast;
 *   - `GenerationManifest` → engine `Manifest`, or `ExternalSyncEngineAdapter`
 *     could not hand the document to `SyncEngine` without one.
 *
 * The second direction is already load-bearing in production code (the adapter's
 * `const engineManifest: Manifest = manifest`). The first is pinned here.
 *
 * The two assignability cases are **compile-time** assertions, enforced by
 * `yarn typecheck:test` (`tsconfig.test.json` includes `__tests__/**`, and CI
 * runs it) — the `assert` calls in them only prove the file was loaded. Said
 * plainly rather than dressed up as coverage: a type contract is checked by the
 * type checker. The third case is a genuine runtime test.
 */
describe("GenerationManifest ↔ engine Manifest", () => {
  it("accepts an engine manifest without a cast", () => {
    const fromEngine: Manifest = {
      system: "acme",
      architecture: "modular-monolith",
      monorepo: { packageManager: "yarn", linker: "node-modules" },
      bounded_contexts: [{ name: "billing", type: "core" }],
    };

    // The assertion under test is the annotation, not the assert().
    const asDto: GenerationManifest = fromEngine;
    assert.equal(asDto.system, "acme");
    assert.equal(asDto.monorepo?.packageManager, "yarn");
  });

  it("is accepted by the engine without a cast", () => {
    const fromDto: GenerationManifest = {
      system: "acme",
      monorepo: { packageManager: "pnpm" },
      // Generator dialect this context never interprets, carried opaquely.
      generator: { sync: { apps: { enabled: true } } },
    };

    const asEngine: Manifest = fromDto;
    assert.equal(asEngine.system, "acme");
  });
});

/** Records what the use case actually handed to the driven generator port. */
class RecordingGenerator implements ExternalProjectGeneratorPort {
  received: GenerationManifest | undefined;

  async generateAt(
    _targetRoot: string,
    manifest: GenerationManifest,
  ): Promise<Result<Project, GeneratorError>> {
    this.received = manifest;
    return {
      success: true,
      value: Project.create({
        id: "recorded",
        name: "acme",
        rootName: "acme",
        files: new Map([["README.md", "# acme"]]),
      }),
    };
  }
}

describe("the generation use case transports the manifest opaquely", () => {
  it("hands the whole document to the generator port, untouched", async () => {
    const generator = new RecordingGenerator();
    const useCase = new GenerateProjectUseCase(
      generator,
      new InMemoryZipProjectExporterDouble(),
      undefined,
      new InMemoryProjectWorkspacePortDouble(),
    );

    // Sections this context has no type for at all: if the DTO ever stopped
    // being open, or the use case started projecting the manifest through a
    // narrower shape, these keys would not survive the round trip.
    const manifest: GenerationManifest = {
      system: "acme",
      monorepo: { packageManager: "yarn" },
      bounded_contexts: [{ name: "billing", type: "core" }],
      generator: { sync: { apps: { enabled: true } } },
      unknown_future_section: { anything: [1, 2, 3] },
    };

    const result = await useCase.execute({
      manifest,
      exportConfig: { destination: "archive" },
    });

    assert.equal(result.success, true);
    assert.deepEqual(generator.received, manifest);
  });
});
