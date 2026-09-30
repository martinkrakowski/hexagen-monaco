import { describe, expect, it } from "vitest";
import {
  WAVE_STATUS_PAGE,
  waveStatusPageUrl,
} from "../../src/internal/package-paths.js";

describe("the wave-status page path is pinned in code, not only in comments", () => {
  it("is public/wave-status/index.html, relative to the package root", () => {
    expect(WAVE_STATUS_PAGE).toBe("public/wave-status/index.html");
  });

  it("resolves from a built bin to the package root's public/", () => {
    expect(waveStatusPageUrl("file:///pkg/dist/bins/wave-status.js").href).toBe(
      "file:///pkg/public/wave-status/index.html",
    );
  });

  it("resolves the same from the source bin, which is also two levels down", () => {
    expect(waveStatusPageUrl("file:///pkg/src/bins/wave-status.ts").href).toBe(
      "file:///pkg/public/wave-status/index.html",
    );
  });
});
