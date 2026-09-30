import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";

/**
 * wave-status's ported page tests (OW3c) use happy-dom's `Window` and its
 * `getComputedStyle`; rewriting them onto jsdom would not be a faithful port.
 * The dependency is declared here, in OW3a's package.json, because a later lane
 * may not edit it. This is the smoke test that it resolves and parses.
 */
describe("happy-dom", () => {
  it("parses a fragment", () => {
    const window = new Window();
    window.document.body.innerHTML = "<p>x</p>";
    expect(window.document.querySelector("p")?.textContent).toBe("x");
    window.close();
  });
});
