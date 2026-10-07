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

describe("cleanText and invisible Unicode format characters", () => {
  // Written with escapes on purpose: the characters under test are invisible,
  // and a literal one in this file would be the very thing the function stops.
  it("strips every bidirectional control, so text is shown in the order it is stored", () => {
    const controls = [
      "\u202a",
      "\u202b",
      "\u202c",
      "\u202d",
      "\u202e", // embeddings, pop, overrides
      "\u2066",
      "\u2067",
      "\u2068",
      "\u2069", // isolates and their pop
      "\u200e",
      "\u200f",
      "\u061c", // direction marks, Arabic letter mark
    ];
    for (const c of controls) {
      expect(cleanText(`a${c}b`)).toBe("ab");
    }
    // The "Trojan Source" shape: an override that displays a comment's tail
    // as if it were code.
    expect(cleanText("if (ok) { /* \u202e } \u2066 */")).toBe(
      "if (ok) { /*  }  */",
    );
  });

  it("strips zero-width characters, so two different names cannot look the same", () => {
    for (const c of ["\u200b", "\u200c", "\u200d", "\u2060", "\ufeff"]) {
      expect(cleanText(`pay${c}load`)).toBe("payload");
    }
  });

  it("keeps visible non-ASCII text, including right-to-left letters themselves", () => {
    const t =
      "caf\u00e9 \u05e9\u05dc\u05d5\u05dd \u0645\u0631\u062d\u0628\u0627 \u65e5\u672c \u{1f600}";
    expect(cleanText(t)).toBe(t);
  });

  it("applies to the CRLF-keeping variant too", () => {
    expect(cleanTextKeepingCrlf("a\u202eb\r\nc\u200bd")).toBe("ab\r\ncd");
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
