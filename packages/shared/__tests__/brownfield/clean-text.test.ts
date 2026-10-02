import { describe, it, expect } from "vitest";
import {
  cleanText,
  cleanTextKeepingCrlf,
} from "../../src/types/brownfield/clean-text";

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

describe("cleanTextKeepingCrlf", () => {
  it("keeps CRLF line endings", () => {
    expect(cleanTextKeepingCrlf("a\r\nb\r\n")).toBe("a\r\nb\r\n");
  });
  it("strips a lone CR, even next to a CRLF", () => {
    expect(cleanTextKeepingCrlf("a\rb\r\r\nc\n\r")).toBe("ab\r\nc\n");
  });
  it("still strips every other control character and escape sequence", () => {
    expect(cleanTextKeepingCrlf("a\u001b[31mred\u0007\u0085b\r\n")).toBe(
      "aredb\r\n",
    );
  });
  it("equals cleanText when there is no CR", () => {
    const t = "x\ty\n<b>\u0000z";
    expect(cleanTextKeepingCrlf(t)).toBe(cleanText(t));
  });
});
