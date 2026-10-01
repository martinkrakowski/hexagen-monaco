/** Longest a single line, or one frame's data, may grow before the stream is refused. */
export const MAX_FRAME_BYTES = 1024 * 1024;

export class FrameTooLargeError extends Error {
  constructor(limit: number) {
    super(
      `an event stream line or frame exceeded ${limit} bytes: too large to buffer`,
    );
  }
}

/**
 * The `data:` payload of each server-sent-event frame, one at a time.
 *
 * A generator on purpose: a frame is yielded the moment its terminating blank
 * line is parsed and nothing further is read until the consumer asks, so a
 * consumer that returns on a concluding frame never triggers another read. Its
 * `finally` cancels the reader, so that return releases the connection.
 *
 * Memory is bounded: nothing but the current partial line and the current
 * frame's data is held, and either growing past `maxBytes` throws
 * `FrameTooLargeError` rather than buffering without limit.
 */
export async function* readFrames(
  body: ReadableStream<Uint8Array>,
  maxBytes: number = MAX_FRAME_BYTES,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let data: string[] = [];
  let dataBytes = 0;

  /** Feed the complete lines in `pending`; returns frames that finished. */
  const drain = (final: boolean): string[] => {
    const frames: string[] = [];
    // A trailing CR may be the first half of CRLF, so it waits for the next chunk.
    const end =
      final || !pending.endsWith("\r") ? pending.length : pending.length - 1;
    const text = pending.slice(0, end);
    const parts = text.split(/\r\n|\n|\r/);
    const tail = parts.pop() ?? "";
    for (const line of parts) {
      if (line === "") {
        if (data.length > 0) frames.push(data.join("\n"));
        data = [];
        dataBytes = 0;
      } else if (line.startsWith("data:")) {
        const value = line.slice(5).replace(/^ /, "");
        dataBytes += value.length + 1;
        if (dataBytes > maxBytes) throw new FrameTooLargeError(maxBytes);
        data.push(value);
      }
      // Comments (`:`) and other fields (`event:`, `id:`, `retry:`) carry nothing we read.
    }
    pending = pending.slice(end) === "" ? tail : tail + pending.slice(end);
    if (final) {
      if (pending !== "" && pending.startsWith("data:")) {
        data.push(pending.slice(5).replace(/^ /, ""));
      }
      pending = "";
      if (data.length > 0) frames.push(data.join("\n"));
      data = [];
    }
    if (pending.length > maxBytes) throw new FrameTooLargeError(maxBytes);
    return frames;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        pending += decoder.decode();
        for (const frame of drain(true)) yield frame;
        return;
      }
      pending += decoder.decode(value, { stream: true });
      for (const frame of drain(false)) yield frame;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
