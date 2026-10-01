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

  test("an unterminated FINAL data line is counted against the cap too", async () => {
    const line = "data: " + "x".repeat(400);
    // Each line fits on its own and the two terminated ones fit together.
    await expect(
      collect([line + "\n" + line + "\n" + line], 1024),
    ).rejects.toBeInstanceOf(FrameTooLargeError);
  });

  test("a final frame that fits is still yielded", async () => {
    expect(await collect(["data: a\ndata: b"], 1024)).toEqual(["a\nb"]);
  });

  test("frames are yielded one at a time, before the rest of the chunk is parsed", async () => {
    // The oversized line after the first frame would throw if the whole chunk
    // were parsed before anything was yielded.
    const chunk = "data: first\n\n" + "data: " + "x".repeat(5000) + "\n";
    const frames: string[] = [];
    for await (const data of readFrames(streamOf([chunk]), 1024)) {
      frames.push(data);
      break;
    }
    expect(frames).toEqual(["first"]);
  });

  test("many small frames in ONE large chunk are all yielded, in order", async () => {
    const chunk = Array.from(
      { length: 20000 },
      (_, i) => `data: ${i}\n\n`,
    ).join("");
    const frames = await collect([chunk], 64);
    expect(frames).toHaveLength(20000);
    expect(frames[0]).toBe("0");
    expect(frames[19999]).toBe("19999");
  });

  test("a frame split exactly on the consumer's return resumes correctly in the next chunk", async () => {
    expect(await collect(["data: a\n\ndata: b", "\n\n"])).toEqual(["a", "b"]);
  });
});
