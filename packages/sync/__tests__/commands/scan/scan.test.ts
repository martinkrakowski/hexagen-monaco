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
    // scanCommand sets process.exitCode as part of its CLI behaviour. That is
    // worker-global state in vitest: leaving it non-zero makes the whole test
    // process exit as failed even when every assertion here passed.
    // `?? undefined` is load-bearing: @types/node types the process.exitCode
    // GETTER as `string | number | null | undefined` but its SETTER as
    // `string | number | undefined`, so round-tripping the raw value does not
    // typecheck (TS2322 under typecheck:test).
    const origExitCode = process.exitCode ?? undefined;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = (...a: unknown[]) => void err.push(a.join(" "));
    try {
      await scanCommand({ root, yes: true, noReport: true });
    } finally {
      console.log = origLog;
      console.error = origErr;
      process.exitCode = origExitCode;
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
    // `?? undefined` is load-bearing: @types/node types the process.exitCode
    // GETTER as `string | number | null | undefined` but its SETTER as
    // `string | number | undefined`, so round-tripping the raw value does not
    // typecheck (TS2322 under typecheck:test).
    const origExitCode = process.exitCode ?? undefined;
    let observedExitCode: number | string | undefined;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = () => {};
    try {
      // Without --yes and without a TTY, scan refuses to write unratified
      // architecture files -- a real, deterministic failure path.
      await scanCommand({ root, noReport: true });
      observedExitCode = process.exitCode ?? undefined;
    } finally {
      console.log = origLog;
      console.error = origErr;
      process.exitCode = origExitCode;
      await fs.rm(root, { recursive: true, force: true });
    }
    const last = out.at(-1) ?? "";
    const parsed = JSON.parse(last) as Record<string, unknown>;
    assert.equal(parsed.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(typeof parsed.error, "string");

    // 2 = could-not-run, per the contract apps/web's classifyScanExit
    // encodes. 1 would mean "layout written, lint found violations" -- so
    // exiting 1 from a scan that never ran told the UI the user's
    // architecture has violations, contradicting the `error` field emitted
    // on the very same line.
    assert.equal(
      observedExitCode,
      2,
      "a scan that could not run must exit 2, not 1 (which means violations)",
    );
  });

  it("restores process.exitCode so a failing scan does not leak into the worker", () => {
    // Guards the harness itself. Both tests above mutate worker-global state;
    // if either stops restoring it, a green suite can still exit non-zero.
    assert.notEqual(
      process.exitCode,
      2,
      "a previous test leaked its exit code into the worker",
    );
  });

  it("fails loudly when a produced artifact cannot be read", async () => {
    // The success path only reads files the scan is known to have written or
    // kept. An earlier revision caught every read error and returned null,
    // which produced exit 0 with `layout: null, error: null` -- a scan
    // reporting success while having produced nothing readable.
    //
    // Simulated by replacing layout.yaml with a DIRECTORY: readFileSync then
    // fails with EISDIR, which is a genuine fault rather than an absence.
    const root = await makeRepo();
    const out: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    // `?? undefined` is load-bearing: @types/node types the process.exitCode
    // GETTER as `string | number | null | undefined` but its SETTER as
    // `string | number | undefined`, so round-tripping the raw value does not
    // typecheck (TS2322 under typecheck:test).
    const origExitCode = process.exitCode ?? undefined;
    let observedExitCode: number | string | undefined;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = () => {};
    try {
      await scanCommand({ root, yes: true, noReport: true });
      out.length = 0;
      const layoutPath = path.join(root, ".architecture", "layout.yaml");
      await fs.rm(layoutPath, { force: true });
      await fs.mkdir(layoutPath, { recursive: true });
      await scanCommand({ root, yes: true, noReport: true });
      observedExitCode = process.exitCode ?? undefined;
    } finally {
      console.log = origLog;
      console.error = origErr;
      process.exitCode = origExitCode;
      await fs.rm(root, { recursive: true, force: true });
    }

    const last = out.at(-1) ?? "";
    const parsed = JSON.parse(last) as Record<string, unknown>;
    assert.equal(
      typeof parsed.error,
      "string",
      "an unreadable artifact must surface as an error, not a null field",
    );
    assert.equal(parsed.layout, null);
    assert.equal(observedExitCode, 2);
  });
});

/**
 * BF-0.2 — `hexagen scan --handoff`.
 *
 * The consumer is `apps/web/app/api/projects/scan/artifacts/route.ts`, which is
 * already on main. It ingests the zip in-process and matches entries by
 * BASENAME against `HANDOFF_ARTIFACT_NAMES` in
 * `apps/web/app/lib/project-scan/artifact-parse.ts` — six names, three of them
 * conditional on the file existing in the tree. These tests assert the produced
 * archive against that list, so a rename on either side fails here rather than
 * silently degrading a Tier-A upload to `verdict: "incomplete"`.
 */
