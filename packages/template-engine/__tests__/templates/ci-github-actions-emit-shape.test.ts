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

const WORKFLOWS = ".github/workflows";

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
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-ci-test-"));
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
    templateIds: ["ci-github-actions"],
    projectRoot,
    ...(answers ? { overrideAnswers: { "ci-github-actions": answers } } : {}),
  });
  return { warnings: result.warnings };
}

async function read(projectRoot: string, rel: string): Promise<string> {
  return fs.readFile(path.join(projectRoot, rel), "utf-8");
}

async function exists(projectRoot: string, rel: string): Promise<boolean> {
  try {
    await fs.access(path.join(projectRoot, rel));
    return true;
  } catch {
    return false;
  }
}

describe("ci-github-actions template — emit shape", () => {
  describe("defaults (deploy_target=vercel, preview=true, node=22)", () => {
    let projectRoot: string;
    let warnings: string[];

    before(async () => {
      projectRoot = await freshProject();
      ({ warnings } = await install(projectRoot));
    });

    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the always-on files plus the Vercel deploy + preview workflows", async () => {
      for (const rel of [
        `${WORKFLOWS}/ci.yml`,
        ".github/dependabot.yml",
        `${WORKFLOWS}/deploy-vercel.yml`,
        `${WORKFLOWS}/preview.yml`,
      ]) {
        assert.ok(await exists(projectRoot, rel), `expected ${rel}`);
      }
    });

    it("does NOT emit the other deploy targets", async () => {
      for (const rel of [
        `${WORKFLOWS}/deploy-railway.yml`,
        `${WORKFLOWS}/deploy-fly.yml`,
        `${WORKFLOWS}/deploy-vps.yml`,
        "fly.toml",
      ]) {
        assert.equal(
          await exists(projectRoot, rel),
          false,
          `unexpected ${rel}`,
        );
      }
    });

    it("leaves no unresolved template variables", () => {
      assert.deepEqual(
        warnings.filter((w) => w.includes("Unresolved template variable")),
        [],
      );
    });

    it("interpolates node version, package manager, and recorded choices", async () => {
      const ci = await read(projectRoot, `${WORKFLOWS}/ci.yml`);
      // Quoted so the templated scalar is valid YAML before interpolation too.
      assert.ok(ci.includes('node-version: "22"'));
      // First-run-green (Item 2): corepack present, install is NOT immutable
      // (no committed lockfile yet), and no setup-node lockfile-cache.
      assert.ok(ci.includes("corepack enable"));
      assert.ok(ci.includes("corepack prepare yarn@4.12.0 --activate"));
      assert.ok(ci.includes('run: "yarn install"'));
      // Precise to the executable directive — explanatory comments may still
      // mention these forms without tripping the negative assertions.
      assert.ok(!ci.includes('run: "yarn install --immutable"'));
      assert.ok(!ci.includes('cache: "yarn"'));
      assert.ok(!ci.includes("{node_version}"));
      assert.ok(!ci.includes("{package_manager}"));
      // multiselect + select answers recorded in the config summary comment
      assert.ok(ci.includes("push-all-branches,pull-request"));
      assert.ok(ci.includes("turbo-cache"));
    });

    it("preserves GitHub Actions ${{ }} expressions through interpolation", async () => {
      const ci = await read(projectRoot, `${WORKFLOWS}/ci.yml`);
      assert.ok(ci.includes("${{ secrets.TURBO_TOKEN }}"));
      assert.ok(ci.includes("${{ runner.os }}-turbo-${{ github.sha }}"));
      // none mangled to single-brace ${ ... }
      assert.ok(
        !/\$\{ [a-z]/.test(ci),
        "no GHA expression should be collapsed to single braces",
      );
    });
  });

  describe("deploy_target=railway", () => {
    let projectRoot: string;
    before(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { deploy_target: "railway" });
    });
    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits only the Railway deploy workflow, with a SHA-pinned action", async () => {
      assert.ok(await exists(projectRoot, `${WORKFLOWS}/deploy-railway.yml`));
      assert.equal(
        await exists(projectRoot, `${WORKFLOWS}/deploy-vercel.yml`),
        false,
      );
      const wf = await read(projectRoot, `${WORKFLOWS}/deploy-railway.yml`);
      assert.ok(!wf.includes("railway-deploy@main"), "no floating @main ref");
      assert.ok(
        /railway-deploy@[0-9a-f]{40}/.test(wf),
        "pinned to a commit SHA",
      );
    });
  });

  describe("deploy_target=fly-io", () => {
    let projectRoot: string;
    before(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { deploy_target: "fly-io" });
    });
    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the Fly deploy workflow and fly.toml, with a SHA-pinned action", async () => {
      assert.ok(await exists(projectRoot, `${WORKFLOWS}/deploy-fly.yml`));
      assert.ok(await exists(projectRoot, "fly.toml"));
      assert.equal(
        await exists(projectRoot, `${WORKFLOWS}/deploy-vercel.yml`),
        false,
      );
      const wf = await read(projectRoot, `${WORKFLOWS}/deploy-fly.yml`);
      assert.ok(!wf.includes("setup-flyctl@master"), "no floating @master ref");
      assert.ok(/setup-flyctl@[0-9a-f]{40}/.test(wf), "pinned to a commit SHA");
    });
  });

  describe("deploy_target=vps-ssh", () => {
    let projectRoot: string;
    before(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { deploy_target: "vps-ssh" });
    });
    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the VPS deploy workflow with the interpolated package manager", async () => {
      assert.ok(await exists(projectRoot, `${WORKFLOWS}/deploy-vps.yml`));
      const vps = await read(projectRoot, `${WORKFLOWS}/deploy-vps.yml`);
      assert.ok(vps.includes("yarn install --immutable"));
      assert.ok(vps.includes("${{ secrets.VPS_SSH_KEY }}"));
    });
  });

  describe("deploy_target=none, preview_deploys=false", () => {
    let projectRoot: string;
    before(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, {
        deploy_target: "none",
        preview_deploys: false,
      });
    });
    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits only CI + Dependabot (no deploy or preview workflows)", async () => {
      assert.ok(await exists(projectRoot, `${WORKFLOWS}/ci.yml`));
      assert.ok(await exists(projectRoot, ".github/dependabot.yml"));
      for (const rel of [
        `${WORKFLOWS}/deploy-vercel.yml`,
        `${WORKFLOWS}/deploy-railway.yml`,
        `${WORKFLOWS}/deploy-fly.yml`,
        `${WORKFLOWS}/deploy-vps.yml`,
        `${WORKFLOWS}/preview.yml`,
        "fly.toml",
      ]) {
        assert.equal(
          await exists(projectRoot, rel),
          false,
          `unexpected ${rel}`,
        );
      }
    });
  });

  describe("node_version=20", () => {
    let projectRoot: string;
    before(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { node_version: "20" });
    });
    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("interpolates the chosen node version into ci.yml", async () => {
      const ci = await read(projectRoot, `${WORKFLOWS}/ci.yml`);
      assert.ok(ci.includes('node-version: "20"'));
      assert.ok(!ci.includes('node-version: "22"'));
    });
  });

  describe("preview workflow hardening", () => {
    let projectRoot: string;
    before(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { preview_deploys: true });
    });
    after(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("guards the preview job against fork PRs (no secrets)", async () => {
      const preview = await read(projectRoot, `${WORKFLOWS}/preview.yml`);
      assert.ok(
        preview.includes(
          "github.event.pull_request.head.repo.full_name == github.repository",
        ),
        "preview job should skip on forked PRs where secrets are unavailable",
      );
    });

    it("declares least-privilege permissions for the PR comment step", async () => {
      const preview = await read(projectRoot, `${WORKFLOWS}/preview.yml`);
      assert.ok(preview.includes("permissions:"));
      assert.ok(
        preview.includes("pull-requests: write"),
        "commenting on the PR requires pull-requests: write under a read-only default token",
      );
    });
  });
});
