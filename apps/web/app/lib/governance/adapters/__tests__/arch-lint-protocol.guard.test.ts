/**
 * Cross-file guard: the two literals `CliManifestLintAdapter` parses out of the
 * arch-linter's stderr must still be the literals the arch-linter emits.
 *
 * Same shape as the `MANIFEST_KEY_PATHS` guard PR #487 added for the manifest
 * analyzer, and for the same reason: the analyzer had spent its life reading
 * keys no manifest ever had. A string protocol asserted only against a fixture
 * the same author wrote proves nothing — this reads the producer's source.
 *
 * If a rename here fails, the classifier does NOT silently start reporting
 * every failed run as "unavailable": it fails loudly first.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findMonorepoRoot } from "../../../monorepo-root";
import {
  ARCH_LINT_FAILURE_BANNER,
  ARCH_LINT_LOG_PREFIX,
} from "../cli-manifest-lint.adapter";

const root = findMonorepoRoot();
const read = (relative: string) =>
  readFileSync(path.join(root, relative), "utf-8");

describe("arch-linter stderr protocol", () => {
  it("still prefixes every line with the prefix the adapter strips", () => {
    const logger = read("tools/arch-linter/src/logger.ts");
    // `error: (msg) => console.error(`[arch-lint] ${msg}`)` — the adapter reads
    // stderr, so it is `error`/`warn` (not `info`) that must carry the prefix.
    assert.ok(
      logger.includes("error: (msg) => console.error(`[arch-lint] ${msg}`)"),
      "arch-linter's stderr logger no longer emits the [arch-lint] prefix",
    );
    assert.equal(
      ARCH_LINT_LOG_PREFIX,
      "[arch-lint] ",
      "adapter prefix drifted from the linter's",
    );
  });

  it("still prints the failure banner the adapter keys violations off", () => {
    const cli = read("tools/arch-linter/src/cli.ts");
    assert.ok(
      cli.includes(`logger.error("${ARCH_LINT_FAILURE_BANNER}")`),
      `arch-linter no longer prints "${ARCH_LINT_FAILURE_BANNER}" — the adapter would classify every real violation run as "unavailable"`,
    );
  });

  it("still prints violations as ' - <message>' bullets under that banner", () => {
    const cli = read("tools/arch-linter/src/cli.ts");
    assert.ok(
      cli.includes("fresh.forEach((e) => logger.error(` - ${e.message}`))"),
      "arch-linter changed its violation bullet format; the adapter's parser must follow",
    );
  });

  it("still exits non-zero when violations are found", () => {
    // `clean` is reachable only from a resolved (exit 0) subprocess. If the
    // linter ever stopped exiting 1 on violations, that mapping would become a
    // false green — the exact AUD-005 failure, one layer down.
    const cli = read("tools/arch-linter/src/cli.ts");
    const bannerAt = cli.indexOf(ARCH_LINT_FAILURE_BANNER);
    assert.notEqual(bannerAt, -1);
    const afterBanner = cli.slice(bannerAt, bannerAt + 600);
    assert.ok(
      afterBanner.includes("process.exit(1)"),
      "arch-linter no longer exits 1 after reporting violations",
    );
  });
});
