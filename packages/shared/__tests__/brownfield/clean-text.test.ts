import { describe, it, expect } from "vitest";
import { cleanText } from "../../src/types/brownfield/clean-text";

describe("cleanText", () => {
  it("keeps plain text, newlines and tabs", () => {
    expect(cleanText("a\tb\nc <b>x</b>")).toBe("a\tb\nc <b>x</b>");
  });

  it("strips CSI sequences, OSC sequences and lone escapes", () => {
    expect(cleanText("a\u001b[31mred\u001b[0mb")).toBe("aredb");
    expect(cleanText("a\u001b]0;title\u0007b")).toBe("ab");
    expect(cleanText("a\u001b]8;;http://x\u001b\\b")).toBe("ab");
    expect(cleanText("a\u001bb")).toBe("a");
  });

  it("strips C0, DEL and C1 control characters", () => {
    expect(
      cleanText("a\u0000\u0007\u0008\u000b\u000c\u007f\u0085\u009fb"),
    ).toBe("ab");
  });
});
