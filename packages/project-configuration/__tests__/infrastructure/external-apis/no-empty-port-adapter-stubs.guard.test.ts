import assert from "node:assert/strict";
import { describe, it } from "vitest";

// Guard for item 4.6 / HEX-037: the entire `src/infrastructure/external-apis/`
// directory was dead. It held three empty `*PortAdapter` scaffold classes
// (GitProviderPortAdapter, AIProviderPortAdapter, PreviewProviderPortAdapter),
// three more empty external-API scaffolds (BullMQAdapter, DrizzleAdapter,
// GrokAdapter, OpenTelemetryAdapter — the latter two duplicating the real
// classes that live in `llm/` and `telemetry/`), and one real-but-unconsumed
// adapter (JSZipDownloadAdapter, the sole implementer of the otherwise-unused
// DownloadProviderPort). Nothing outside the directory referenced any of it.
//
// The whole directory was removed, not just the empty stubs: leaving even one
// source file behind made `@hexagen/sync` regenerate a `@generated`
// `external-apis/index.ts` barrel (walkDirectory keys off filesystem contents,
// not a manifest) and re-add `export * from "./external-apis/index.js"` to the
// generated `infrastructure/index.ts` — resurrecting the dead surface on every
// sync. Deleting the directory keeps the tree sync-stable.
//
// This guard locks the dead surface out and keeps the live infrastructure
// surface intact. It asserts only symbols UNIQUE to the deleted directory:
// BullMQAdapter, GrokAdapter, and OpenTelemetryAdapter are intentionally
// excluded because real homonyms in `messaging/`, `llm/`, and `telemetry/` are
// legitimately re-exported through the infrastructure barrel.
import * as infrastructure from "../../../src/infrastructure/index.js";

describe("project-configuration external-apis: no dead external-apis stubs (HEX-037)", () => {
  const deadStubExports = [
    "GitProviderPortAdapter",
    "AIProviderPortAdapter",
    "PreviewProviderPortAdapter",
    "DrizzleAdapter",
    "JSZipDownloadAdapter",
  ] as const;

  it("does not export any symbol unique to the deleted external-apis directory", () => {
    for (const symbol of deadStubExports) {
      assert.ok(
        !(symbol in infrastructure),
        `${symbol} should stay deleted with the dead external-apis directory (HEX-037); it is a dead scaffold with no consumers, and re-adding it would reintroduce sync-unstable barrel drift.`,
      );
    }
  });

  it("keeps the retained live infrastructure surface intact", () => {
    assert.equal(
      typeof (infrastructure as Record<string, unknown>).mergeSplitManifest,
      "function",
      "mergeSplitManifest must still be exported from the infrastructure barrel after the stub deletion.",
    );
  });
});
