import { describe, expect, test } from "vitest";
import { readFrames, FrameTooLargeError } from "../../src/lane-watch/sse.js";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else controller.close();
    },
  });
}

async function collect(chunks: string[], max = 1024): Promise<string[]> {
  const frames: string[] = [];
  for await (const data of readFrames(streamOf(chunks), max)) frames.push(data);
  return frames;
}

describe("readFrames", () => {
  test("yields one data payload per blank-line-terminated frame", async () => {
    expect(await collect(["data: a\n\ndata: b\n\n"])).toEqual(["a", "b"]);
  });

  test("reassembles a frame split across chunks, and CRLF line ends", async () => {
    expect(await collect(["da", "ta: he", "llo\r", "\n\r\n"])).toEqual([
      "hello",
    ]);
  });

  test("joins multi-line data with a newline and ignores other fields", async () => {
    expect(
      await collect([": comment\nevent: x\ndata: 1\ndata: 2\n\n"]),
    ).toEqual(["1\n2"]);
  });

  test("flushes a final frame the server never terminated", async () => {
    expect(await collect(["data: tail"])).toEqual(["tail"]);
  });

  test("a line longer than the cap is refused, not buffered", async () => {
    await expect(
      collect(["data: " + "x".repeat(2000)], 1024),
    ).rejects.toBeInstanceOf(FrameTooLargeError);
  });

  test("a frame whose data lines add up past the cap is refused", async () => {
    const line = "data: " + "x".repeat(400) + "\n";
    await expect(collect([line.repeat(5)], 1024)).rejects.toBeInstanceOf(
      FrameTooLargeError,
    );
  });

  test("many small frames never trip the cap: only the partial line is held", async () => {
    const chunks = Array.from({ length: 5000 }, () => "data: ping\n\n");
    expect((await collect(chunks, 64)).length).toBe(5000);
  });
});
