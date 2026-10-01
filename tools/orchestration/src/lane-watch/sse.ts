/** Longest a single line, or one frame's data, may grow before the stream is refused. */
export const MAX_FRAME_CHARS = 1024 * 1024;

export class FrameTooLargeError extends Error {
  constructor(limit: number) {
    super(
      `an event stream line or frame exceeded ${limit} characters: too large to buffer`,
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
 * frame's data is held, and either growing past `maxChars` throws
 * `FrameTooLargeError` rather than buffering without limit.
 */
export async function* readFrames(
  body: ReadableStream<Uint8Array>,
  maxChars: number = MAX_FRAME_CHARS,
): AsyncGenerator<string, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let data: string[] = [];
  let dataChars = 0;

  /** One data line, with the same accounting whether or not it was terminated. */
  const addData = (line: string): void => {
    const value = line.slice(5).replace(/^ /, "");
    dataChars += value.length + 1;
    if (dataChars > maxChars) throw new FrameTooLargeError(maxChars);
    data.push(value);
  };

  /**
   * Parse `pending` one line at a time, yielding each frame the moment its blank
   * line is reached. Nothing past the yielded frame is looked at until the
   * consumer asks again, so a consumer that returns on a frame never has the
   * rest of the chunk parsed (or refused) on its behalf.
   */
  function* consume(final: boolean): Generator<string, void, void> {
    const terminator = /\r\n|\n|\r/g;
    let position = 0;
    try {
      for (;;) {
        terminator.lastIndex = position;
        const found = terminator.exec(pending);
        // A trailing CR may be the first half of CRLF, so it waits for the next chunk.
        if (
          found === null ||
          (!final && found[0] === "\r" && found.index === pending.length - 1)
        ) {
          break;
        }
        const line = pending.slice(position, found.index);
        position = found.index + found[0].length;
        if (line === "") {
          if (data.length > 0) {
            const frame = data.join("\n");
            data = [];
            dataChars = 0;
            yield frame;
          }
        } else if (line.startsWith("data:")) {
          addData(line);
        }
        // Comments (`:`) and other fields (`event:`, `id:`, `retry:`) carry nothing we read.
      }
    } finally {
      // Runs on a normal end AND when the consumer returns mid-chunk.
      pending = pending.slice(position);
    }
    if (final) {
      if (pending.startsWith("data:")) addData(pending);
      pending = "";
      if (data.length > 0) {
        const frame = data.join("\n");
        data = [];
        dataChars = 0;
        yield frame;
      }
    } else if (pending.length > maxChars) {
      throw new FrameTooLargeError(maxChars);
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        pending += decoder.decode();
        yield* consume(true);
        return;
      }
      pending += decoder.decode(value, { stream: true });
      yield* consume(false);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
