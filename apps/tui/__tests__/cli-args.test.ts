import { describe, expect, it, vi } from "vitest";
import { parseTuiArgs } from "../src/cli-args.js";
import { main } from "../src/main.js";

describe("tui arguments", () => {
  it.each([["--brownfeild"], ["--nope"], ["stray"], ["--brownfield", "--x"]])(
    "rejects %s with usage",
    (...argv) => {
      const args = parseTuiArgs(argv, "/c");
      expect(args.problem).toMatch(/Usage:/);
    },
  );

  it("never starts either view for a typo, and exits through fail", async () => {
    const startBrownfield = vi.fn();
    const startGreenfield = vi.fn(async () => {});
    const fail = vi.fn();
    await main(["--brownfeild"], {
      startBrownfield,
      startGreenfield,
      cwd: "/c",
      fail,
    });
    expect(startGreenfield).not.toHaveBeenCalled();
    expect(startBrownfield).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(expect.stringMatching(/Usage:/));
  });

  it("rejects --workspace-root without --brownfield", () => {
    const args = parseTuiArgs(["--workspace-root", "/x"], "/c");
    expect(args.problem).toMatch(/requires --brownfield/);
  });

  it("accepts the documented forms", () => {
    expect(parseTuiArgs([], "/c")).toMatchObject({ brownfield: false });
    expect(parseTuiArgs(["--brownfield"], "/c").problem).toBeUndefined();
    expect(
      parseTuiArgs(["--brownfield", "--workspace-root=/x"], "/c").problem,
    ).toBeUndefined();
  });
});
