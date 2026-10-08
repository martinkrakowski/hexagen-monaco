import { describe, it } from "vitest";
import assert from "node:assert/strict";

import type { ChatMessage } from "@hexagen/local-llm";
import { formatChatTranscript } from "./format-chat-transcript";

describe("formatChatTranscript", () => {
  it("produces a header with count 0 for an empty list", () => {
    const exportedAt = new Date("2026-01-01T12:00:00Z");
    const result = formatChatTranscript([], exportedAt);

    assert.ok(result.includes("# Assistant messages stored in this browser"));
    assert.ok(result.includes("Exported 2026-01-01T12:00:00.000Z"));
    assert.ok(result.includes("0"));
    const lines = result.split("\n");
    assert.strictEqual(lines[0], "# Assistant messages stored in this browser");
    assert.strictEqual(lines[1], "Exported 2026-01-01T12:00:00.000Z");
    assert.strictEqual(lines[2], "Count: 0");
  });

  it("renders a user message with its timestamp and content", () => {
    const messages: ChatMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "Hello",
        timestamp: 1735684800000,
      },
    ];
    const exportedAt = new Date("2026-01-01T12:00:00Z");
    const result = formatChatTranscript(messages, exportedAt);

    const lines = result.split("\n");
    assert.strictEqual(lines[0], "# Assistant messages stored in this browser");
    assert.strictEqual(lines[1], "Exported 2026-01-01T12:00:00.000Z");
    assert.strictEqual(lines[2], "Count: 1");
    assert.ok(
      lines.includes("## User — " + new Date(1735684800000).toISOString()),
    );
    assert.ok(lines.includes("Hello"));
  });

  it("renders an assistant message with its timestamp and content", () => {
    const messages: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Hi there",
        timestamp: 1735684810000,
      },
    ];
    const exportedAt = new Date("2026-01-01T12:00:00Z");
    const result = formatChatTranscript(messages, exportedAt);

    const lines = result.split("\n");
    assert.ok(
      lines.includes("## Assistant — " + new Date(1735684810000).toISOString()),
    );
    assert.ok(lines.includes("Hi there"));
  });

  it("keeps stored order of messages", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "first", timestamp: 1735684800000 },
      {
        id: "a1",
        role: "assistant",
        content: "second",
        timestamp: 1735684810000,
      },
      { id: "u2", role: "user", content: "third", timestamp: 1735684820000 },
    ];
    const exportedAt = new Date("2026-01-01T12:00:00Z");
    const result = formatChatTranscript(messages, exportedAt);

    const lines = result.split("\n");
    const firstIdx = lines.indexOf("first");
    const secondIdx = lines.indexOf("second");
    const thirdIdx = lines.indexOf("third");
    // indexOf gives -1 for a missing line, which would satisfy the comparisons.
    assert.ok(firstIdx >= 0 && secondIdx >= 0 && thirdIdx >= 0);
    assert.ok(firstIdx < secondIdx);
    assert.ok(secondIdx < thirdIdx);
  });

  it("prints an unknown role as-is", () => {
    const messages = [
      {
        id: "system-1",
        role: "system",
        content: "beep",
        timestamp: 1735684800000,
      },
    ] as unknown as ChatMessage[];
    const exportedAt = new Date("2026-01-01T12:00:00Z");
    const result = formatChatTranscript(messages, exportedAt);

    assert.ok(result.includes("## system —"));
    assert.ok(result.includes("beep"));
  });

  it("uses 'time unknown' when timestamp is missing", () => {
    const withoutTimestamp = [
      { id: "u1", role: "user", content: "hi" },
    ] as unknown as ChatMessage[];
    const exportedAt = new Date("2026-01-01T12:00:00Z");
    const result = formatChatTranscript(withoutTimestamp, exportedAt);
    assert.ok(result.includes("time unknown"));
  });

  it("uses 'time unknown' for a timestamp no Date can hold, and still prints the message", () => {
    for (const timestamp of [Infinity, -Infinity, NaN, 8.64e15 + 1]) {
      const result = formatChatTranscript(
        [{ id: "m", role: "user", content: "still here", timestamp }],
        new Date("2026-01-02T03:04:05.000Z"),
      );
      assert.ok(result.includes("time unknown"), String(timestamp));
      assert.ok(result.includes("still here"), String(timestamp));
    }
  });

  it("uses 'time unknown' when timestamp is not a number", () => {
    const messages = [
      {
        id: "u1",
        role: "user",
        content: "hi",
        timestamp: NaN,
      },
    ] as unknown as ChatMessage[];
    const exportedAt = new Date("2026-01-01T12:00:00Z");
    const result = formatChatTranscript(messages, exportedAt);
    assert.ok(result.includes("time unknown"));
  });

  it("includes empty content messages with '(empty)'", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "", timestamp: 1704110400000 },
    ];
    const exportedAt = new Date("2026-01-01T12:00:00Z");
    const result = formatChatTranscript(messages, exportedAt);
    assert.ok(result.includes("(empty)"));
  });

  it("leaves content containing Markdown and backticks untouched", () => {
    const content = "Here is some `code` and a **bold** thing.";
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content, timestamp: 1735684800000 },
    ];
    const exportedAt = new Date("2026-01-01T12:00:00Z");
    const result = formatChatTranscript(messages, exportedAt);
    assert.ok(result.includes("Here is some `code` and a **bold** thing."));
  });

  it("renders non-string content as '(unreadable)'", () => {
    const messages = [
      {
        id: "u1",
        role: "user",
        content: 12345,
        timestamp: 1735684800000,
      },
    ] as unknown as ChatMessage[];
    const exportedAt = new Date("2026-01-01T12:00:00Z");
    const result = formatChatTranscript(messages, exportedAt);
    assert.ok(result.includes("(unreadable)"));
    assert.ok(!result.includes("12345"));
  });

  it("renders a non-object entry as '(unreadable entry)'", () => {
    const messages = ["garbage" as unknown as ChatMessage];
    const exportedAt = new Date("2026-01-01T12:00:00Z");
    const result = formatChatTranscript(messages, exportedAt);
    assert.ok(result.includes("(unreadable entry)"));
  });
});
