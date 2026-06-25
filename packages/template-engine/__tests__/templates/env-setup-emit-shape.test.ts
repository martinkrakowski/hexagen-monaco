import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Resolve the tsx CLI from the repo so the emitted check-env.ts can be run as a
// subprocess from a temp dir that has no node_modules of its own.
const requireFromHere = createRequire(import.meta.url);
const tsxPkgJson = requireFromHere.resolve("tsx/package.json");
const tsxBin = JSON.parse(readFileSync(tsxPkgJson, "utf8")).bin as
  | string
  | { tsx: string };
const TSX_CLI = path.join(
  path.dirname(tsxPkgJson),
  typeof tsxBin === "string" ? tsxBin : tsxBin.tsx,
);
import { AddTemplateUseCase } from "../../src/application/use-cases/add-template.use-case.js";
import { FileSystemFileEmitter } from "../../src/infrastructure/file-emitter.adapter.js";
import { FileSystemTemplateConfigStore } from "../../src/infrastructure/template-config-store.adapter.js";
import { FileSystemTemplateRegistry } from "../../src/infrastructure/template-registry.adapter.js";
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

const OUTPUTS = [
  ".env.example",
  ".gitignore.hexagen",
  "src/config/env.ts",
  "src/config/env.server.ts",
  "src/config/env.client.ts",
  "scripts/check-env.ts",
  "SETUP.md",
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

async function freshProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-env-test-"));
}

async function install(
  projectRoot: string,
  answers?: AnswerMap,
): Promise<{ warnings: string[] }> {
  const useCase = new AddTemplateUseCase(
    new FileSystemTemplateRegistry(TEMPLATES_DIR),
    defaultsQuestionEngine(),
    new FileSystemFileEmitter(TEMPLATES_DIR),
    new FileSystemTemplateConfigStore(),
  );
  const result = await useCase.execute({
    templateIds: ["env-setup"],
    projectRoot,
    ...(answers ? { overrideAnswers: { "env-setup": answers } } : {}),
  });
  return { warnings: result.warnings };
}

