/**
 * Toolchain-version contract — the BUILT dist must know its own version via
 * the build-injected constant, not a filesystem lookup (plan PR-A3, RCA #1).
 *
 * The published-layout fixture stages the copied dist next to a package.json
 * whose version is the SENTINEL "0.0.0-contract" (published-layout.ts). That
 * makes the two resolution sources distinguishable:
 *
 *   - pre-A3 dist (`readVersion()`): reads the adjacent package.json →
 *     prints the sentinel — exactly the runtime-lookup behaviour whose
 *     server-bundle variant silently degraded to "0.0.0" pins.
 *   - post-A3 dist: `__HEXAGEN_TOOLCHAIN_VERSION__` is a literal baked in by
 *     tsup `define` → prints the engine's real version; the adjacent file is
 *     never consulted. (Were the define missing, the src fallback would read
 *     the sentinel and THROW — "0.0.0-…" is degenerate — rather than lie.)
 *
 * This pins the define wiring through the real bundle; the generator-level
 * pin emission is covered in generators/root-files.test.ts and the
 * installed-tarball end of the same contract by the capstone pin gate.
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  SKIP_NON_POSIX,
  REPO_ROOT,
  VALID_MANIFEST,
  createPublishedLayoutFixture,
  runHexagen,
  describeResult,
  cleanupFixture,
  assertBuiltArtifactsPresent,
} from "../helpers/published-layout.js";

describe(
  "toolchain-version contract — built dist in published layout",
  { skip: SKIP_NON_POSIX },
  () => {
    before(assertBuiltArtifactsPresent);

    it("hexagen --version reports the build-injected engine version, not the adjacent package.json", async () => {
      const fix = await createPublishedLayoutFixture(
        VALID_MANIFEST,
        "hexagen-version-",
      );
      try {
        const engineVersion = (
          JSON.parse(
            await fs.readFile(
              path.join(REPO_ROOT, "packages", "sync", "package.json"),
              "utf8",
            ),
          ) as { version: string }
        ).version;

        // Precondition: the fixture must still stage the sentinel version.
        // If published-layout.ts ever starts mirroring the real version, this
        // test would silently stop distinguishing define-wins from file-read.
        const staged = (
          JSON.parse(
            await fs.readFile(
              path.join(
                fix.root,
                "node_modules",
                "@hexagen-monaco",
                "sync",
                "package.json",
              ),
              "utf8",
            ),
          ) as { version: string }
        ).version;
        assert.equal(
          staged,
          "0.0.0-contract",
          "fixture precondition: staged package.json must carry the sentinel version",
        );

        const r = await runHexagen(fix, ["--version"]);
        assert.equal(r.code, 0, describeResult(r));
        assert.equal(
          r.stdout.trim(),
          engineVersion,
          `--version must print the build-injected engine version\n${describeResult(r)}`,
        );
      } finally {
        await cleanupFixture(fix.root);
      }
    });
  },
);
