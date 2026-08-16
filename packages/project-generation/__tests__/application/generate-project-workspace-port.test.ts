import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { GenerateProjectUseCase } from "../../src/application/generate-project-use-case.js";
import { InMemoryProjectGeneratorDouble } from "../doubles/in-memory-project-generator.double.js";
import { InMemoryZipProjectExporterDouble } from "../doubles/in-memory-project-exporter.double.js";
import { InMemoryAddOnMaterializerDouble } from "../doubles/in-memory-add-on-materializer.double.js";
import { InMemoryProjectWorkspacePortDouble } from "../doubles/in-memory-project-workspace.double.js";
import type { ExportConfig } from "../../src/application/ports/out/project-exporter.port.js";
import {
  SYNC_INTEGRITY_WORKFLOW,
  SYNC_INTEGRITY_WORKFLOW_PATH,
} from "../../src/domain/sync-integrity-workflow.js";
import type { Manifest } from "@hexagen/sync";

/**
 * HEX-002 — the use case runs to completion with NO filesystem anywhere: an
 * in-memory workspace double, a generator that never touches disk, and a
 * workspace reference (`memory://workspace-1`) that is not a path.
 *
 * Every assertion here is on the workspace's recorded CONTENT, never on a call
 * count alone: a stub workspace that accepted `writeText` and dropped it on the
 * floor has to fail these, or they would be worthless as a guard.
 */
