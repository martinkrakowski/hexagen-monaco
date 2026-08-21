import { describe, expect, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  runScan,
  scanCommand,
  scanCommander,
} from "../../../src/commands/scan/index.js";
import { CURRENT_SCHEMA_VERSION, ScanEnvelope } from "@hexagen/shared";

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

  it("keeps an existing layout.yaml when bootstrapping a missing manifest without --force", async () => {
    const root = await makeRepo();
    try {
      const layoutPath = path.join(root, ".architecture", "layout.yaml");
      const custom = "contexts:\n  leftover: { root: packages/old }\n";
      await fs.mkdir(path.dirname(layoutPath), { recursive: true });
      await fs.writeFile(layoutPath, custom, "utf8");

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
      assert.equal(await fs.readFile(layoutPath, "utf8"), custom);
      await fs.stat(path.join(root, ".architecture", "manifest.yaml"));
      if (result.success) {
        assert.match(result.value.nextSteps.join("\n"), /Kept existing/i);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to wipe a populated ratchet baseline when bootstrapping without --force", async () => {
    const root = await makeRepo();
    try {
      const archDir = path.join(root, ".architecture");
      const layoutPath = path.join(archDir, "layout.yaml");
      const baselinePath = path.join(archDir, "arch-lint-baseline.json");
      const custom = "contexts:\n  leftover: { root: packages/old }\n";
      await fs.mkdir(archDir, { recursive: true });
      await fs.writeFile(layoutPath, custom, "utf8");
      await fs.writeFile(
        baselinePath,
        `${JSON.stringify({ version: 1, entries: [{ rule: "kept" }] }, null, 2)}\n`,
        "utf8",
      );

      const result = await runScan({
        root,
        yes: true,
        noReport: true,
        lint: silentLint,
      });
      assert.equal(result.success, false);
      if (!result.success) {
        assert.match(result.error.message, /overwrite|--force|baseline/i);
      }
      assert.equal(await fs.readFile(layoutPath, "utf8"), custom);
      assert.match(await fs.readFile(baselinePath, "utf8"), /kept/);
      await assert.rejects(fs.stat(path.join(archDir, "manifest.yaml")));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reports the actual unexpected linter exit code, not a hardcoded 2", async () => {
    const root = await makeRepo();
    try {
      const result = await runScan({
        root,
        yes: true,
        noReport: true,
        lint: () => 3,
      });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );
      if (result.success) {
        assert.equal(result.value.lintExitCode, 3);
        const text = result.value.nextSteps.join("\n");
        assert.match(text, /exit 3/);
        assert.doesNotMatch(text, /exit 2/);
        assert.doesNotMatch(text, /check passed|compliant/i);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails the scan when report generation throws", async () => {
    const root = await makeRepo();
    try {
      const result = await runScan({
        root,
        yes: true,
        lint: silentLint,
        report: async () => {
          throw new Error("disk full");
        },
      });
      assert.equal(result.success, false);
      if (!result.success) {
        assert.match(result.error.message, /Report failed: disk full/);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "does not treat an EACCES layout lookup as absence",
    async () => {
      const root = await makeRepo();
      const archDir = path.join(root, ".architecture");
      await fs.mkdir(archDir, { recursive: true });
      await fs.chmod(archDir, 0o000);
      try {
        let lookupCode: string | undefined;
        try {
          await fs.stat(path.join(archDir, "layout.yaml"));
        } catch (e) {
          lookupCode = (e as NodeJS.ErrnoException).code;
        }
        assert.equal(
          lookupCode,
          "EACCES",
          "unsearchable .architecture must surface EACCES (this host is not root / ACL-bypass)",
        );
        const result = await runScan({
          root,
          yes: true,
          noReport: true,
          lint: silentLint,
        });
        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(result.error.message, /EACCES/);
        }
      } finally {
        await fs.chmod(archDir, 0o755).catch(() => {});
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it("does not treat a dangling manifest.yaml symlink as absence", async () => {
    const root = await makeRepo();
    try {
      const archDir = path.join(root, ".architecture");
      await fs.mkdir(archDir, { recursive: true });
      const manifestPath = path.join(archDir, "manifest.yaml");
      await fs.symlink("missing-target", manifestPath);

      const result = await runScan({
        root,
        yes: true,
        noReport: true,
        lint: silentLint,
      });
      expect(result.success).toBe(true);
      if (!result.success) {
        throw new Error(result.error.message);
      }
      expect(result.value.nextSteps.join("\n")).not.toMatch(
        /Wrote .* via bootstrap/i,
      );
      const st = await fs.lstat(manifestPath);
      expect(st.isSymbolicLink()).toBe(true);
      expect(await fs.readlink(manifestPath)).toBe("missing-target");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("scan envelope (BF-0.1) — producer side", () => {
  it("emits the envelope as the FINAL stdout line, after the human next-steps", async () => {
    // Asserts the exact final line, not merely "some line parses as JSON".
    // The weaker assertion would pass against a build that emitted any
    // JSON-shaped log line, and would have passed against the pre-BF-0.1 CLI
    // for the wrong reason if one ever appeared.
    const root = await makeRepo();
    const out: string[] = [];
    const err: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = (...a: unknown[]) => void err.push(a.join(" "));
    try {
      await scanCommand({ root, yes: true, noReport: true });
    } finally {
      console.log = origLog;
      console.error = origErr;
      await fs.rm(root, { recursive: true, force: true });
    }

    assert.ok(out.length > 1, "human next-steps must still be printed");
    const last = out.at(-1) ?? "";
    const parsed = JSON.parse(last) as Record<string, unknown>;

    // Stdout and stderr are captured separately: the envelope must be on
    // stdout, where the adapter reads it, not mixed into the error stream.
    assert.equal(
      err.some((line) => line.trim().startsWith("{")),
      false,
      "the envelope must not be written to stderr",
    );

    assert.equal(parsed.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.ok("layout" in parsed);
    assert.ok("filesScanned" in parsed);
    assert.ok("reportMarkdown" in parsed);
    assert.ok("error" in parsed);
    // The line before it must be human text, proving placement rather than
    // "the envelope happens to be the only thing printed".
    assert.equal((out.at(-2) ?? "").trim().startsWith("{"), false);
  });

  it("validates against the shared schema both sides own", async () => {
    const root = await makeRepo();
    try {
      const result = await runScan({ root, yes: true, noReport: true });
      assert.equal(result.success, true);
      if (!result.success) return;
      const check = ScanEnvelope.safeParse(result.value.envelope);
      assert.equal(
        check.success,
        true,
        check.success ? "" : JSON.stringify(check.error.issues),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reports why it could not run, on the failure path", async () => {
    // `error` exists so a machine consumer learns the reason instead of
    // inferring it from an exit code plus a human string on stderr.
    const root = await makeRepo();
    const out: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = () => {};
    try {
      // Without --yes and without a TTY, scan refuses to write unratified
      // architecture files -- a real, deterministic failure path.
      await scanCommand({ root, noReport: true });
    } finally {
      console.log = origLog;
      console.error = origErr;
      await fs.rm(root, { recursive: true, force: true });
    }
    const last = out.at(-1) ?? "";
    const parsed = JSON.parse(last) as Record<string, unknown>;
    assert.equal(parsed.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(typeof parsed.error, "string");
  });
});
