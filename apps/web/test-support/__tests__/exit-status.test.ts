// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// GUARD: a run with a failing test must exit non-zero with the Postgres test
// harness loaded.
//
// embedded-postgres registers an exit hook that calls `process.exit(0)` on
// `beforeExit`, which replaced the non-zero status vitest had set: a web run
// with one failing test exited 0, and turbo, the verification hosts and CI all
// read that as a pass. `keepExitCode` in pg-global-setup.ts is what prevents
// it. This test runs THIS FILE in a child vitest, with the app's own config and
// global setup, where the only test fails on purpose; remove the listener and
// the child exits 0 and this test fails.
const CHILD = "HX_EXIT_STATUS_CHILD";

if (process.env[CHILD] === "1") {
  describe("exit status (child run)", () => {
    it("fails on purpose", () => {
      expect("this test").toBe("failing");
    });
  });
} else {
  describe("exit status of a failed run", () => {
    it("a run whose only test fails exits non-zero and says so", () => {
      const here = fileURLToPath(import.meta.url);
      const webRoot = join(dirname(here), "..", "..");
      const require = createRequire(import.meta.url);
      const vitestBin = join(
        dirname(require.resolve("vitest/package.json")),
        "vitest.mjs",
      );
      const child = spawnSync(
        process.execPath,
        [vitestBin, "run", "test-support/__tests__/exit-status.test.ts"],
        {
          cwd: webRoot,
          env: { ...process.env, [CHILD]: "1" },
          encoding: "utf8",
          timeout: 150_000,
        },
      );
      const output = `${child.stdout}\n${child.stderr}`;
      // The child really ran the failing test (so a non-zero status is not a
      // crash or a start-up error)...
      expect(output).toMatch(/1 failed/);
      // ...and the process reported it.
      expect(child.status, output.slice(-2000)).not.toBe(0);
      expect(child.status).not.toBeNull();
    }, 180_000);
  });
}
