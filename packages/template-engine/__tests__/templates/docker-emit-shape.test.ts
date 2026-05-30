import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
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

const ALL_OUTPUTS = [
  "Dockerfile",
  ".dockerignore",
  "docker-compose.yml",
  "docker-compose.override.yml",
  "docker-compose.ci.yml",
  ".github/workflows/docker-build.yml",
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
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-docker-test-"));
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
    templateIds: ["docker"],
    projectRoot,
    ...(answers ? { overrideAnswers: { docker: answers } } : {}),
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

describe("docker template — emit shape", () => {
  describe("defaults (node_version=22, services=[], registry=ghcr)", () => {
    let projectRoot: string;
    let warnings: string[];

    before(async () => {
      projectRoot = await freshProject();
      ({ warnings } = await install(projectRoot));
    });

    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits all six always-on outputs", async () => {
      for (const p of ALL_OUTPUTS) {
        assert.ok(
          await exists(path.join(projectRoot, p)),
          `expected ${p} to be emitted`,
        );
      }
    });

    it("leaves no unresolved template variables", () => {
      assert.deepEqual(
        warnings.filter((w) => w.includes("Unresolved template variable")),
        [],
      );
    });

    it("interpolates node_version into both Dockerfile build stages", async () => {
      const dockerfile = await read(projectRoot, "Dockerfile");
      const matches = dockerfile.match(/FROM node:22-alpine/g) ?? [];
      assert.equal(matches.length, 2, "base + runner should pin node:22");
      assert.ok(
        !dockerfile.includes("{node_version}"),
        "node_version placeholder must be substituted",
      );
    });

    it("documents an empty COMPOSE_PROFILES default when no services selected", async () => {
      const compose = await read(projectRoot, "docker-compose.yml");
      assert.ok(compose.includes("COMPOSE_PROFILES="));
      assert.ok(!compose.includes("{services}"));
    });

    it("lowercases the image name in the CI workflow (GHCR requires lowercase)", async () => {
      const workflow = await read(
        projectRoot,
        ".github/workflows/docker-build.yml",
      );
      assert.ok(
        workflow.includes("${IMAGE_NAME,,}"),
        "workflow must lowercase github.repository before pushing",
      );
    });
  });

  describe("non-default answers (node_version=20, services=[redis,postgres])", () => {
    let projectRoot: string;

    before(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, {
        node_version: "20",
        services: ["redis", "postgres"],
        registry: "ghcr",
        health_check: true,
      });
    });

    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("pins the chosen node version", async () => {
      const dockerfile = await read(projectRoot, "Dockerfile");
      assert.ok(dockerfile.includes("FROM node:20-alpine"));
      assert.ok(!dockerfile.includes("node:22-alpine"));
    });

    it("interpolates selected services into the COMPOSE_PROFILES hint", async () => {
      const compose = await read(projectRoot, "docker-compose.yml");
      assert.ok(
        compose.includes("COMPOSE_PROFILES=redis,postgres"),
        "multiselect array should render comma-joined",
      );
    });

    it("ships every optional service behind its own profile", async () => {
      const compose = await read(projectRoot, "docker-compose.yml");
      for (const svc of ["redis", "postgres", "mailhog", "minio"]) {
        assert.ok(
          compose.includes(`profiles: ["${svc}"]`),
          `expected a profile gate for ${svc}`,
        );
      }
    });
  });
});
