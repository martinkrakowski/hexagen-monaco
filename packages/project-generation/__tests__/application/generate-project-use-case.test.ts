import { describe, it, beforeEach } from "vitest";
import assert from "node:assert";
import {
  ExportError,
  GenerateProjectUseCase,
} from "../../src/application/generate-project-use-case.js";
import { InMemoryProjectGeneratorDouble } from "../doubles/in-memory-project-generator.double.js";
import { InMemoryGitHubExporterDouble } from "../doubles/in-memory-github-exporter.double.js";
import { InMemoryZipProjectExporterDouble } from "../doubles/in-memory-project-exporter.double.js";
import { InMemoryAddOnMaterializerDouble } from "../doubles/in-memory-add-on-materializer.double.js";
import { RecordingExporterDouble } from "../doubles/recording-exporter.double.js";
import type { Manifest } from "@hexagen/sync";
import type { ExportConfig } from "../../src/application/ports/out/project-exporter.port.js";
import {
  HEXAGEN_CONFORMANCE_ACTION_YML,
  HEXAGEN_CONFORMANCE_ACTION_YML_PATH,
  HEXAGEN_CONFORMANCE_COMMENT_SCRIPT,
  HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH,
  SYNC_INTEGRITY_WORKFLOW,
  SYNC_INTEGRITY_WORKFLOW_PATH,
} from "../../src/domain/sync-integrity-workflow.js";
import type { ExternalProjectGeneratorPort } from "../../src/application/ports/out/external-project-generator.port.js";
import type { ProjectExporterPort } from "../../src/application/ports/out/project-exporter.port.js";
import type { AddOnMaterializerPort } from "../../src/application/ports/out/add-on-materializer.port.js";
import { ScratchDirProjectWorkspaceAdapter } from "../../src/infrastructure/adapters/scratch-dir-project-workspace.adapter.js";

/**
 * Every case in this file runs against the REAL scratch-dir workspace adapter —
 * the production binding — so the on-disk assertions below (via
 * `RecordingExporterDouble`, which walks the actual directory the exporter is
 * handed) keep proving that what reaches an export is byte-for-byte what it was
 * before the workspace port existed. The port is exercised against an in-memory
 * workspace in `generate-project-workspace-port.test.ts`.
 */
