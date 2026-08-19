import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { runScan, scanCommander } from "../../../src/commands/scan/index.js";

async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-scan-"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "acme-app",
      private: true,
      workspaces: ["packages/*"],
    }),
    "utf8",
  );
  await fs.mkdir(path.join(root, "packages", "billing", "src", "core"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, "packages", "billing", "package.json"),
    JSON.stringify({ name: "@acme/billing" }),
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "packages", "billing", "src", "core", "invoice.ts"),
    "export const invoice = 1;\n",
    "utf8",
  );
  return root;
}

function silentLint(): number {
  return 0;
}

describe("hexagen scan", () => {
  it("--dry-run writes nothing and previews layout plus bootstrap answers", async () => {
    const root = await makeRepo();
    try {
      const result = await runScan({
        root,
        dryRun: true,
        lint: () => {
          throw new Error("lint must not run on --dry-run");
        },
        report: async () => {
          throw new Error("report must not run on --dry-run");
        },
      });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );
      if (result.success) {
        assert.equal(result.value.wrote, false);
        assert.equal(result.value.lintExitCode, 0);
        const text = result.value.nextSteps.join("\n");
        assert.match(text, /Dry-run/i);
        assert.match(text, /billing/);
        assert.match(text, /Proposed bootstrap answers/i);
        assert.match(text, /acme-app|system:/i);
      }
      await assert.rejects(
        fs.stat(path.join(root, ".architecture", "layout.yaml")),
      );
      await assert.rejects(
        fs.stat(path.join(root, ".architecture", "manifest.yaml")),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to write without --yes", async () => {
    const root = await makeRepo();
    try {
      const result = await runScan({
        root,
        yes: false,
        lint: silentLint,
      });
      assert.equal(result.success, false);
      if (!result.success) {
        assert.match(result.error.message, /--yes/);
        assert.doesNotMatch(result.error.message, /TTY/);
      }
      await assert.rejects(
        fs.stat(path.join(root, ".architecture", "layout.yaml")),
      );
      await assert.rejects(
        fs.stat(path.join(root, ".architecture", "manifest.yaml")),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("--yes on a tiny workspace writes layout and bootstraps a manifest when absent", async () => {
    const root = await makeRepo();
    try {
      const result = await runScan({
        root,
        yes: true,
        noReport: true,
        lint: silentLint,
      });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );
      const layout = yaml.load(
        await fs.readFile(
          path.join(root, ".architecture", "layout.yaml"),
          "utf8",
        ),
      ) as { contexts: Record<string, { root: string }> };
      assert.equal(layout.contexts.billing.root, "packages/billing");

      const manifest = yaml.load(
        await fs.readFile(
          path.join(root, ".architecture", "manifest.yaml"),
          "utf8",
        ),
      ) as { bounded_contexts: { name: string }[] };
      assert.ok(manifest.bounded_contexts.some((c) => c.name === "billing"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("--skip-bootstrap leaves no manifest", async () => {
    const root = await makeRepo();
    try {
      const result = await runScan({
        root,
        yes: true,
        skipBootstrap: true,
        noReport: true,
        lint: silentLint,
      });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );
      await fs.stat(path.join(root, ".architecture", "layout.yaml"));
      await assert.rejects(
        fs.stat(path.join(root, ".architecture", "manifest.yaml")),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("--force overwrites an existing layout.yaml", async () => {
    const root = await makeRepo();
    try {
      const layoutPath = path.join(root, ".architecture", "layout.yaml");
      await fs.mkdir(path.dirname(layoutPath), { recursive: true });
      await fs.writeFile(
        layoutPath,
        "contexts:\n  leftover: { root: packages/old }\n",
        "utf8",
      );

      const kept = await runScan({
        root,
        yes: true,
        skipBootstrap: true,
        noReport: true,
        lint: silentLint,
      });
      assert.equal(kept.success, true, kept.success ? "" : kept.error.message);
      const keptRaw = await fs.readFile(layoutPath, "utf8");
      assert.match(keptRaw, /leftover/);

      const forced = await runScan({
        root,
        yes: true,
        force: true,
        skipBootstrap: true,
        noReport: true,
        lint: silentLint,
      });
      assert.equal(
        forced.success,
        true,
        forced.success ? "" : forced.error.message,
      );
      const raw = await fs.readFile(layoutPath, "utf8");
      assert.match(raw, /billing/);
      assert.doesNotMatch(raw, /leftover/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("public CLI help lists scan", () => {
    assert.equal(scanCommander.name(), "scan");
    const help = scanCommander.helpInformation();
    assert.match(help, /--root/);
    assert.match(help, /--yes/);
    assert.match(help, /--dry-run/);
    assert.match(help, /--force/);
    assert.match(help, /--skip-bootstrap/);
    assert.match(help, /--no-report/);
    const src = readFileSync(
      new URL("../../../src/cli.ts", import.meta.url),
      "utf8",
    );
    const added = (src.match(/addCommand\(scanCommander\)/g) ?? []).length;
    assert.equal(added, 1);
  });

  it("anti-vacuity: a scan that checks zero files is not reported as success", async () => {
    const root = await makeRepo();
    try {
      const result = await runScan({
        root,
        yes: true,
        noReport: true,
        lint: () => 2,
      });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );
      if (result.success) {
        assert.equal(result.value.lintExitCode, 2);
        const text = result.value.nextSteps.join("\n");
        assert.doesNotMatch(text, /check passed|compliant/i);
        assert.match(text, /exit 2|zero files|could not run/i);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("anti-vacuity: spawned hexagen-lint exit 2 is not swallowed", async () => {
    const root = await makeRepo();
    try {
      const binDir = path.join(root, "node_modules", ".bin");
      await fs.mkdir(binDir, { recursive: true });
      const bin = path.join(binDir, "hexagen-lint");
      await fs.writeFile(
        bin,
        `#!/usr/bin/env node
console.error("FATAL ERROR: Zero resolvable source files were scanned.");
process.exit(2);
`,
        "utf8",
      );
      await fs.chmod(bin, 0o755);

      const result = await runScan({
        root,
        yes: true,
        noReport: true,
      });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );
      if (result.success) {
        assert.equal(result.value.lintExitCode, 2);
        const text = result.value.nextSteps.join("\n");
        assert.doesNotMatch(text, /check passed|compliant/i);
        assert.match(text, /exit 2|zero files|could not run/i);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("propagates linter exit 1 (violations) as lintExitCode", async () => {
    const root = await makeRepo();
    try {
      const result = await runScan({
        root,
        yes: true,
        noReport: true,
        lint: () => 1,
      });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );
      if (result.success) {
        assert.equal(result.value.lintExitCode, 1);
        assert.match(result.value.nextSteps.join("\n"), /exit 1|violation/i);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("writes the engagement report unless --no-report", async () => {
    const root = await makeRepo();
    try {
      let called = 0;
      const withReport = await runScan({
        root,
        yes: true,
        lint: silentLint,
        report: async ({ cwd }) => {
          called += 1;
          return {
            markdownPath: path.join(cwd, "hexagen-report.md"),
            htmlPath: path.join(cwd, "hexagen-report.html"),
          };
        },
      });
      assert.equal(
        withReport.success,
        true,
        withReport.success ? "" : withReport.error.message,
      );
      assert.equal(called, 1);

      called = 0;
      const skipped = await runScan({
        root,
        yes: true,
        force: true,
        noReport: true,
        lint: silentLint,
        report: async ({ cwd }) => {
          called += 1;
          return {
            markdownPath: path.join(cwd, "hexagen-report.md"),
            htmlPath: path.join(cwd, "hexagen-report.html"),
          };
        },
      });
      assert.equal(
        skipped.success,
        true,
        skipped.success ? "" : skipped.error.message,
      );
      assert.equal(called, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
