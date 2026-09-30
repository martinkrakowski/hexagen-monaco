import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { AddTemplateUseCase } from "../../src/application/use-cases/add-template.use-case.js";
import { ValidateTemplatesUseCase } from "../../src/application/use-cases/validate-templates.use-case.js";
import { FileSystemFileEmitter } from "../../src/infrastructure/file-emitter.adapter.js";
import { FileSystemTemplateConfigStore } from "../../src/infrastructure/template-config-store.adapter.js";
import { FileSystemTemplateRegistry } from "../../src/infrastructure/template-registry.adapter.js";
import { FileSystemProjectFilePresence } from "../../src/infrastructure/project-file-presence.adapter.js";
import { ProcessEnvironmentReader } from "../../src/infrastructure/environment-reader.adapter.js";
import type {
  TemplateQuestion,
  QuestionAnswer,
  AnswerMap,
} from "../../src/domain/index.js";
import type { QuestionEnginePort } from "../../src/application/ports/question-engine.port.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);
const TEMPLATE_DIR = path.join(TEMPLATES_DIR, "orchestration");
const TEMPLATE_FILES = path.join(TEMPLATE_DIR, "files");

const SKILL_DIR = ".agents/skills/orchestrate-wave";
const GATE = ".github/workflows/gate.yml";

/**
 * The manifest's whole output set, ungated (OW-D4/F-9: the gate/verify-manifests
 * decision lives in the consumer's `config.yaml`, read at runtime by the gate
 * bin, so no output here is ever conditional). Written out rather than read
 * from the manifest on purpose — this list is the template's contract, and a
 * test that reads it from the manifest cannot notice the manifest changing.
 */
const EXPECTED_OUTPUTS = [
  GATE,
  `${SKILL_DIR}/SKILL.md`,
  `${SKILL_DIR}/references/rationale.md`,
  `${SKILL_DIR}/references/briefs.md`,
  `${SKILL_DIR}/scripts/wave-event.sh`,
];

/**
 * `.agents/orchestration/**` — the consumer-owned overlay. OW-D7 forbids it as
 * an output categorically, and the regression guard below is what holds that
 * line: the manifest is asserted not to name it AND two forced re-adds are
 * shown to leave a pre-scaffolded copy byte-identical.
 */
const OVERLAY_DIR = ".agents/orchestration";
const NEVER_OUTPUT = [
  `${OVERLAY_DIR}/config.yaml`,
  `${OVERLAY_DIR}/house-rules.md`,
  `${OVERLAY_DIR}/cast.md`,
  `${OVERLAY_DIR}/lessons.md`,
  `${OVERLAY_DIR}/rationale.local.md`,
  "AGENTS.md",
  ".github/workflows/ci.yml",
  ".agents/session-log.md",
];

function defaultsQuestionEngine(): QuestionEnginePort {
  return {
    ask: async (q: TemplateQuestion): Promise<QuestionAnswer> => {
      if (q.type === "auto") {
        throw new Error(
          `auto question ${q.id} should be resolved by the use case`,
        );
      }
      if (q.type === "boolean") return q.default ?? false;
      if (q.type === "multiselect") return q.default ?? [];
      if (q.type === "select") return q.default ?? q.options[0] ?? "";
      if (q.type === "text") return q.default ?? "";
      const _ex: never = q;
      throw new Error(`unhandled type: ${(_ex as { type: string }).type}`);
    },
  };
}

async function freshProject(
  prefix = "hexagen-orchestration-test-",
): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * `templatesDir` is a parameter because the regression guard's red case needs a
 * doctored copy of this very template, and a red case that cannot be built is
 * not a red case.
 */