describe("GenerateProjectUseCase — driven through an in-memory workspace", () => {
  let generator: InMemoryProjectGeneratorDouble;
  let exporter: InMemoryZipProjectExporterDouble;
  let materializer: InMemoryAddOnMaterializerDouble;
  let workspaces: InMemoryProjectWorkspacePortDouble;
  const manifest: Manifest = { system: "test-system" };
  const archive: ExportConfig = { destination: "archive" };

  beforeEach(() => {
    // persistToDisk:false — `memory://workspace-1` is an opaque reference, and
    // a double that path-joined it would silently create junk under the cwd.
    generator = new InMemoryProjectGeneratorDouble({ persistToDisk: false });
    exporter = new InMemoryZipProjectExporterDouble();
    materializer = new InMemoryAddOnMaterializerDouble();
    workspaces = new InMemoryProjectWorkspacePortDouble();
  });

  it("writes the injected workflow and the add-on files into the workspace, then releases it", async () => {
    materializer.setResult({
      files: new Map([
        ["README.md", "# From add-on"],
        ["src/nested/feature.ts", "export const feature = true;"],
      ]),
    });

    const useCase = new GenerateProjectUseCase(
      generator,
      exporter,
      materializer,
      workspaces,
    );
    const result = await useCase.execute({
      manifest,
      exportConfig: archive,
      addOnsAnswers: { "rate-limiting": {} },
    });

    assert.equal(result.success, true);
    if (!result.success) return;

    const workspace = workspaces.last;

    // Content, not call counts: a workspace stub that swallowed every write
    // would leave `entries` empty and fail here.
    assert.equal(
      workspace.entries.get(SYNC_INTEGRITY_WORKFLOW_PATH),
      SYNC_INTEGRITY_WORKFLOW,
    );
    assert.equal(workspace.entries.get("README.md"), "# From add-on");
    assert.equal(
      workspace.entries.get("src/nested/feature.ts"),
      "export const feature = true;",
    );

    // The generator and the exporter are handed the workspace's own reference —
    // the use case never fabricates a path of its own.
    assert.deepEqual(generator.targetRoots, ["memory://workspace-1"]);
    assert.equal(
      exporter.getExportedConfigs()[0].sourceDir,
      "memory://workspace-1",
    );

    // The in-memory `project.files` view stays in step with the workspace.
    assert.equal(result.value.project.files.get("README.md"), "# From add-on");
    assert.equal(
      result.value.project.files.get(SYNC_INTEGRITY_WORKFLOW_PATH),
      SYNC_INTEGRITY_WORKFLOW,
    );

    // The add-on replacing a generated file is still reported.
    assert.ok(
      result.value.warnings?.some((w) => w.includes("README.md")),
      "expected an override warning naming README.md",
    );

    // Released in the `finally`, after the exporter ran.
    assert.equal(workspace.released, true);
  });

  it("reads the archive back out of the workspace as the returned zip buffer", async () => {
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x2a]);
    workspaces.seedArtifacts.set("project.zip", zipBytes);

    const useCase = new GenerateProjectUseCase(
      generator,
      exporter,
      undefined,
      workspaces,
    );
    const result = await useCase.execute({ manifest, exportConfig: archive });

    assert.equal(result.success, true);
    if (!result.success) return;
    assert.ok(result.value.zipBuffer, "expected a zip buffer");
    assert.deepEqual(
      Array.from(result.value.zipBuffer),
      Array.from(zipBytes),
      "the returned buffer must be the workspace's archive bytes, unaltered",
    );
  });

  it("returns no zip buffer when the workspace holds no archive", async () => {
    const useCase = new GenerateProjectUseCase(
      generator,
      exporter,
      undefined,
      workspaces,
    );
    const result = await useCase.execute({ manifest, exportConfig: archive });

    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.value.zipBuffer, undefined);
  });

  it("writes NOTHING through the port when there is no workflow to inject and no add-ons", async () => {
    const useCase = new GenerateProjectUseCase(
      generator,
      exporter,
      materializer,
      workspaces,
    );
    const result = await useCase.execute({
      // pnpm opts out of the workflow injection.
      manifest: {
        system: "test-system",
        monorepo: { packageManager: "pnpm@9.0.0" },
      },
      exportConfig: archive,
    });

    assert.equal(result.success, true);
    assert.deepEqual(workspaces.last.writeLog, []);
    assert.equal(workspaces.last.released, true);
  });

  it("writes the notices sidecar into the workspace when a selection fails", async () => {
    materializer.setResult({ errors: ["Unknown template: nope"] });

    const useCase = new GenerateProjectUseCase(
      generator,
      exporter,
      materializer,
      workspaces,
    );
    const result = await useCase.execute({
      manifest,
      exportConfig: archive,
      addOnsAnswers: { nope: {} },
    });

    assert.equal(result.success, true);
    assert.ok(
      workspaces.last.entries
        .get("HEXAGEN-ADDON-NOTICES.md")
        ?.includes("Unknown template: nope"),
      "the sidecar must reach the workspace, not just project.files",
    );
  });

  it("rejects an escaping add-on path WITHOUT ever handing it to the workspace", async () => {
    materializer.setResult({
      files: new Map([["../escape.ts", "export const x = 1;"]]),
    });

    const useCase = new GenerateProjectUseCase(
      generator,
      exporter,
      materializer,
      workspaces,
    );
    await assert.rejects(
      () =>
        useCase.execute({
          manifest,
          exportConfig: archive,
          addOnsAnswers: { evil: {} },
        }),
      /escapes project root/,
    );

    // Path policy is the use case's, not the adapter's: the escaping key must
    // never reach an implementation that might be lenient about it.
    assert.equal(
      workspaces.last.writeLog.includes("escape.ts"),
      false,
      "the escaping key must not be written",
    );
    assert.equal(
      [...workspaces.last.entries.keys()].some((k) => k.includes("escape")),
      false,
    );
    // Still released despite the throw.
    assert.equal(workspaces.last.released, true);
  });

  it("releases the workspace when the exporter fails", async () => {
    exporter.setFailure("Export failed");

    const useCase = new GenerateProjectUseCase(
      generator,
      exporter,
      undefined,
      workspaces,
    );
    const result = await useCase.execute({ manifest, exportConfig: archive });

    assert.equal(result.success, false);
    assert.equal(workspaces.last.released, true);
  });

  it("releases the workspace when generation fails", async () => {
    generator.setFailure({
      code: "GENERATION_FAILED",
      message: "Generation failed",
    });

    const useCase = new GenerateProjectUseCase(
      generator,
      exporter,
      undefined,
      workspaces,
    );
    const result = await useCase.execute({ manifest, exportConfig: archive });

    assert.equal(result.success, false);
    assert.equal(workspaces.last.released, true);
  });
});
