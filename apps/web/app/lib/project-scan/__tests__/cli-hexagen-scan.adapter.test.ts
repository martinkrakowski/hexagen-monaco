/**
 * Adapter-level tests for {@link CliHexagenScanAdapter}.
 *
 * Only the subprocess is faked — temp dir, zip unpack, artifact reads, and
 * cleanup run against the real filesystem.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { CliHexagenScanAdapter } from "../cli-hexagen-scan.adapter";
import {
  MAX_SCAN_ERROR_CHARS,
  MAX_SCAN_REPORT_CHARS,
  SCAN_TIMEOUT_MS,
} from "../limits";

const ROOT = "/repo/root";
const CLI = "/repo/packages/sync/dist/cli.js";
const NODE = "/usr/bin/node";

async function zipBuffer(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

function execFailure(
  code: number | string,
  stderr = "",
  stdout = "",
  message = "Command failed",
) {
  return Object.assign(new Error(message), { stderr, stdout, code });
}

function adapter(
  execFileAsync: (
    file: string,
    args: readonly string[],
    options: { cwd: string; timeout: number; maxBuffer: number },
  ) => Promise<{ stdout: string; stderr: string }>,
) {
  return new CliHexagenScanAdapter(ROOT, execFileAsync, () => CLI, NODE);
}

describe("CliHexagenScanAdapter", () => {
  it("invokes execFile with argv including scan, --yes, and --root", async () => {
    let seen: { file: string; args: readonly string[]; cwd: string } | null =
      null;
    const zip = await zipBuffer({ "package.json": '{"name":"demo"}' });
    const inst = adapter(async (file, args, opts) => {
      seen = { file, args, cwd: opts.cwd };
      return { stdout: "Files scanned: 1\n", stderr: "" };
    });

    const outcome = await inst.scanZip({ zip, projectName: "Demo" });

    assert.equal(outcome.kind, "scanned");
    assert.equal(
      outcome.kind === "scanned" ? outcome.result.verdict : "",
      "pass",
    );
    assert.ok(seen);
    const call = seen as unknown as {
      file: string;
      args: readonly string[];
      cwd: string;
    };
    assert.equal(call.file, NODE);
    assert.ok(call.args.includes("scan"));
    assert.ok(call.args.includes("--yes"));
    assert.ok(call.args.includes("--root"));
    const rootFlag = call.args[call.args.indexOf("--root") + 1];
    assert.ok(rootFlag.startsWith(path.join(tmpdir(), "hexagen-scan-")));
    assert.equal(call.args[0], CLI);
  });

  it("classifies exit 0 as pass and reads a layout excerpt", async () => {
    const zip = await zipBuffer({ "package.json": "{}" });
    const inst = adapter(async (_f, args) => {
      const root = args[args.indexOf("--root") + 1];
      await mkdir(path.join(root, ".architecture"), { recursive: true });
      await writeFile(
        path.join(root, ".architecture", "layout.yaml"),
        "contexts:\n  demo:\n    root: packages/demo\n",
      );
      return { stdout: "Files scanned: 4\n", stderr: "" };
    });

    const outcome = await inst.scanZip({ zip, projectName: "Demo" });
    assert.equal(outcome.kind, "scanned");
    if (outcome.kind !== "scanned") return;
    assert.equal(outcome.result.verdict, "pass");
    assert.equal(outcome.result.exitCode, 0);
    assert.equal(outcome.result.filesScanned, 4);
    assert.match(outcome.result.layoutExcerpt ?? "", /contexts:/);
  });

  it("classifies exit 1 as violations", async () => {
    const zip = await zipBuffer({ "package.json": "{}" });
    const inst = adapter(async () => {
      throw execFailure(1, "Layer Violation: domain imports infrastructure\n");
    });

    const outcome = await inst.scanZip({ zip, projectName: "Demo" });
    assert.equal(outcome.kind, "scanned");
    if (outcome.kind !== "scanned") return;
    assert.equal(outcome.result.verdict, "violations");
    assert.equal(outcome.result.exitCode, 1);
  });

  it("classifies exit 2 as could-not-run and surfaces the CLI error", async () => {
    const zip = await zipBuffer({ "package.json": "{}" });
    const inst = adapter(async () => {
      throw execFailure(2, "No workspace packages found.\n");
    });

    const outcome = await inst.scanZip({ zip, projectName: "Demo" });
    assert.equal(outcome.kind, "scanned");
    if (outcome.kind !== "scanned") return;
    assert.equal(outcome.result.verdict, "could-not-run");
    assert.equal(outcome.result.exitCode, 2);
    assert.match(outcome.result.errorMessage ?? "", /No workspace packages/);
  });

  it("rejects zip-slip without spawning execFile", async () => {
    let spawned = false;
    const zip = await zipBuffer({
      "package.json": "{}",
      "../outside.txt": "nope",
    });
    const inst = adapter(async () => {
      spawned = true;
      return { stdout: "", stderr: "" };
    });

    const outcome = await inst.scanZip({ zip, projectName: "Demo" });
    assert.equal(spawned, false);
    assert.equal(outcome.kind, "rejected");
    if (outcome.kind !== "rejected") return;
    assert.equal(outcome.reason, "zip-slip");
  });

  it("rejects a duplicate-entry zip explicitly, not as could-not-run", async () => {
    // A duplicate normalized entry name is a crafted archive trying to
    // overwrite an earlier entry. It must reach the route as kind:"rejected"
    // (HTTP 400), not kind:"scanned"/could-not-run (HTTP 200) -- otherwise a
    // deliberate attack is reported as a transient scan failure.
    let spawned = false;
    const zip = new JSZip();
    zip.file("a.txt", "first");
    zip.file("a.txt/", "second");
    const buf = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
    const inst = adapter(async () => {
      spawned = true;
      return { stdout: "", stderr: "" };
    });

    const outcome = await inst.scanZip({ zip: buf, projectName: "Demo" });
    assert.equal(spawned, false);
    assert.equal(outcome.kind, "rejected");
    if (outcome.kind !== "rejected") return;
    assert.equal(outcome.reason, "duplicate-zip-entry");
  });

  it("surfaces an empty zip as could-not-run without spawning", async () => {
    let spawned = false;
    const zip = await zipBuffer({});
    const inst = adapter(async () => {
      spawned = true;
      return { stdout: "", stderr: "" };
    });

    const outcome = await inst.scanZip({ zip, projectName: "Demo" });
    assert.equal(spawned, false);
    assert.equal(outcome.kind, "scanned");
    if (outcome.kind !== "scanned") return;
    assert.equal(outcome.result.verdict, "could-not-run");
    assert.match(outcome.result.errorMessage ?? "", /empty/i);
  });

  it("removes the staged directory once the run finishes", async () => {
    let staged = "";
    const zip = await zipBuffer({ "package.json": "{}" });
    const inst = adapter(async (_f, args) => {
      staged = args[args.indexOf("--root") + 1];
      return { stdout: "", stderr: "" };
    });

    await inst.scanZip({ zip, projectName: "Demo" });

    assert.ok(staged.startsWith(path.join(tmpdir(), "hexagen-scan-")));
    await assert.rejects(() => readdir(staged), /ENOENT/);
  });

  it("caps execFile below the 60s route deadline", async () => {
    let timeout = 0;
    const zip = await zipBuffer({ "package.json": "{}" });
    const inst = adapter(async (_f, _a, opts) => {
      timeout = opts.timeout;
      return { stdout: "", stderr: "" };
    });

    await inst.scanZip({ zip, projectName: "Demo" });

    assert.equal(timeout, SCAN_TIMEOUT_MS);
    assert.ok(timeout < 60_000);
  });

  it("clips a file-backed scan report instead of returning it whole", async () => {
    const zip = await zipBuffer({ "package.json": "{}" });
    const inst = adapter(async (_f, args) => {
      const root = args[args.indexOf("--root") + 1];
      await mkdir(path.join(root, ".architecture"), { recursive: true });
      await writeFile(
        path.join(root, ".architecture", "HEXAGEN-SCAN-REPORT.md"),
        "R".repeat(MAX_SCAN_REPORT_CHARS + 4_000),
      );
      return { stdout: "", stderr: "" };
    });

    const outcome = await inst.scanZip({ zip, projectName: "Demo" });
    assert.equal(outcome.kind, "scanned");
    if (outcome.kind !== "scanned") return;
    const report = outcome.result.reportMarkdown ?? "";
    assert.ok(report.length <= MAX_SCAN_REPORT_CHARS + 2);
    assert.match(report, /…$/);
  });

  it("clips reportMarkdown supplied in CLI JSON stdout", async () => {
    const zip = await zipBuffer({ "package.json": "{}" });
    const inst = adapter(async () => ({
      stdout: JSON.stringify({
        reportMarkdown: "J".repeat(MAX_SCAN_REPORT_CHARS + 2_000),
      }),
      stderr: "",
    }));

    const outcome = await inst.scanZip({ zip, projectName: "Demo" });
    assert.equal(outcome.kind, "scanned");
    if (outcome.kind !== "scanned") return;
    const report = outcome.result.reportMarkdown ?? "";
    assert.ok(report.length <= MAX_SCAN_REPORT_CHARS + 2);
    assert.match(report, /…$/);
  });

  it("clips a could-not-run stderr payload", async () => {
    const zip = await zipBuffer({ "package.json": "{}" });
    const inst = adapter(async () => {
      throw execFailure(2, "E".repeat(MAX_SCAN_ERROR_CHARS + 2_000));
    });

    const outcome = await inst.scanZip({ zip, projectName: "Demo" });
    assert.equal(outcome.kind, "scanned");
    if (outcome.kind !== "scanned") return;
    const message = outcome.result.errorMessage ?? "";
    assert.ok(message.length <= MAX_SCAN_ERROR_CHARS + 2);
    assert.match(message, /…$/);
  });

  it("rejects an over-limit archive without spawning execFile", async () => {
    let spawned = false;
    const zip = await zipBuffer({ a: "1", b: "2", c: "3" });
    const inst = adapter(async () => {
      spawned = true;
      return { stdout: "", stderr: "" };
    });

    const outcome = await inst.scanZip({
      zip,
      projectName: "Demo",
      unpackLimits: {
        maxEntries: 1,
        maxEntryBytes: 1024,
        maxUncompressedBytes: 1024,
      },
    });
    assert.equal(spawned, false);
    assert.equal(outcome.kind, "rejected");
    if (outcome.kind !== "rejected") return;
    assert.equal(outcome.reason, "zip-too-large");
  });

  it("reports a missing binary as could-not-run without spawning", async () => {
    let spawned = false;
    const zip = await zipBuffer({ "package.json": "{}" });
    const inst = new CliHexagenScanAdapter(
      ROOT,
      async () => {
        spawned = true;
        return { stdout: "", stderr: "" };
      },
      () => null,
      NODE,
    );

    const outcome = await inst.scanZip({ zip, projectName: "Demo" });
    assert.equal(spawned, false);
    assert.equal(outcome.kind, "scanned");
    if (outcome.kind !== "scanned") return;
    assert.equal(outcome.result.verdict, "could-not-run");
    assert.match(outcome.result.errorMessage ?? "", /not found/i);
  });
});