async function install(
  projectRoot: string,
  options: {
    answers?: AnswerMap;
    templatesDir?: string;
    force?: boolean;
  } = {},
): Promise<{ warnings: string[]; templatesDir: string }> {
  const templatesDir = options.templatesDir ?? TEMPLATES_DIR;
  const useCase = new AddTemplateUseCase(
    new FileSystemTemplateRegistry(templatesDir),
    defaultsQuestionEngine(),
    new FileSystemFileEmitter(templatesDir),
    new FileSystemTemplateConfigStore(),
  );
  const result = await useCase.execute({
    templateIds: ["orchestration"],
    projectRoot,
    ...(options.answers
      ? { overrideAnswers: { orchestration: options.answers } }
      : {}),
    skipInstalled: !options.force,
  });
  return { warnings: result.warnings, templatesDir };
}

/** Recursive listing + per-file contents of a project-relative subtree. */
async function snapshotSubtree(
  projectRoot: string,
  relDir: string,
): Promise<{ listing: string; files: Map<string, string> }> {
  const root = path.join(projectRoot, relDir);
  const files = new Map<string, string>();
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
        continue;
      }
      files.set(rel, await fs.readFile(path.join(dir, entry.name), "utf8"));
    }
  };
  await walk(root, "");
  return { listing: [...files.keys()].join("\n"), files };
}

async function read(projectRoot: string, rel: string): Promise<string> {
  return fs.readFile(path.join(projectRoot, rel), "utf8");
}

async function exists(projectRoot: string, rel: string): Promise<boolean> {
  try {
    await fs.access(path.join(projectRoot, rel));
    return true;
  } catch {
    return false;
  }
}

/** Copy the template so a test can mutate its manifest without touching the repo. */
async function copyTemplateDir(): Promise<string> {
  const dir = await freshProject("hexagen-orchestration-templates-");
  const target = path.join(dir, "orchestration");
  await fs.cp(TEMPLATE_DIR, target, { recursive: true });
  return dir;
}

