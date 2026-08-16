/**
 * Adapter-level tests for {@link CliManifestLintAdapter}.
 *
 * Only the subprocess is faked — the temp directory, the manifest write and the
 * cleanup all run against the real filesystem, and the injected `execFileAsync`
 * reads the file back so the assertions prove the manifest actually reached
 * disk. Faking `node:fs` here would leave nothing under test but the fake.
 */
import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ARCH_LINT_FAILURE_BANNER,
  ARCH_LINT_LOG_PREFIX,
  CliManifestLintAdapter,
} from "../cli-manifest-lint.adapter";

const ROOT = "/repo/root";

/** Build the exec failure shape `promisify(execFile)` rejects with. */
function execFailure(stderr: string, message = "Command failed") {
  return Object.assign(new Error(message), { stderr, code: 1 });
}

function line(text: string) {
  return `${ARCH_LINT_LOG_PREFIX}${text}`;
}

describe("CliManifestLintAdapter", () => {
  it("hands the linter the submitted manifest as a real file and reports clean on exit 0", async () => {
    let seen: { file: string; args: readonly string[]; cwd: string } | null =
      null;
    let contentOnDisk: string | null = null;

    const adapter = new CliManifestLintAdapter(
      ROOT,
      async (file, args, opts) => {
        seen = { file, args, cwd: opts.cwd };
        const manifestPath = args[args.indexOf("--manifest") + 1];
        contentOnDisk = await readFile(manifestPath, "utf-8");
        return { stdout: "", stderr: "" };
      },
    );

    const outcome = await adapter.lintManifest("bounded_contexts: []\n");

    assert.deepEqual(outcome, { kind: "clean" });
    assert.equal(contentOnDisk, "bounded_contexts: []\n");
    const call = seen as unknown as {
      file: string;
      args: readonly string[];
      cwd: string;
    };
    // argv-style, not a shell command string: nothing to quote, nothing to
    // interpret. The old route interpolated the path into `exec`.
    assert.equal(call.file, "yarn");
    assert.deepEqual(call.args.slice(0, 2), ["lint:arch", "--manifest"]);
    // The injected workspace root, not process.cwd() (AUD-002 anchor).
    assert.equal(call.cwd, ROOT);
    assert.notEqual(call.cwd, process.cwd());
  });

  it("removes the staged manifest once the run finishes", async () => {
    let stagedDir = "";
    const adapter = new CliManifestLintAdapter(ROOT, async (_f, args) => {
      stagedDir = path.dirname(args[args.indexOf("--manifest") + 1]);
      return { stdout: "", stderr: "" };
    });

    await adapter.lintManifest("bounded_contexts: []");

    assert.ok(stagedDir.startsWith(path.join(tmpdir(), "hexagen-governance-")));
    await assert.rejects(() => readdir(stagedDir), /ENOENT/);
  });

  it("stages each concurrent lint in its own directory", async () => {
    // The previous filename was `hexagen-governance-${Date.now()}.yaml`: two
    // refreshes in the same millisecond shared one path, so one overwrote the
    // other's manifest and the first `unlink` deleted it out from under the
    // second run.
    const paths: string[] = [];
    const adapter = new CliManifestLintAdapter(ROOT, async (_f, args) => {
      paths.push(args[args.indexOf("--manifest") + 1]);
      return { stdout: "", stderr: "" };
    });

    await Promise.all([
      adapter.lintManifest("a: 1"),
      adapter.lintManifest("b: 2"),
      adapter.lintManifest("c: 3"),
    ]);

    assert.equal(new Set(paths).size, 3, "staged paths must not collide");
  });

  it("reports the linter's own violations, dropping the banner and warning lines", async () => {
    const stderr = [
      line("Subpath convention warnings (enforcement: warn):"),
      line(" - packages/foo uses a deep import"),
      line(
        "Ratchet: 1 baseline entry no longer reproduces — delete them from .architecture/arch-lint-baseline.json:",
      ),
      line(ARCH_LINT_FAILURE_BANNER),
      line(" - Layer Violation: domain imports infrastructure"),
      line(" - Cross-Context Violation: alpha imports beta"),
    ].join("\n");

    const adapter = new CliManifestLintAdapter(ROOT, async () => {
      throw execFailure(stderr);
    });

    const outcome = await adapter.lintManifest("bounded_contexts: []");

    assert.deepEqual(outcome, {
      kind: "violations",
      messages: [
        "Layer Violation: domain imports infrastructure",
        "Cross-Context Violation: alpha imports beta",
      ],
    });
  });

  it("reports a linter that could not run as unavailable, not as violations", async () => {
    // The production image has no `yarn`: exit 127, empty stderr. The old route
    // returned this as a HIGH-severity architectural violation.
    const adapter = new CliManifestLintAdapter(ROOT, async () => {
      throw execFailure("", "Command failed: yarn lint:arch");
    });

    const outcome = await adapter.lintManifest("bounded_contexts: []");

    assert.equal(outcome.kind, "unavailable");
    assert.match(
      outcome.kind === "unavailable" ? outcome.reason : "",
      /Command failed/,
    );
  });

  it("reports the linter's FATAL banner as unavailable, not as an architectural finding", async () => {
    const adapter = new CliManifestLintAdapter(ROOT, async () => {
      throw execFailure(
        line("FATAL ERROR: Architecture manifest not found at /tmp/x.yaml"),
      );
    });

    const outcome = await adapter.lintManifest("bounded_contexts: []");

    assert.equal(outcome.kind, "unavailable");
    assert.match(
      outcome.kind === "unavailable" ? outcome.reason : "",
      /FATAL ERROR/,
    );
  });

  it("never reports clean from a failed run whose banner it does not recognise", async () => {
    // Fail-closed: if the linter rewords its output, the adapter must degrade
    // toward "unknown", never toward "the architecture is fine".
    const adapter = new CliManifestLintAdapter(ROOT, async () => {
      throw execFailure(line("Architecture check did not pass, sorry"));
    });

    const outcome = await adapter.lintManifest("bounded_contexts: []");

    expect(outcome.kind).not.toBe("clean");
    assert.equal(outcome.kind, "unavailable");
  });

  it("reports a banner with no readable bullets as unavailable rather than clean", async () => {
    const adapter = new CliManifestLintAdapter(ROOT, async () => {
      throw execFailure(line(ARCH_LINT_FAILURE_BANNER));
    });

    const outcome = await adapter.lintManifest("bounded_contexts: []");

    assert.equal(outcome.kind, "unavailable");
    assert.match(
      outcome.kind === "unavailable" ? outcome.reason : "",
      /none could be read/,
    );
  });
});