const makeUseCase = (
  generator: ExternalProjectGeneratorPort,
  exporter: ProjectExporterPort,
  materializer?: AddOnMaterializerPort,
) =>
  new GenerateProjectUseCase(
    generator,
    exporter,
    materializer,
    new ScratchDirProjectWorkspaceAdapter(),
  );

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
    const useCase = makeUseCase(generator, zipExporter);
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
    const useCase = makeUseCase(generator, githubExporter);
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

    const useCase = makeUseCase(generator, zipExporter);
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

    const useCase = makeUseCase(generator, zipExporter);
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
    const useCase = makeUseCase(generator, zipExporter);
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

    const useCase = makeUseCase(generator, recorder, materializer);
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

    const useCase = makeUseCase(generator, recorder, materializer);
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

  it("sanitizes untrusted error text in the notices sidecar (no Markdown injection)", async () => {
    // Error text can embed template ids from untrusted request keys.
    materializer.setResult({
      errors: ["Unknown template: [pwn](http://evil)\nsecond line `code`"],
    });
    const useCase = makeUseCase(generator, recorder, materializer);
    const result = await useCase.execute({
      manifest,
      exportConfig: archive,
      addOnsAnswers: { "[pwn](http://evil)": {} },
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    const notice =
      result.value.project.files.get("HEXAGEN-ADDON-NOTICES.md") ?? "";
    // Collapsed to one line, backticks neutralized, wrapped in inline code so
    // the link stays literal (won't render as a clickable link / break the list).
    assert.ok(
      notice.includes(
        "- `Unknown template: [pwn](http://evil) second line 'code'`",
      ),
      "error should be one-lined, backtick-neutralized, and inline-code-wrapped",
    );
    assert.ok(
      !notice.includes("\nsecond line"),
      "a newline in the error must not break the list structure",
    );
  });

  it("caps a very long error to keep the notices artifact from bloating", async () => {
    materializer.setResult({ errors: ["x".repeat(5000)] });
    const useCase = makeUseCase(generator, recorder, materializer);
    const result = await useCase.execute({
      manifest,
      exportConfig: archive,
      addOnsAnswers: { bad: {} },
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    const notice =
      result.value.project.files.get("HEXAGEN-ADDON-NOTICES.md") ?? "";
    assert.ok(notice.includes("…"), "an over-long error should be truncated");
    assert.ok(
      !notice.includes("x".repeat(400)),
      "the raw 5000-char error must not be embedded verbatim",
    );
  });

  it("caps the NUMBER of rendered notices so many bad keys can't bloat the artifact", async () => {
    materializer.setResult({
      errors: Array.from({ length: 120 }, (_, i) => `Unknown template: t${i}`),
    });
    const useCase = makeUseCase(generator, recorder, materializer);
    const result = await useCase.execute({
      manifest,
      exportConfig: archive,
      addOnsAnswers: { bad: {} },
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    const notice =
      result.value.project.files.get("HEXAGEN-ADDON-NOTICES.md") ?? "";
    // 50 rendered bullets + a single overflow summary line — not 120.
    const bulletCount = (notice.match(/^- /gm) ?? []).length;
    assert.strictEqual(bulletCount, 51);
    assert.ok(notice.includes("…and 70 more"));
  });

  it("coerces a non-string error defensively instead of crashing", async () => {
    // The materializer is an injected port; a non-string crossing it (type-system
    // violation / future adapter) must not crash the request on `.replace`.
    materializer.setResult({ errors: [null as unknown as string] });
    const useCase = makeUseCase(generator, recorder, materializer);
    const result = await useCase.execute({
      manifest,
      exportConfig: archive,
      addOnsAnswers: { bad: {} },
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    const notice =
      result.value.project.files.get("HEXAGEN-ADDON-NOTICES.md") ?? "";
    assert.ok(
      notice.includes("`null`"),
      "non-string error should be String()-coerced, not crash",
    );
  });

  it("is a no-op when addOnsAnswers is empty (materializer never called)", async () => {
    const useCase = makeUseCase(generator, recorder, materializer);
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
    const useCase = makeUseCase(generator, recorder); // 2-arg
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
    const useCase = makeUseCase(generator, recorder, materializer);
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

describe("GenerateProjectUseCase — sync-integrity workflow injection", () => {
  let generator: InMemoryProjectGeneratorDouble;
  let recorder: RecordingExporterDouble;
  const archive: ExportConfig = { destination: "archive" };

  beforeEach(() => {
    generator = new InMemoryProjectGeneratorDouble();
    recorder = new RecordingExporterDouble();
  });

  it("auto-injects the workflow into project.files AND the export for a yarn project", async () => {
    const useCase = makeUseCase(generator, recorder);
    const result = await useCase.execute({
      manifest: { system: "test-system" }, // no packageManager → yarn default
      exportConfig: archive,
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;

    // Code view (project.files).
    assert.strictEqual(
      result.value.project.files.get(SYNC_INTEGRITY_WORKFLOW_PATH),
      SYNC_INTEGRITY_WORKFLOW,
    );
    // On disk (what ZIP / GitHub capture).
    assert.strictEqual(
      recorder.getCapturedFiles().get(SYNC_INTEGRITY_WORKFLOW_PATH),
      SYNC_INTEGRITY_WORKFLOW,
    );
    assert.strictEqual(
      result.value.project.files.get(HEXAGEN_CONFORMANCE_ACTION_YML_PATH),
      HEXAGEN_CONFORMANCE_ACTION_YML,
    );
    assert.strictEqual(
      recorder.getCapturedFiles().get(HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH),
      HEXAGEN_CONFORMANCE_COMMENT_SCRIPT,
    );
    // Injection is silent — no warnings/errors.
    assert.strictEqual(result.value.warnings, undefined);
    assert.strictEqual(result.value.errors, undefined);
  });

  it("does NOT inject for a pnpm project", async () => {
    const useCase = makeUseCase(generator, recorder);
    const result = await useCase.execute({
      manifest: {
        system: "test-system",
        monorepo: { packageManager: "pnpm@9.0.0" },
      },
      exportConfig: archive,
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    assert.strictEqual(
      result.value.project.files.has(SYNC_INTEGRITY_WORKFLOW_PATH),
      false,
    );
    assert.strictEqual(
      recorder.getCapturedFiles().has(SYNC_INTEGRITY_WORKFLOW_PATH),
      false,
    );
  });

  it("lets an add-on override the injected workflow (template-overrides-core, with a warning)", async () => {
    const materializer = new InMemoryAddOnMaterializerDouble();
    materializer.setResult({
      files: new Map([[SYNC_INTEGRITY_WORKFLOW_PATH, "name: custom\n"]]),
    });
    const useCase = makeUseCase(generator, recorder, materializer);
    const result = await useCase.execute({
      manifest: { system: "test-system" },
      exportConfig: archive,
      addOnsAnswers: { "custom-ci": {} },
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    // The add-on wins, on disk too.
    assert.strictEqual(
      result.value.project.files.get(SYNC_INTEGRITY_WORKFLOW_PATH),
      "name: custom\n",
    );
    assert.strictEqual(
      recorder.getCapturedFiles().get(SYNC_INTEGRITY_WORKFLOW_PATH),
      "name: custom\n",
    );
    // The override of the injected core file is reported as a warning.
    assert.ok(
      result.value.warnings?.some((w) =>
        w.includes(SYNC_INTEGRITY_WORKFLOW_PATH),
      ),
      "expected an override warning naming the workflow path",
    );
  });
});

describe("GenerateProjectUseCase — exporter warnings & typed export errors", () => {
  let generator: InMemoryProjectGeneratorDouble;
  let githubExporter: InMemoryGitHubExporterDouble;
  const github: ExportConfig = {
    destination: "github",
    github: {
      token: "test-token",
      owner: "octocat",
      repoName: "hexagen-app",
      isPrivate: false,
    },
  };

  beforeEach(() => {
    generator = new InMemoryProjectGeneratorDouble();
    githubExporter = new InMemoryGitHubExporterDouble();
  });

  it("merges exporter warnings (e.g. skipped workflow files) into the output warnings", async () => {
    githubExporter.setWarnings([
      "Skipped .github/workflows/sync-integrity.yml: the connected GitHub token lacks the 'workflow' scope.",
    ]);
    const useCase = makeUseCase(generator, githubExporter);
    const result = await useCase.execute({
      manifest: { system: "test-system" },
      exportConfig: github,
    });

    assert.strictEqual(result.success, true);
    if (!result.success) return;
    assert.ok(
      result.value.warnings?.some((w) =>
        w.includes(".github/workflows/sync-integrity.yml"),
      ),
      "exporter warnings must surface on GenerateProjectOutput.warnings",
    );
  });

  it("threads the exporter's typed errorCode through as ExportError", async () => {
    githubExporter.setFailure(
      "GitHub rejected this push because it includes GitHub Actions workflow files.",
      "workflow-scope-missing",
    );
    const useCase = makeUseCase(generator, githubExporter);
    const result = await useCase.execute({
      manifest: { system: "test-system" },
      exportConfig: github,
    });

    assert.strictEqual(result.success, false);
    if (result.success) return;
    assert.ok(
      result.error instanceof ExportError,
      "export failures must be ExportError so routes can read the typed code",
    );
    assert.strictEqual(
      (result.error as ExportError).code,
      "workflow-scope-missing",
    );
  });

  it("leaves the code undefined on an untyped exporter failure", async () => {
    githubExporter.setFailure("Some raw GitHub error");
    const useCase = makeUseCase(generator, githubExporter);
    const result = await useCase.execute({
      manifest: { system: "test-system" },
      exportConfig: github,
    });

    assert.strictEqual(result.success, false);
    if (result.success) return;
    assert.ok(result.error instanceof ExportError);
    assert.strictEqual((result.error as ExportError).code, undefined);
  });
});
