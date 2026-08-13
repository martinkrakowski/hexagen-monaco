import { describe, it, beforeAll, afterAll } from "vitest";
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

/**
 * F20 (day-one noise): a deploy workflow must be manual-only until its infra
 * is configured — `workflow_dispatch:` present, and NO active `push:` trigger
 * (top-level `on:` children sit at 2-space indent; commented-out triggers and
 * deeper-indented step inputs must not satisfy/violate the check).
 */
function assertDispatchOnly(workflow: string, label: string): void {
  const nonComment = workflow
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"));
  assert.ok(
    nonComment.some((l) => /^\s{2}workflow_dispatch:/.test(l)),
    `${label} must be workflow_dispatch-gated (F20 — no red runs on a fresh push)`,
  );
  assert.ok(
    !nonComment.some((l) => /^\s{2}push:/.test(l)),
    `${label} must NOT have an active push trigger before its secrets exist (F20)`,
  );
}

describe("ci-github-actions template — emit shape", () => {
  describe("defaults (deploy_target=vercel, preview=true, node=22)", () => {
    let projectRoot: string;
    let warnings: string[];

    beforeAll(async () => {
      projectRoot = await freshProject();
      ({ warnings } = await install(projectRoot));
    });

    afterAll(async () => {
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

    it("tames Dependabot so a fresh publish doesn't flood PRs (#6)", async () => {
      const db = await read(projectRoot, ".github/dependabot.yml");
      // Assert SEMANTICS, not an exact YAML rendering — block-style lists, quoting,
      // or spacing changes must not break this. Strip comment lines first so the
      // explanatory prose (which mentions "minor + patch", "MAJOR", etc.) can't
      // satisfy the value checks below.
      const cfg = db
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("#"))
        .join("\n");

      // Production deps must be grouped (previously ungrouped → one PR each); dev
      // deps stay grouped. Group keys are structural identifiers.
      assert.ok(
        /production-dependencies\s*:/.test(cfg),
        "npm production deps must be grouped, not one PR per dep",
      );
      assert.ok(/dev-dependencies\s*:/.test(cfg), "npm dev deps stay grouped");
      // update-types restricted to minor+patch so non-breaking bumps batch —
      // regardless of list style/quoting/order.
      assert.ok(
        /update-types\s*:/.test(cfg),
        "groups must declare update-types",
      );
      assert.ok(
        /\bminor\b/.test(cfg) && /\bpatch\b/.test(cfg),
        "update-types must batch minor + patch",
      );
      // MAJOR npm bumps are ignored outright for the first release cycle
      // (F20): a fresh repo is a major behind on several deps at once, and
      // each major opens its own PR. The ONLY non-comment mention of "major"
      // must be the ignore block's version-update:semver-major entry.
      assert.ok(
        /ignore\s*:/.test(cfg),
        "npm entry must declare an ignore block",
      );
      const majorLines = cfg.split("\n").filter((l) => /major/i.test(l));
      assert.ok(
        majorLines.length > 0 &&
          majorLines.every((l) => l.includes("version-update:semver-major")),
        "major must appear ONLY as the ignored version-update:semver-major update-type",
      );
      assert.ok(
        /open-pull-requests-limit\s*:\s*5/.test(cfg),
        "a modest open-pull-requests-limit caps the day-one PR flood",
      );
      // Action bumps grouped into one PR too (the github-actions ecosystem
      // declares a groups: block).
      assert.ok(
        /groups\s*:[\s\S]*github-actions\s*:/.test(cfg),
        "github-actions bumps must be grouped",
      );
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
      // First-run-green (Item 2): Corepack must activate the pinned yarn@4 BEFORE
      // any yarn invocation — assert ordering, not just presence.
      const corepackAt = ci.indexOf("corepack enable");
      // Quote-agnostic: match `run: yarn install` or `run: "yarn install"`,
      // anchored to end-of-line so it never matches the `--immutable` form.
      const installAt =
        ci.match(/^\s*run:\s*["']?yarn install["']?\s*$/m)?.index ?? -1;
      assert.ok(corepackAt >= 0, "ci.yml must enable Corepack");
      assert.ok(installAt >= 0, "ci.yml must install dependencies");
      assert.ok(
        corepackAt < installAt,
        "`corepack enable` must come before the `yarn install` step (else the pinned yarn@4 is not active yet)",
      );
      // Version is read from package.json at runtime (no baked yarn@x.y.z that
      // could drift from the project's `packageManager`).
      assert.ok(
        ci.includes('corepack prepare "$(node -p') &&
          ci.includes("packageManager"),
      );
      assert.ok(!ci.includes("corepack prepare yarn@"));
      // install is NOT immutable (no committed lockfile yet). Precise to the
      // executable directive — explanatory comments may still mention these forms.
      assert.ok(!ci.includes('run: "yarn install --immutable"'));
      // No setup-node yarn cache in ANY YAML form (quoted or unquoted); ignore
      // comment lines, which mention `cache: yarn` in prose to explain the hazard.
      const ciNonCommentLines = ci
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("#"));
      assert.ok(
        !ciNonCommentLines.some((l) => /\bcache:\s*["']?yarn["']?/.test(l)),
        "ci.yml must not use setup-node's yarn cache (it runs Yarn before Corepack — any quoting)",
      );
      assert.ok(!ci.includes("{node_version}"));
      assert.ok(!ci.includes("{package_manager}"));
      // multiselect + select answers recorded in the config summary comment
      assert.ok(ci.includes("push-all-branches,pull-request"));
      assert.ok(ci.includes("turbo-cache"));
    });

    it("orders Corepack before setup-node and disables the v5 cache probe in every node workflow (F21)", async () => {
      // setup-node@v5 probes the package-manager cache with the runner's
      // global Yarn Classic even WITHOUT `cache: yarn` — omitting the input is
      // not enough. Both halves of the fix are asserted: Corepack activated
      // first, and the probe disabled explicitly.
      for (const rel of [
        `${WORKFLOWS}/ci.yml`,
        `${WORKFLOWS}/preview.yml`,
        `${WORKFLOWS}/deploy-vercel.yml`,
      ]) {
        const wf = await read(projectRoot, rel);
        const corepackAt = wf.indexOf("corepack enable");
        const setupNodeAt = wf.indexOf("actions/setup-node@");
        assert.ok(corepackAt >= 0, `${rel} must enable Corepack`);
        assert.ok(setupNodeAt >= 0, `${rel} must use setup-node`);
        assert.ok(
          corepackAt < setupNodeAt,
          `${rel}: corepack enable must come BEFORE setup-node (its cache probe runs global Yarn Classic and fails on a packageManager-pinned yarn@4 project)`,
        );
        assert.ok(
          wf.includes('corepack prepare "$(node -p'),
          `${rel} must prepare the package manager pinned in package.json`,
        );
        // Line-anchored so the explanatory comments don't satisfy the checks.
        const nonComment = wf
          .split("\n")
          .filter((l) => !l.trimStart().startsWith("#"));
        assert.ok(
          nonComment.some((l) =>
            /^\s*package-manager-cache:\s*false\s*$/.test(l),
          ),
          `${rel} must set package-manager-cache: false (setup-node@v5 probes even without cache: yarn)`,
        );
        assert.ok(
          !nonComment.some((l) => /\bcache:\s*["']?yarn["']?/.test(l)),
          `${rel} must not use setup-node's yarn cache in any quoting`,
        );
      }
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

    it("gates the deploy workflow to workflow_dispatch until secrets exist (F20)", async () => {
      const wf = await read(projectRoot, `${WORKFLOWS}/deploy-vercel.yml`);
      assertDispatchOnly(wf, "deploy-vercel.yml");
      // ci.yml is unaffected — it still runs on push (its jobs need no secrets).
      const ci = await read(projectRoot, `${WORKFLOWS}/ci.yml`);
      const ciNonComment = ci
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("#"));
      assert.ok(
        ciNonComment.some((l) => /^\s{2}push:/.test(l)),
        "ci.yml must keep its push trigger — only DEPLOY workflows are dispatch-gated",
      );
    });
  });

  describe("deploy_target=railway", () => {
    let projectRoot: string;
    beforeAll(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { deploy_target: "railway" });
    });
    afterAll(async () => {
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
      assertDispatchOnly(wf, "deploy-railway.yml");
    });
  });

  describe("deploy_target=fly-io", () => {
    let projectRoot: string;
    beforeAll(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { deploy_target: "fly-io" });
    });
    afterAll(async () => {
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
      assertDispatchOnly(wf, "deploy-fly.yml");
    });
  });

  describe("deploy_target=vps-ssh", () => {
    let projectRoot: string;
    beforeAll(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { deploy_target: "vps-ssh" });
    });
    afterAll(async () => {
      await fs.rm(projectRoot, { recursive: true, force: true });
    });

    it("emits the VPS deploy workflow with the interpolated package manager", async () => {
      assert.ok(await exists(projectRoot, `${WORKFLOWS}/deploy-vps.yml`));
      const vps = await read(projectRoot, `${WORKFLOWS}/deploy-vps.yml`);
      assert.ok(vps.includes("yarn install --immutable"));
      assert.ok(vps.includes("${{ secrets.VPS_SSH_KEY }}"));
      assertDispatchOnly(vps, "deploy-vps.yml");
    });
  });

  describe("deploy_target=none, preview_deploys=false", () => {
    let projectRoot: string;
    beforeAll(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, {
        deploy_target: "none",
        preview_deploys: false,
      });
    });
    afterAll(async () => {
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
    beforeAll(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { node_version: "20" });
    });
    afterAll(async () => {
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
    beforeAll(async () => {
      projectRoot = await freshProject();
      await install(projectRoot, { preview_deploys: true });
    });
    afterAll(async () => {
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

    it("gates the preview job on the ENABLE_PREVIEW_DEPLOYS repo variable (F20)", async () => {
      const preview = await read(projectRoot, `${WORKFLOWS}/preview.yml`);
      // Off-by-default: on a fresh repo the variable is unset, the job is
      // skipped (neutral check), and no red run appears before Vercel is
      // configured. `vars` (not `secrets`) because GitHub does not expose the
      // secrets context to job-level `if:` conditions.
      assert.ok(
        preview.includes("vars.ENABLE_PREVIEW_DEPLOYS == 'true'"),
        "preview job must be gated on the ENABLE_PREVIEW_DEPLOYS repository variable",
      );
      // The PR trigger itself stays — previews are meaningless via
      // workflow_dispatch (no PR to comment on).
      const nonComment = preview
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("#"));
      assert.ok(
        nonComment.some((l) => /^\s{2}pull_request:/.test(l)),
        "preview.yml must keep its pull_request trigger (the gate is the job-level if)",
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

    it("activates Corepack before install and is not prematurely immutable (#5)", async () => {
      const preview = await read(projectRoot, `${WORKFLOWS}/preview.yml`);
      // Corepack must activate the pinned yarn@4 BEFORE any yarn invocation —
      // assert ordering, not just presence, so a regression that moves Corepack
      // after install is caught.
      const corepackAt = preview.indexOf("corepack enable");
      // Quote-agnostic: match `run: yarn install` or `run: "yarn install"`,
      // anchored to end-of-line so it never matches the `--immutable` form.
      const installAt =
        preview.match(/^\s*run:\s*["']?yarn install["']?\s*$/m)?.index ?? -1;
      assert.ok(corepackAt >= 0, "preview.yml must enable Corepack");
      assert.ok(installAt >= 0, "preview.yml must install dependencies");
      assert.ok(
        corepackAt < installAt,
        "`corepack enable` must come before the `yarn install` step (else the pinned yarn@4 is not active yet)",
      );
      assert.ok(
        preview.includes('corepack prepare "$(node -p'),
        "preview.yml must prepare the package manager pinned in package.json",
      );
      // No setup-node yarn cache in ANY YAML form (quoted or unquoted). Ignore
      // comment lines, which mention `cache: yarn` in prose to explain the hazard.
      const nonCommentLines = preview
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("#"));
      assert.ok(
        !nonCommentLines.some((l) => /\bcache:\s*["']?yarn["']?/.test(l)),
        "preview.yml must not use setup-node's yarn cache (it runs Yarn before Corepack — any quoting)",
      );
      assert.ok(
        !preview.includes('run: "yarn install --immutable"'),
        "preview.yml first run has no committed lockfile — the install step must not be --immutable (the SETUP.md comment may still mention it)",
      );
    });
  });
});
