import type {
  RenderManifestPort,
  RenderedManifest,
} from "../../../src/application/ports/in/render-manifest.port";
import type { Manifest } from "../../../src/domain/model/manifest-schema/manifest-schema";

/**
 * In‑memory fake for `RenderManifestPort`.
 * Allows tests to optionally provide a custom implementation for `execute`.
 * Default behavior returns a minimal rendered manifest.
 */
export class FakeRenderManifestPort implements RenderManifestPort {
  private behavior: ((input: Manifest) => Promise<RenderedManifest>) | null =
    null;

  /** Register a custom async implementation for the `execute` method. */
  setBehavior(fn: (input: Manifest) => Promise<RenderedManifest>) {
    this.behavior = fn;
  }

  /** Execute the port – either the custom behavior or a default echo. */
  async execute(input: Manifest): Promise<RenderedManifest> {
    if (this.behavior) {
      return this.behavior(input);
    }
    // Default happy‑path – return a minimal rendered manifest
    return {
      yaml: "system: test-system\nscope: test\narchitecture: hexagonal\n",
      diagnostics: [],
      token: "test-token",
    };
  }
}