async function read(projectRoot: string, rel: string): Promise<string> {
  return fs.readFile(path.join(projectRoot, rel), "utf-8");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("env-setup template — emit shape", () => {
  describe("defaults (framework=next.js, strict_validation=true)", () => {
    let projectRoot: string;
    let warnings: string[];

    beforeAll(async () => {
      projectRoot = await freshProject();
      ({ warnings } = await install(projectRoot));
    });

    afterAll(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits all outputs", async () => {
      for (const p of OUTPUTS) {
        assert.ok(await exists(path.join(projectRoot, p)), `expected ${p}`);
      }
    });

    it("ships a git-ignore sidecar that ignores secrets but keeps *.example", async () => {
      const sidecar = await read(projectRoot, ".gitignore.hexagen");
      assert.ok(sidecar.includes(".env.*"));
      assert.ok(sidecar.includes("!.env.example"));
      assert.ok(sidecar.includes("!.env.*.example"));
      // Leads with a blank line so `cat >> .gitignore` can't merge onto the
      // last line of a target file that has no trailing newline.
      assert.ok(sidecar.startsWith("\n"));
    });

    it("leaves no unresolved template variables (guards ts/md brace collisions)", () => {
      assert.deepEqual(
        warnings.filter((w) => w.includes("Unresolved template variable")),
        [],
      );
    });

    it("compiles strict_validation=true into a strict server guard", async () => {
      const serverEnv = await read(projectRoot, "src/config/env.server.ts");
      assert.ok(serverEnv.includes('"true" === "true"'));
      assert.ok(!serverEnv.includes("{strict_validation}"));
    });

    it("interpolates the framework into SETUP.md and the env barrel", async () => {
      const setup = await read(projectRoot, "SETUP.md");
      const barrel = await read(projectRoot, "src/config/env.ts");
      assert.ok(setup.includes("Framework: **next.js**"));
      assert.ok(barrel.includes("Framework: next.js"));
      assert.ok(!setup.includes("{framework}"));
    });

    it("non-strict fallback uses pure defaults that cannot throw", async () => {
      const serverEnv = await read(projectRoot, "src/config/env.server.ts");
      assert.ok(serverEnv.includes("ServerEnvSchema.parse({})"));
      assert.ok(
        !serverEnv.includes("parse({ NODE_ENV: process.env.NODE_ENV })"),
        "fallback must not re-parse a possibly-invalid NODE_ENV",
      );
    });

    it("check-env scans per-template .env.*.example files, not just .env.example", async () => {
      const checkEnv = await read(projectRoot, "scripts/check-env.ts");
      assert.ok(checkEnv.includes("readdirSync"));
      assert.ok(checkEnv.includes('endsWith(".example")'));
    });

    it("env barrel re-exports types only (no runtime server import into client bundles)", async () => {
      const barrel = await read(projectRoot, "src/config/env.ts");
      assert.ok(
        barrel.includes('export type { ServerEnv } from "./env.server"'),
      );
      assert.ok(
        barrel.includes('export type { ClientEnv } from "./env.client"'),
      );
      // A non-type runtime re-export would pull env.server into client bundles.
      assert.ok(!/export\s*\{\s*serverEnv/.test(barrel));
    });
  });

  describe("strict_validation=false, framework=express", () => {
    let projectRoot: string;

    beforeAll(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, {
        framework: "express",
        strict_validation: false,
      });
    });

    afterAll(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("compiles strict_validation=false into a non-strict guard", async () => {
      const serverEnv = await read(projectRoot, "src/config/env.server.ts");
      assert.ok(serverEnv.includes('"false" === "true"'));
    });

    it("interpolates the chosen framework", async () => {
      const setup = await read(projectRoot, "SETUP.md");
      assert.ok(setup.includes("Framework: **express**"));
    });
  });

  describe("dotenv_tool gates the load-env loader", () => {
    async function installWith(tool: string): Promise<string> {
      const projectRoot = await freshProject();
      await install(projectRoot, { dotenv_tool: tool });
      return projectRoot;
    }

    it("does NOT emit load-env.ts for next.js-built-in (the default)", async () => {
      const projectRoot = await installWith("next.js-built-in");
      try {
        assert.equal(
          await exists(path.join(projectRoot, "src/config/load-env.ts")),
          false,
        );
      } finally {
        await fs.rm(projectRoot, { recursive: true, force: true });
      }
    });

    it("emits load-env.ts for dotenv (expansion branch stays inert)", async () => {
      const projectRoot = await installWith("dotenv");
      try {
        const loader = await read(projectRoot, "src/config/load-env.ts");
        assert.ok(loader.includes('"dotenv" === "dotenv-expand"'));
        assert.ok(loader.includes('from "dotenv"'));
        assert.ok(!loader.includes("{dotenv_tool}"));
      } finally {
        await fs.rm(projectRoot, { recursive: true, force: true });
      }
    });

    it("emits load-env.ts for dotenv-expand (expansion branch active)", async () => {
      const projectRoot = await installWith("dotenv-expand");
      try {
        const loader = await read(projectRoot, "src/config/load-env.ts");
        assert.ok(loader.includes('"dotenv-expand" === "dotenv-expand"'));
        // Indirected specifier — no static import("dotenv-expand") that would
        // need a ts-ignore / break typecheck when the dep isn't installed.
        assert.ok(loader.includes("const moduleName"));
        assert.ok(!loader.includes('import("dotenv-expand")'));
        // Awaited (not fire-and-forget) so expansion completes before the module
        // finishes loading — no race against later process.env reads.
        assert.ok(loader.includes("await import(moduleName)"));
        assert.ok(!loader.includes("void import("));
        // Only a missing-module error is tolerated; everything else rethrows.
        assert.ok(loader.includes("ERR_MODULE_NOT_FOUND"));
        assert.ok(loader.includes("throw err"));
      } finally {
        await fs.rm(projectRoot, { recursive: true, force: true });
      }
    });
  });

  // Run the emitted check-env.ts as a real subprocess against crafted env files
  // to lock in: (a) requiredness comes from a `# required` annotation, not an
  // empty value; (b) inline comments are stripped; (c) all .env.*.example files
  // are scanned.
  describe("check-env.ts behaviour", () => {
    let projectRoot: string;

    function runCheckEnv(): { code: number; out: string } {
      try {
        const out = execFileSync(
          process.execPath,
          [TSX_CLI, "scripts/check-env.ts"],
          {
            cwd: projectRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        return { code: 0, out };
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        return {
          code: e.status ?? 1,
          out: (e.stdout ?? "") + (e.stderr ?? ""),
        };
      }
    }

    beforeAll(async () => {
      projectRoot = await freshProject();
      await install(projectRoot);
      // A per-template example file: one annotated-required key (with an inline
      // comment), one intentionally-empty optional placeholder.
      await fs.writeFile(
        path.join(projectRoot, ".env.svc.example"),
        "SVC_TOKEN=          # required — get it from the dashboard\nSVC_OPTIONAL=\n",
        "utf8",
      );
    });

    afterAll(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("fails when an annotated-required var is missing, ignoring optional empties", () => {
      const { code, out } = runCheckEnv();
      assert.equal(code, 1);
      assert.ok(out.includes("SVC_TOKEN"), "should report the required var");
      assert.ok(
        !out.includes("SVC_OPTIONAL"),
        "must not force an unannotated empty placeholder",
      );
    });

    it("passes once the required var is set in .env.local", async () => {
      await fs.writeFile(
        path.join(projectRoot, ".env.local"),
        "SVC_TOKEN=abc123\n",
        "utf8",
      );
      const { code, out } = runCheckEnv();
      assert.equal(code, 0, out);
      assert.ok(out.includes("All required env vars are set."));
    });
  });
});
