import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateCommand } from "../../../src/commands/arch/validate.js";

/**
 * The one machine-readable line the real linter prints in --json mode.
 * validateCommand always invokes the linter with --json (H2a review fix 1b),
 * so the fake emits it by default; `emitJsonLine: false` simulates a linter
 * that crashes or prints nothing.
 * `exitCode` 0 = compliant, 1 = violations, anything else = could not run.
 */
const FAKE_LINT_LINE =
  '{"schemaVersion":1,"fresh":[],"baselined":[],"stale":[],"expired":[],"introduced":[],"baselineGrowth":[],"filesScanned":1}';

async function installFakeLinter(
  dir: string,
  exitCode = 0,
  emitJsonLine = true,
): Promise<void> {
  const binDir = path.join(dir, "node_modules", ".bin");
  await fs.mkdir(binDir, { recursive: true });
  if (process.platform === "win32") {
    const echo = emitJsonLine ? `echo ${FAKE_LINT_LINE}\r\n` : "";
    await fs.writeFile(
      path.join(binDir, "hexagen-lint.cmd"),
      `@echo off\r\n${echo}exit /b ${exitCode}\r\n`,
    );
  } else {
    const echo = emitJsonLine ? `echo '${FAKE_LINT_LINE}'\n` : "";
    const bin = path.join(binDir, "hexagen-lint");
    await fs.writeFile(bin, `#!/bin/sh\n${echo}exit ${exitCode}\n`);
    await fs.chmod(bin, 0o755);
  }
}

const validManifestYaml = `
system: hexagen-monaco
scope: hexagen
architecture: modular-monolith
bounded_contexts:
  - name: shared
    type: shared-kernel
    layers:
      domain:
        entities:
          - Entity1
`;

async function makeTempProject(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-test-"));
  const archDir = path.join(tempDir, ".architecture");
  await fs.mkdir(archDir, { recursive: true });
  await fs.writeFile(
    path.join(archDir, "manifest.yaml"),
    validManifestYaml,
    "utf8",
  );
  return tempDir;
}

interface Capture {
  logs: string[];
  warnings: string[];
  errors: string[];
  stdoutLines: string[];
  stderrLines: string[];
}

/**
 * Install a fake linter, capture console/stdout/stderr/exitCode, run `fn`,
 * and restore everything in `finally`. `process.exitCode` is reset both before
 * and after every case so no state leaks between tests.
 */
async function withHarness<T>(
  tempDir: string,
  exitCode: number,
  fn: (capture: Capture) => Promise<T>,
  emitJsonLine = true,
): Promise<T> {
  const originalCwd = process.cwd;
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const capture: Capture = {
    logs: [],
    warnings: [],
    errors: [],
    stdoutLines: [],
    stderrLines: [],
  };

  try {
    console.log = (...args: unknown[]) =>
      capture.logs.push(args.map(String).join(" "));
    console.warn = (...args: unknown[]) =>
      capture.warnings.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) =>
      capture.errors.push(args.map(String).join(" "));
    (process.stdout.write as unknown) = (chunk: unknown) => {
      capture.stdoutLines.push(String(chunk));
      return true;
    };
    (process.stderr.write as unknown) = (chunk: unknown) => {
      capture.stderrLines.push(String(chunk));
      return true;
    };
    (process.cwd as () => string) = () => tempDir;
    process.exitCode = undefined;

    await installFakeLinter(tempDir, exitCode, emitJsonLine);
    return await fn(capture);
  } finally {
    process.cwd = originalCwd;
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exitCode = undefined;
  }
}

describe("validateCommand", () => {
  it("should pass when linter succeeds", async () => {
    const tempDir = await makeTempProject();
    try {
      await withHarness(tempDir, 0, async ({ logs }) => {
        await validateCommand();
        assert.equal(process.exitCode, 0);
        assert.ok(logs.join("\n").includes("Architecture is compliant"));
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fake exit 1, human mode: exitCode 1 and warnings contain 'Architecture violations detected'", async () => {
    const tempDir = await makeTempProject();
    try {
      await withHarness(tempDir, 1, async ({ warnings }) => {
        await validateCommand();
        assert.equal(process.exitCode, 1);
        assert.ok(
          warnings.join("\n").includes("Architecture violations detected"),
        );
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fake exit 2, human mode: exitCode 2 and errors contain 'Could not run the architecture linter'", async () => {
    const tempDir = await makeTempProject();
    try {
      await withHarness(tempDir, 2, async ({ errors }) => {
        await validateCommand();
        assert.equal(process.exitCode, 2);
        assert.ok(
          errors.join("\n").includes("Could not run the architecture linter"),
        );
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fake exit 1 with no line, human mode: exitCode 2 and errors contain 'Could not run the architecture linter'", async () => {
    const tempDir = await makeTempProject();
    try {
      await withHarness(
        tempDir,
        1,
        async ({ errors }) => {
          await validateCommand();
          assert.equal(process.exitCode, 2);
          assert.ok(
            errors.join("\n").includes("Could not run the architecture linter"),
          );
          assert.ok(
            errors
              .join("\n")
              .includes("exited 1 but printed no readable JSON line"),
          );
        },
        false,
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fake exit 0 with --json and no JSON printed: exitCode 2 and one could-not-run stdout line", async () => {
    const tempDir = await makeTempProject();
    try {
      await withHarness(
        tempDir,
        0,
        async ({ stdoutLines }) => {
          await validateCommand({ json: true });
          assert.equal(process.exitCode, 2);
          assert.equal(stdoutLines.length, 1);
          const parsed = JSON.parse(stdoutLines[0]) as { status: string };
          assert.equal(parsed.status, "could-not-run");
        },
        false,
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