describe("orchestration template — emit shape", () => {
  let projectRoot: string;
  let warnings: string[];

  beforeAll(async () => {
    projectRoot = await freshProject();
    ({ warnings } = await install(projectRoot));
  });

  afterAll(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it("emits the five declared outputs and nothing else but the config record", async () => {
    const expected = [...EXPECTED_OUTPUTS, ".hexagen-template-config.json"];
    const actual: string[] = [];
    const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
        else actual.push(rel);
      }
    };
    await walk(projectRoot, "");
    assert.deepStrictEqual(actual.sort(), expected.sort());
  });

  it("the manifest declares exactly those five outputs, all ungated", async () => {
    const manifest = JSON.parse(
      await fs.readFile(path.join(TEMPLATE_DIR, "manifest.json"), "utf8"),
    ) as { outputs: unknown[]; requires: string[]; conflicts: string[] };
    assert.deepStrictEqual(manifest.outputs, EXPECTED_OUTPUTS);
    // OW-D5: `requires` is an auto-apply edge, not an assertion. Requiring
    // `ci-github-actions` would install it and write a first-ever `ci.yml` as a
    // conflict copy; the dependency is `doctor`'s job instead.
    assert.deepStrictEqual(manifest.requires, []);
    assert.deepStrictEqual(manifest.conflicts, []);
  });

  it("never declares an overlay path, AGENTS.md, ci.yml or a session log as an output", async () => {
    const text = await fs.readFile(
      path.join(TEMPLATE_DIR, "manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(text) as { outputs: unknown[] };
    const declared = manifest.outputs
      .map((o) => (typeof o === "string" ? o : (o as { path: string }).path))
      .join("\n");
    for (const rel of NEVER_OUTPUT) {
      assert.ok(
        !declared.includes(rel),
        `${rel} must not be a declared output`,
      );
    }
    // OW-D7 in its strongest form: nothing under the overlay's directory at all,
    // gated or not. A `when`-gated overlay output would still make the emitter
    // eligible to write the path on the answer that enables it.
    assert.ok(
      !declared.includes(`${OVERLAY_DIR}/`),
      "no output may live under .agents/orchestration/",
    );
    for (const rel of NEVER_OUTPUT) {
      assert.equal(
        await exists(projectRoot, rel),
        false,
        `unexpected ${rel} on disk`,
      );
    }
  });

  it("emits every skill file byte-identical to its template source", async () => {
    for (const rel of EXPECTED_OUTPUTS.filter((r) => r !== GATE)) {
      const source = await fs.readFile(path.join(TEMPLATE_FILES, rel), "utf8");
      const emitted = await fs.readFile(path.join(projectRoot, rel));
      assert.ok(
        Buffer.from(source, "utf8").equals(emitted),
        `${rel} is not byte-identical to its template source`,
      );
    }
  });

  it("leaves no unresolved template variable", () => {
    assert.deepStrictEqual(
      warnings.filter((w) => w.includes("Unresolved template variable")),
      [],
    );
  });

  it("keeps scripts/wave-event.sh executable", async () => {
    const mode = (
      await fs.stat(
        path.join(projectRoot, SKILL_DIR, "scripts", "wave-event.sh"),
      )
    ).mode;
    assert.equal(mode & 0o111, 0o111, "the emitted script lost its exec bits");
  });

  it("passes hexagen validate-templates with zero missing files", async () => {
    const useCase = new ValidateTemplatesUseCase(
      new FileSystemTemplateRegistry(TEMPLATES_DIR),
      new FileSystemTemplateConfigStore(),
      new FileSystemProjectFilePresence(),
      new ProcessEnvironmentReader(),
    );
    const result = await useCase.execute(projectRoot);
    const orchestration = result.results.find(
      (r) => r.templateId === "orchestration",
    );
    assert.ok(orchestration, "the install must be recorded");
    assert.deepStrictEqual(orchestration.missingFiles, []);
    assert.deepStrictEqual(orchestration.conflictFiles, []);
    assert.ok(orchestration.passed);
    assert.equal(result.totalErrors, 0);
  });

  describe("gate.yml — the workflow the emit-shape test is the only gate for", () => {
    let gate: string;

    beforeAll(async () => {
      gate = await read(projectRoot, GATE);
    });

    it("is named Gate, and triggers on push, PR to main, and dispatch", () => {
      assert.ok(gate.startsWith("name: Gate\n"));
      assert.match(gate, /^ {2}push:\n {4}branches: \["\*\*"\]/m);
      assert.match(gate, /^ {2}pull_request:\n {4}branches: \[main\]/m);
      assert.match(gate, /^ {2}workflow_dispatch:/m);
    });

    it("runs the gate bin exactly once, and nothing else", () => {
      const runs = gate
        .split("\n")
        .filter((l) => /^\s*run:/.test(l))
        .filter((l) => l.includes("hexagen-orchestration-gate"));
      assert.equal(
        runs.length,
        1,
        `expected exactly one gate invocation, got ${JSON.stringify(runs)}`,
      );
      // OW-D4: one source for the step list. The workflow must not restate any
      // project's build/typecheck/lint/test command.
      assert.ok(
        gate.includes("npx --no-install hexagen-orchestration-gate"),
        "the single step must invoke the packaged bin with --no-install",
      );
      for (const projectScript of [
        "yarn build",
        "yarn test",
        "yarn lint",
        "yarn gate",
      ]) {
        assert.ok(
          !gate.includes(projectScript),
          `gate.yml must not restate '${projectScript}' — config.yaml is the only step list`,
        );
      }
    });

    it("orders Corepack before setup-node and disables the v5 cache probe (F21)", () => {
      const corepackAt = gate.indexOf("corepack enable");
      const setupNodeAt = gate.indexOf("actions/setup-node@");
      assert.ok(corepackAt >= 0, "gate.yml must enable Corepack");
      assert.ok(setupNodeAt >= 0, "gate.yml must use setup-node");
      assert.ok(
        corepackAt < setupNodeAt,
        "corepack enable must come BEFORE setup-node (its cache probe runs global Yarn Classic and fails on a packageManager-pinned yarn@4 project)",
      );
      assert.ok(
        gate.includes('corepack prepare "$(node -p'),
        "gate.yml must prepare the package manager pinned in package.json",
      );
      // Line-anchored so the explanatory comments cannot satisfy the checks.
      const nonComment = gate
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("#"));
      assert.ok(
        nonComment.some((l) =>
          /^\s*package-manager-cache:\s*false\s*$/.test(l),
        ),
        "gate.yml must set package-manager-cache: false",
      );
      assert.ok(
        !nonComment.some((l) => /\bcache:\s*["']?yarn["']?/.test(l)),
        "gate.yml must not use setup-node's yarn cache in any quoting",
      );
      assert.ok(
        !gate.includes("actions/cache"),
        "gate.yml has no Turbo-cache equivalent, so it must not add actions/cache either",
      );
    });

    it("installs with --immutable and leaves the shell substitution intact", () => {
      assert.ok(
        /^\s*run:\s*["']?yarn install --immutable["']?\s*$/m.test(gate),
        "gate.yml installs immutably — it lands after `yarn add`, so a lockfile exists",
      );
      // `interpolate()` only rewrites a BARE `{identifier}`, so a `$(…)` shell
      // expansion and the single quotes around it must come through verbatim.
      // If it did not, the emitted workflow would activate Corepack from an empty
      // package manager and every run would fail at the install step.
      assert.ok(
        gate.includes(
          `corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate`,
        ),
        "the $(…) package-manager expansion must survive interpolation verbatim",
      );
    });
  });

  describe("node_version is an auto question, not a prompt", () => {
    it("resolves to the default 22 when no ci-github-actions record exists", async () => {
      const root = await freshProject();
      try {
        await install(root);
        const gate = await read(root, GATE);
        assert.ok(gate.includes('node-version: "22"'));
        assert.ok(!gate.includes("{node_version}"));
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("resolves to the value ci-github-actions recorded when one exists", async () => {
      const root = await freshProject();
      try {
        const useCase = new AddTemplateUseCase(
          new FileSystemTemplateRegistry(TEMPLATES_DIR),
          defaultsQuestionEngine(),
          new FileSystemFileEmitter(TEMPLATES_DIR),
          new FileSystemTemplateConfigStore(),
        );
        await useCase.execute({
          templateIds: ["ci-github-actions"],
          projectRoot: root,
          overrideAnswers: {
            "ci-github-actions": {
              node_version: "20",
              deploy_target: "none",
              preview_deploys: false,
              cache_strategy: "turbo-cache",
              ci_triggers: ["push-all-branches", "pull-request"],
              run_tests: true,
              docker_build: false,
            },
          },
        });
        await install(root);
        const gate = await read(root, GATE);
        assert.ok(
          gate.includes('node-version: "20"'),
          "the auto question must copy the recorded ci-github-actions answer",
        );
        assert.ok(!gate.includes('node-version: "22"'));
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("regression guard — the overlay is never touched by an add (OW-D7/OW-D13)", () => {
    let root: string;

    beforeAll(async () => {
      root = await freshProject("hexagen-orchestration-overlay-");
      // A pre-scaffolded overlay, of the shape `hexagen-orchestration-init`
      // writes: the engine must never see, hash, or rewrite any of it.
      await fs.mkdir(path.join(root, OVERLAY_DIR), { recursive: true });
      await fs.writeFile(
        path.join(root, OVERLAY_DIR, "config.yaml"),
        "repo: acme/widgets\nmutate: false\n",
      );
      await fs.writeFile(
        path.join(root, OVERLAY_DIR, "house-rules.md"),
        "# House rules\n\nWave Observability\n",
      );
      await fs.writeFile(
        path.join(root, OVERLAY_DIR, "lessons.md"),
        "source: ci-runners-have-no-zsh.md\n",
      );
      await fs.writeFile(
        path.join(root, OVERLAY_DIR, "rationale.local.md"),
        "# Local rationale\n\nAn edit a human made, and hexagen must keep.\n",
      );
    });

    afterAll(async () => {
      await fs.rm(root, { recursive: true, force: true });
    });

    it("leaves a pre-scaffolded .agents/orchestration/** byte-identical across two forced re-adds", async () => {
      const before = await snapshotSubtree(root, OVERLAY_DIR);
      assert.ok(
        before.listing.length > 0,
        "fixture error: the overlay is empty",
      );

      await install(root, { force: true });
      const afterFirst = await snapshotSubtree(root, OVERLAY_DIR);
      await install(root, { force: true });
      const afterSecond = await snapshotSubtree(root, OVERLAY_DIR);

      assert.equal(
        afterFirst.listing,
        before.listing,
        "the first `add --force` changed the overlay's file listing",
      );
      assert.equal(
        afterSecond.listing,
        before.listing,
        "the second `add --force` changed the overlay's file listing",
      );
      for (const [rel, text] of before.files) {
        assert.equal(
          afterFirst.files.get(rel),
          text,
          `${OVERLAY_DIR}/${rel} changed after the first forced add`,
        );
        assert.equal(
          afterSecond.files.get(rel),
          text,
          `${OVERLAY_DIR}/${rel} changed after the second forced add`,
        );
      }
      // Nothing new either — a conflict copy would show up in the listing, which
      // is how OW-D7's mistake manifests rather than as a silent overwrite.
      assert.ok(
        ![...afterSecond.files.keys()].some((f) =>
          f.includes("hexagen-update"),
        ),
        `an add wrote a conflict copy into the overlay: ${afterSecond.listing}`,
      );
    });
  });

  describe("the guard is not vacuous — a manifest that declared the overlay would be caught", () => {
    /**
     * The guard above is a regression guard (F-14): with the manifest as it
     * stands there is no organically-red state to observe, so nothing proves the
     * guard can fail. This builds the mistake OW-D7 forbids — a temp copy of the
     * template whose manifest declares `.agents/orchestration/config.yaml` as an
     * output and which carries a `files/` copy to emit from — and shows the
     * emitter really does reach into the overlay, so the guard's silence on the
     * real template means something. The temp directory is built in os.tmpdir()
     * and never committed.
     */
    it("writes a conflict copy into .agents/orchestration/ the moment the manifest names it", async () => {
      const doctored = await copyTemplateDir();
      const root = await freshProject("hexagen-orchestration-doctered-");
      try {
        const manifestPath = path.join(
          doctored,
          "orchestration",
          "manifest.json",
        );
        const manifest = JSON.parse(
          await fs.readFile(manifestPath, "utf8"),
        ) as {
          outputs: string[];
        };
        manifest.outputs.push(`${OVERLAY_DIR}/config.yaml`);
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

        const overlaySource = path.join(
          doctored,
          "orchestration",
          "files",
          OVERLAY_DIR,
        );
        await fs.mkdir(overlaySource, { recursive: true });
        await fs.writeFile(
          path.join(overlaySource, "config.yaml"),
          "repo: template/owned\n",
        );

        // Pre-scaffold with different content, so the emitter treats the overlay
        // copy as a human's edit and lands a conflict file beside it.
        await fs.mkdir(path.join(root, OVERLAY_DIR), { recursive: true });
        await fs.writeFile(
          path.join(root, OVERLAY_DIR, "config.yaml"),
          "repo: acme/widgets\nmutate: false\n",
        );
        const before = await snapshotSubtree(root, OVERLAY_DIR);

        await install(root, { templatesDir: doctored });

        const after = await snapshotSubtree(root, OVERLAY_DIR);
        assert.notEqual(
          after.listing,
          before.listing,
          "fixture error: declaring the overlay as an output changed nothing — the guard would be vacuous",
        );
        assert.ok(
          after.files.has("config.hexagen-update.yaml"),
          `expected the conflict copy, got ${JSON.stringify(after.listing)}`,
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
        await fs.rm(doctored, { recursive: true, force: true });
      }
    });
  });
});
