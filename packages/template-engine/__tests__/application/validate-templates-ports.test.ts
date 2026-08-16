/**
 * ValidateTemplatesUseCase driven entirely through doubles — no `node:fs`, no
 * `process.env`, no temp directory. This is the suite that proves HEX-014: the
 * use case's filesystem and environment access now goes through injected
 * ports.
 *
 * Every assertion here is written to fail against a degenerate port
 * implementation, not merely against a broken one. See the
 * "stub-port attack" describe block at the bottom, which pins that claim by
 * running the same scenario against always-false / always-true / always-unset
 * stubs and asserting each one produces a *different* (wrong) answer.
 */
import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import { ValidateTemplatesUseCase } from "../../src/application/use-cases/validate-templates.use-case.js";
import type { TemplateRegistryPort } from "../../src/application/ports/template-registry.port.js";
import type { TemplateConfigStorePort } from "../../src/application/ports/template-config-store.port.js";
import type { ProjectFilePresencePort } from "../../src/application/ports/project-file-presence.port.js";
import type { EnvironmentReaderPort } from "../../src/application/ports/environment-reader.port.js";
import type {
  TemplateManifest,
  TemplateConfig,
} from "../../src/domain/index.js";

const PROJECT_ROOT = "/workspace/project";

function makeManifest(
  id: string,
  outputs: TemplateManifest["outputs"],
  envVars: string[] = [],
): TemplateManifest {
  return {
    id,
    name: id,
    description: "",
    version: "1.0.0",
    requires: [],
    conflicts: [],
    questions: [],
    envVars,
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

function stubConfigStore(config: TemplateConfig): TemplateConfigStorePort {
  return {
    load: async () => config,
    save: async () => {
      throw new Error("validation must not write config");
    },
  };
}

function installed(
  id: string,
  answers: Record<string, unknown> = {},
): TemplateConfig {
  return {
    schemaVersion: "1",
    templates: {
      [id]: {
        installedAt: "2026-01-01T00:00:00.000Z",
        version: "1.0.0",
        answers: answers as TemplateConfig["templates"][string]["answers"],
        generatedFiles: [],
      },
    },
  };
}

/**
 * An in-memory implementation of the presence port: a plain set of
 * project-root-relative paths. Its existence is the mirror test made
 * executable — this satisfies the port with no filesystem of any kind.
 */
class InMemoryPresence implements ProjectFilePresencePort {
  readonly probes: Array<{ projectRoot: string; relativePath: string }> = [];

  constructor(private readonly present: Set<string>) {}

  async exists(projectRoot: string, relativePath: string): Promise<boolean> {
    this.probes.push({ projectRoot, relativePath });
    return this.present.has(relativePath);
  }
}

class RecordEnvironment implements EnvironmentReaderPort {
  readonly reads: string[] = [];

  constructor(private readonly vars: Record<string, string | undefined>) {}

  get(name: string): string | undefined {
    this.reads.push(name);
    return this.vars[name];
  }
}

describe("ValidateTemplatesUseCase — driven through ports", () => {
  it("reports nothing missing when every declared output is present", async () => {
    const manifest = makeManifest("tpl", ["src/a.ts", "docs/b.md"]);
    const presence = new InMemoryPresence(new Set(["src/a.ts", "docs/b.md"]));

    const output = await new ValidateTemplatesUseCase(
      stubRegistry([manifest]),
      stubConfigStore(installed("tpl")),
      presence,
      new RecordEnvironment({}),
    ).execute(PROJECT_ROOT);

    assert.deepEqual(output.results, [
      {
        templateId: "tpl",
        missingFiles: [],
        missingEnvVars: [],
        conflictFiles: [],
        passed: true,
      },
    ]);
    assert.equal(output.totalErrors, 0);
    assert.equal(output.totalWarnings, 0);
  });

  it("names exactly the absent outputs, in declaration order", async () => {
    const manifest = makeManifest("tpl", [
      "src/a.ts",
      "docs/b.md",
      "Dockerfile",
    ]);
    const presence = new InMemoryPresence(new Set(["docs/b.md"]));

    const output = await new ValidateTemplatesUseCase(
      stubRegistry([manifest]),
      stubConfigStore(installed("tpl")),
      presence,
      new RecordEnvironment({}),
    ).execute(PROJECT_ROOT);

    assert.deepEqual(output.results[0].missingFiles, [
      "src/a.ts",
      "Dockerfile",
    ]);
    assert.equal(output.results[0].passed, false);
    assert.equal(output.totalErrors, 2);
  });

  it("probes the conflict copy under the extension-preserving name and reports it relative to the project root", async () => {
    // `.hexagen-update` is inserted before the extension, so the conflict copy
    // of `src/a.ts` is `src/a.hexagen-update.ts` — not `src/a.ts.hexagen-update`.
    const manifest = makeManifest("tpl", ["src/a.ts", "Dockerfile"]);
    const presence = new InMemoryPresence(
      new Set([
        "src/a.ts",
        "Dockerfile",
        "src/a.hexagen-update.ts",
        "Dockerfile.hexagen-update",
      ]),
    );

    const output = await new ValidateTemplatesUseCase(
      stubRegistry([manifest]),
      stubConfigStore(installed("tpl")),
      presence,
      new RecordEnvironment({}),
    ).execute(PROJECT_ROOT);

    assert.deepEqual(output.results[0].conflictFiles, [
      "src/a.hexagen-update.ts",
      "Dockerfile.hexagen-update",
    ]);
    assert.deepEqual(output.results[0].missingFiles, []);
    assert.equal(output.results[0].passed, false);
    assert.equal(output.totalErrors, 2);

    // Both the output and its conflict copy are probed, and every probe
    // carries the project root it was asked about.
    assert.deepEqual(
      presence.probes.map((p) => p.relativePath),
      [
        "src/a.ts",
        "Dockerfile",
        "src/a.hexagen-update.ts",
        "Dockerfile.hexagen-update",
      ],
    );
    assert.equal(
      presence.probes.every((p) => p.projectRoot === PROJECT_ROOT),
      true,
    );
  });

  it("never probes a gated-off output — neither for presence nor for conflicts", async () => {
    const manifest = makeManifest("gated", [
      { path: "drizzle/client.ts", when: { answer: "orm", equals: true } },
      "always.ts",
    ]);
    const presence = new InMemoryPresence(new Set(["always.ts"]));

    const output = await new ValidateTemplatesUseCase(
      stubRegistry([manifest]),
      stubConfigStore(installed("gated", { orm: false })),
      presence,
      new RecordEnvironment({}),
    ).execute(PROJECT_ROOT);

    assert.deepEqual(output.results[0].missingFiles, []);
    assert.deepEqual(output.results[0].conflictFiles, []);
    assert.equal(output.results[0].passed, true);
    assert.deepEqual(
      presence.probes.map((p) => p.relativePath),
      ["always.ts", "always.hexagen-update.ts"],
    );
  });

  it("reads env vars through the port and warns only on unset ones", async () => {
    const manifest = makeManifest("tpl", [], ["SET_VAR", "UNSET_VAR"]);
    const env = new RecordEnvironment({ SET_VAR: "value" });

    const output = await new ValidateTemplatesUseCase(
      stubRegistry([manifest]),
      stubConfigStore(installed("tpl")),
      new InMemoryPresence(new Set()),
      env,
    ).execute(PROJECT_ROOT);

    assert.deepEqual(output.results[0].missingEnvVars, ["UNSET_VAR"]);
    assert.equal(output.totalWarnings, 1);
    // A missing env var is a warning, never an error, so `passed` stays true.
    assert.equal(output.results[0].passed, true);
    assert.equal(output.totalErrors, 0);
    assert.deepEqual(env.reads, ["SET_VAR", "UNSET_VAR"]);
  });

  it("treats an empty-string env var as set (only `undefined` is missing)", async () => {
    const manifest = makeManifest("tpl", [], ["EMPTY_VAR"]);

    const output = await new ValidateTemplatesUseCase(
      stubRegistry([manifest]),
      stubConfigStore(installed("tpl")),
      new InMemoryPresence(new Set()),
      new RecordEnvironment({ EMPTY_VAR: "" }),
    ).execute(PROJECT_ROOT);

    assert.deepEqual(output.results[0].missingEnvVars, []);
    assert.equal(output.totalWarnings, 0);
  });

  it("does not touch the filesystem port when no templates are installed", async () => {
    const presence = new InMemoryPresence(new Set());
    const env = new RecordEnvironment({});

    const output = await new ValidateTemplatesUseCase(
      stubRegistry([makeManifest("tpl", ["src/a.ts"])]),
      stubConfigStore({ schemaVersion: "1", templates: {} }),
      presence,
      env,
    ).execute(PROJECT_ROOT);

    assert.deepEqual(output, {
      results: [],
      totalWarnings: 0,
      totalErrors: 0,
    });
    assert.deepEqual(presence.probes, []);
    assert.deepEqual(env.reads, []);
  });

  it("flags an installed template that the registry does not know, without probing", async () => {
    const presence = new InMemoryPresence(new Set());

    const output = await new ValidateTemplatesUseCase(
      stubRegistry([]),
      stubConfigStore(installed("ghost")),
      presence,
      new RecordEnvironment({}),
    ).execute(PROJECT_ROOT);

    assert.deepEqual(output.results[0].conflictFiles, [
      "Template 'ghost' is installed but not found in registry",
    ]);
    assert.equal(output.results[0].passed, false);
    assert.equal(output.totalErrors, 1);
    assert.deepEqual(presence.probes, []);
  });

  it("coerces a corrupt answers map instead of throwing, leaving gates unfired", async () => {
    const manifest = makeManifest("tpl", [
      { path: "gated.ts", when: { answer: "orm", equals: true } },
    ]);
    const config = installed("tpl");
    // Simulate a hand-edited config where `answers` is not an object.
    (config.templates.tpl as { answers: unknown }).answers = null;

    const output = await new ValidateTemplatesUseCase(
      stubRegistry([manifest]),
      stubConfigStore(config),
      new InMemoryPresence(new Set()),
      new RecordEnvironment({}),
    ).execute(PROJECT_ROOT);

    assert.deepEqual(output.results[0].missingFiles, []);
    assert.equal(output.results[0].passed, true);
  });
});

/**
 * Adversarial arm: the assertions above must not survive a port that answers
 * degenerately. Each stub below is a plausible "port wired up but doing
 * nothing useful" implementation; every one of them must produce an answer the
 * suite above rejects.
 */
describe("ValidateTemplatesUseCase — stub-port attack", () => {
  const manifest = makeManifest("tpl", ["src/a.ts"], ["SET_VAR"]);

  async function runWith(
    presence: ProjectFilePresencePort,
    env: EnvironmentReaderPort,
  ) {
    return new ValidateTemplatesUseCase(
      stubRegistry([manifest]),
      stubConfigStore(installed("tpl")),
      presence,
      env,
    ).execute(PROJECT_ROOT);
  }

  it("an always-false presence port cannot produce the happy-path answer", async () => {
    const output = await runWith(
      { exists: async () => false },
      new RecordEnvironment({ SET_VAR: "v" }),
    );
    assert.deepEqual(output.results[0].missingFiles, ["src/a.ts"]);
    assert.equal(output.results[0].passed, false);
  });

  it("an always-true presence port cannot produce the no-conflict answer", async () => {
    const output = await runWith(
      { exists: async () => true },
      new RecordEnvironment({ SET_VAR: "v" }),
    );
    assert.deepEqual(output.results[0].conflictFiles, [
      "src/a.hexagen-update.ts",
    ]);
    assert.equal(output.results[0].passed, false);
  });

  it("an always-unset environment port cannot produce the no-warning answer", async () => {
    const output = await runWith(new InMemoryPresence(new Set(["src/a.ts"])), {
      get: () => undefined,
    });
    assert.deepEqual(output.results[0].missingEnvVars, ["SET_VAR"]);
    assert.equal(output.totalWarnings, 1);
  });

  it("an environment port that reports everything set cannot produce the warning answer", async () => {
    const output = await runWith(new InMemoryPresence(new Set(["src/a.ts"])), {
      get: () => "always",
    });
    assert.deepEqual(output.results[0].missingEnvVars, []);
    assert.equal(output.totalWarnings, 0);
  });
});

describe("ValidateTemplatesUseCase — application layer stays builtin-free", () => {
  it("imports no node: builtin", async () => {
    // Read through the port-free surface the linter also checks: the source
    // text. `node-builtin-in-layer` in .architecture/arch-lint-baseline.json
    // carried two entries for this file (node:fs/promises, node:path); this
    // test is the in-suite twin of their removal.
    const { readFile } = await import("node:fs/promises");
    const url = new URL(
      "../../src/application/use-cases/validate-templates.use-case.ts",
      import.meta.url,
    );
    const source = await readFile(url, "utf-8");
    const builtinImports = [
      ...source.matchAll(/from\s+["'](node:[^"']+)["']/g),
    ].map((m) => m[1]);
    expect(builtinImports).toEqual([]);
  });
});