const TIER_A_HANDOFF_ENTRIES = [
  "hexagen-report.md",
  "hexagen-report.html",
  "suppression-ledger.json",
  "manifest.yaml",
  "layout.yaml",
  "arch-lint-baseline.json",
];

/**
 * Read entry names from the ZIP central directory.
 *
 * Deliberately not `zip.includes(Buffer.from(name))`: these are STORE-method
 * archives, so a name can appear inside another entry's payload (the report
 * markdown names its own files), and a substring probe would pass on an archive
 * that contains no such entry at all. Walking the central directory also yields
 * the entry COUNT, which is what "all 6 entries" actually means.
 */
function readZipEntryNames(zip: Buffer): string[] {
  const eocd = zip.length - 22; // writeZipStore emits no archive comment.
  assert.ok(eocd >= 0, "buffer is too short to be a zip");
  assert.equal(
    zip.readUInt32LE(eocd),
    0x06054b50,
    "zip must end with an end-of-central-directory record",
  );
  const total = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < total; i += 1) {
    assert.equal(
      zip.readUInt32LE(offset),
      0x02014b50,
      `central directory header ${i} is malformed`,
    );
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    names.push(
      zip.subarray(offset + 46, offset + 46 + nameLen).toString("utf8"),
    );
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/**
 * A tree where all three CONDITIONAL handoff entries exist, so the zip carries
 * the full six. The manifest is the fixture `reportCommand`'s own suite loads,
 * so this exercises the real report writer rather than a stub of it.
 */
async function makeHandoffRepo(): Promise<string> {
  const root = await makeRepo();
  const archDir = path.join(root, ".architecture");
  await fs.mkdir(archDir, { recursive: true });
  await fs.writeFile(
    path.join(archDir, "manifest.yaml"),
    `system: acme-billing
scope: acme
architecture: modular-monolith
bounded_contexts:
  - name: shared
    type: shared-kernel
    layers:
      domain: {}
`,
    "utf8",
  );
  await fs.writeFile(
    path.join(archDir, "layout.yaml"),
    "contexts:\n  billing: { root: packages/billing }\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(archDir, "arch-lint-baseline.json"),
    `${JSON.stringify({ version: 1, entries: [] }, null, 2)}\n`,
    "utf8",
  );
  return root;
}

describe("scan --handoff (BF-0.2)", () => {
  it("writes a zip carrying exactly the six artifacts the ingest route matches on", async () => {
    const root = await makeHandoffRepo();
    try {
      const result = await runScan({
        root,
        yes: true,
        handoff: true,
        lint: silentLint,
      });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );
      if (!result.success) return;

      const handoffPath = result.value.handoffPath;
      assert.ok(handoffPath, "--handoff must report the zip it wrote");
      assert.equal(handoffPath, path.join(root, "hexagen-handoff.zip"));

      const zip = await fs.readFile(handoffPath);
      assert.equal(
        zip.subarray(0, 2).toString("utf8"),
        "PK",
        "handoff must be a zip",
      );
      const names = readZipEntryNames(zip);
      assert.deepEqual(
        [...names].sort(),
        [...TIER_A_HANDOFF_ENTRIES].sort(),
        "entry names are the web route's contract (HANDOFF_ARTIFACT_NAMES)",
      );
      // Flat names: the route matches on basename, but a nested layout would
      // mean the CLI stopped writing what `ingestHandoffFiles` (loose-file
      // mode, which has no directories at all) can accept.
      for (const name of names) {
        assert.doesNotMatch(name, /[\\/]/, `${name} must be a flat entry`);
      }

      // The path is announced on stdout as a human line, so a person running
      // the CLI knows what to upload.
      assert.match(
        result.value.nextSteps.join("\n"),
        /hexagen-handoff\.zip/,
        "next steps must name the handoff zip",
      );
      // ...and it stays out of reportPaths, which is read as "the report docs".
      assert.equal(
        result.value.reportPaths.some((p) => p.endsWith(".zip")),
        false,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not write a handoff zip unless asked", async () => {
    const root = await makeHandoffRepo();
    try {
      const result = await runScan({ root, yes: true, lint: silentLint });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );
      if (result.success) {
        assert.equal(result.value.handoffPath, undefined);
      }
      await assert.rejects(fs.stat(path.join(root, "hexagen-handoff.zip")));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("forwards --handoff and --handoff-out to the report writer rather than packing its own zip", async () => {
    // The zip is packed by `buildHandoffZip`, which reportCommand owns. Scan
    // must delegate: a second packer here would own the entry names twice and
    // drift from the route's expectations on the first change.
    const root = await makeRepo();
    try {
      let seen: { handoff?: boolean; handoffOut?: string } | null = null;
      const result = await runScan({
        root,
        yes: true,
        handoff: true,
        handoffOut: "artifacts/upload.zip",
        lint: silentLint,
        report: async ({ cwd, handoff, handoffOut }) => {
          seen = { handoff, handoffOut };
          return {
            markdownPath: path.join(cwd, "hexagen-report.md"),
            htmlPath: path.join(cwd, "hexagen-report.html"),
            handoffPath: path.join(cwd, handoffOut ?? "hexagen-handoff.zip"),
          };
        },
      });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );
      assert.deepEqual(seen, {
        handoff: true,
        handoffOut: "artifacts/upload.zip",
      });
      if (result.success) {
        assert.equal(
          result.value.handoffPath,
          path.join(root, "artifacts/upload.zip"),
        );
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("fails when --handoff is honoured by no zip", async () => {
    // A report writer that returns no handoffPath means the user has nothing to
    // upload. Exiting 0 there would claim the flag was honoured.
    const root = await makeRepo();
    try {
      const result = await runScan({
        root,
        yes: true,
        handoff: true,
        lint: silentLint,
        report: async ({ cwd }) => ({
          markdownPath: path.join(cwd, "hexagen-report.md"),
          htmlPath: path.join(cwd, "hexagen-report.html"),
        }),
      });
      assert.equal(result.success, false);
      if (!result.success) {
        assert.match(result.error.message, /handoff/i);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses --handoff with --no-report, before writing anything", async () => {
    const root = await makeRepo();
    try {
      const result = await runScan({
        root,
        yes: true,
        handoff: true,
        noReport: true,
        lint: () => {
          throw new Error("lint must not run on a rejected flag combination");
        },
      });
      assert.equal(result.success, false);
      if (!result.success) {
        assert.match(result.error.message, /--handoff/);
        assert.match(result.error.message, /--no-report/);
      }
      await assert.rejects(fs.stat(path.join(root, "hexagen-handoff.zip")));
      await assert.rejects(
        fs.stat(path.join(root, ".architecture", "layout.yaml")),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses --handoff with --dry-run, before writing anything", async () => {
    const root = await makeRepo();
    try {
      const result = await runScan({
        root,
        dryRun: true,
        handoff: true,
        lint: () => {
          throw new Error("lint must not run on a rejected flag combination");
        },
      });
      assert.equal(result.success, false);
      if (!result.success) {
        assert.match(result.error.message, /--dry-run/);
      }
      await assert.rejects(fs.stat(path.join(root, "hexagen-handoff.zip")));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the envelope as the FINAL stdout line when --handoff prints an extra path", async () => {
    // The adapter takes the LAST stdout line starting with `{`. The handoff
    // line is human output and must therefore precede the envelope, like every
    // other next-step.
    const root = await makeHandoffRepo();
    const out: string[] = [];
    // `?? undefined` is load-bearing: @types/node types the process.exitCode
    // GETTER as `string | number | null | undefined` but its SETTER as
    // `string | number | undefined`, so round-tripping the raw value does not
    // typecheck (TS2322 under typecheck:test).
    const origExitCode = process.exitCode ?? undefined;
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => void out.push(a.join(" "));
    console.error = () => {};
    try {
      await scanCommand({ root, yes: true, handoff: true });
    } finally {
      console.log = origLog;
      console.error = origErr;
      process.exitCode = origExitCode;
    }
    try {
      const last = out.at(-1) ?? "";
      const parsed = JSON.parse(last) as Record<string, unknown>;
      assert.equal(parsed.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.equal(
        out.some((line) => /hexagen-handoff\.zip/.test(line)),
        true,
        "the handoff path must be printed for the person running the CLI",
      );
      assert.equal(
        last.includes("hexagen-handoff.zip"),
        false,
        "the handoff line must not be the last line -- the envelope is",
      );
      const zip = await fs.readFile(path.join(root, "hexagen-handoff.zip"));
      assert.equal(readZipEntryNames(zip).length, 6);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("public CLI help lists --handoff and --handoff-out", () => {
    const help = scanCommander.helpInformation();
    assert.match(help, /--handoff\b/);
    assert.match(help, /--handoff-out <path>/);
  });
});
