/**
 * Wiring guard.
 *
 * The handler tests inject fakes, so nothing there would notice if
 * `wire.server.ts` stopped handing the routes a real adapter — the classic hole
 * that opens when I/O moves behind a port. This test loads the real composition
 * root and asserts the two governance getters return the concrete adapters,
 * memoized. No port is faked anywhere in this file; the one stub is
 * `process.cwd()`, to reach the packaging failure the degraded-root case exists
 * for without deleting the repository's own manifest.
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import { MonorepoRootNotFoundError } from "../../monorepo-root";
import { getGovernanceSuggestions, getManifestLint } from "../../wire.server";
import { CliManifestLintAdapter } from "../adapters/cli-manifest-lint.adapter";
import { LlmSuggestionAdapter } from "../adapters/llm-suggestion.adapter";

describe("governance composition root", () => {
  it("wires ManifestLintPort to the CLI adapter", () => {
    assert.ok(getManifestLint() instanceof CliManifestLintAdapter);
  });

  it("wires SuggestionPort to the LLM adapter", () => {
    assert.ok(getGovernanceSuggestions() instanceof LlmSuggestionAdapter);
  });

  it("memoizes both, so a request does not re-resolve the monorepo root", () => {
    assert.equal(getManifestLint(), getManifestLint());
    assert.equal(getGovernanceSuggestions(), getGovernanceSuggestions());
  });

  it("returns an unavailable port, not a throw, when the monorepo root cannot be resolved", async () => {
    // A throw from `getManifestLint()` is a framework 500 that bypasses the
    // `unavailable` outcome the port exists to populate. Reachable in the
    // standalone image: `apps/web/Dockerfile`'s runtime stage copies only
    // `.next/standalone` and `.next/static`, so there is no `.architecture/`
    // marker to walk up to.
    // The filesystem root: `findMonorepoRoot` walks up from here, finds no
    // `.architecture/manifest.yaml`, and hits its `parent === current` stop.
    const filesystemRoot = path.parse(process.cwd()).root;
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(filesystemRoot);
    vi.resetModules();
    try {
      const wire = await import("../../wire.server");
      const port = wire.getManifestLint();
      const outcome = await port.lintManifest("bounded_contexts: []");
      assert.deepEqual(outcome, {
        kind: "unavailable",
        // Path-free: the detailed message embeds an absolute server path.
        reason: MonorepoRootNotFoundError.clientMessage,
      });
    } finally {
      cwd.mockRestore();
      vi.resetModules();
    }
  });
});
