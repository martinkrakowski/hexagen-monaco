import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as syncUseCases from "../../src/application/use-cases/index.js";

/**
 * Guard for architecture-remediation item 4.1 (findings HEX-006 / HEX-007).
 *
 * ADR-0047 deletes the dead duplicate `ProjectConfigurationReadPort` copies and
 * the production-dead `GetManifestResourceUseCase` in @hexagen/sync (its only
 * reference was this package's `resource-use-cases.test.ts`, never a composition
 * root). This guard reddens on `main` (pre-deletion, where the class is still
 * re-exported from the use-cases barrel) and greens after the deletion lands.
 *
 * `GetManifestResourceUseCase` is a *class* (runtime value), so a runtime
 * `in`-check on the surviving barrel is a faithful membership assertion — unlike
 * the type-only port interfaces, which erase at compile time.
 */
describe("HEX-006/007 guard: dead manifest-resource chain removed from @hexagen/sync", () => {
  it("no longer re-exports the deleted GetManifestResourceUseCase", () => {
    assert.ok(
      !("GetManifestResourceUseCase" in syncUseCases),
      "GetManifestResourceUseCase must not be re-exported from the sync use-cases barrel after 4.1; it and its port were production-dead (ADR-0047).",
    );
  });

  it("still re-exports the genuinely-live sibling resource use cases (anchor)", () => {
    // Live-surface anchors: guarantees the guard can't pass merely because the
    // barrel failed to load. These siblings are intentionally retained.
    assert.ok(
      "GetArchitectureGraphUseCase" in syncUseCases,
      "GetArchitectureGraphUseCase is live and must remain exported.",
    );
    assert.ok(
      "GetLinterReportUseCase" in syncUseCases,
      "GetLinterReportUseCase is live and must remain exported.",
    );
    assert.ok(
      "MigrateManifestUseCase" in syncUseCases,
      "MigrateManifestUseCase is live and must remain exported.",
    );
  });
});
