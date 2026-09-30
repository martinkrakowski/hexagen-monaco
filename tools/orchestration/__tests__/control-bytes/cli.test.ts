import { describe, test, expect } from "vitest";
import {
  EXIT_UNUSABLE,
  runCli,
  type ControlBytesCliIo,
} from "../../src/control-bytes/cli.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

interface Harness {
  readonly io: ControlBytesCliIo;
  readonly out: string[];
  readonly err: string[];
}

const harness = (
  files: readonly string[] | Error,
  contents: Readonly<Record<string, string | Error>>,
): Harness => {
  const out: string[] = [];
  const err: string[] = [];
  let tick = 0;
  return {
    out,
    err,
    io: {
      log: (text) => out.push(text),
      logError: (text) => err.push(text),
      listFiles: () =>
        files instanceof Error ? Promise.reject(files) : Promise.resolve(files),
      readBytes: (path) => {
        const content = contents[path];
        if (content === undefined) {
          const error: NodeJS.ErrnoException = new Error(
            `ENOENT: no such file, open '${path}'`,
          );
          error.code = "ENOENT";
          return Promise.reject(error);
        }
        return content instanceof Error
          ? Promise.reject(content)
          : Promise.resolve(encode(content));
      },
      // A fixed 7ms step, so the reported runtime is assertable.
      now: () => (tick += 7),
    },
  };
};

describe("runCli", () => {
  test("a clean tree exits 0 and reports what it scanned", async () => {
    const { io, out, err } = harness(["a.ts", "b.md"], {
      "a.ts": 'const x = "\\x00";\n\tconst y = 1;\n',
      "b.md": "# title\n\ntext\n",
    });
    expect(await runCli(io)).toBe(0);
    expect(err).toEqual([]);
    expect(out.join("\n")).toContain("scanned 2 text files in 7ms");
    expect(out.join("\n")).toContain("no raw C0 control bytes. OK");
  });

  test("a raw control byte exits 1 and names the file, line and byte", async () => {
    const { io, out, err } = harness(["a.ts"], {
      "a.ts": 'const x = "\x00";\n',
    });
    expect(await runCli(io)).toBe(1);
    // A failure goes to stderr, where a gate's failures belong.
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain("a.ts:1:12 raw NUL");
  });

  test("files outside the scanned extensions are never read", async () => {
    const read: string[] = [];
    const { io } = harness(["f.ttf", "img.png", "yarn.lock", "a.ts"], {
      "a.ts": "ok\n",
    });
    const spied: ControlBytesCliIo = {
      ...io,
      readBytes: (path) => {
        read.push(path);
        return io.readBytes(path);
      },
    };
    expect(await runCli(spied)).toBe(0);
    expect(read).toEqual(["a.ts"]);
  });

  test("a listing that fails is refused, never read as nothing to check", async () => {
    const { io, err } = harness(new Error("not a git repository"), {});
    expect(await runCli(io)).toBe(EXIT_UNUSABLE);
    expect(err.join("\n")).toContain("cannot list the files to scan");
    expect(err.join("\n")).toContain("not a git repository");
    expect(err.join("\n")).toContain(
      "refusing to report that as nothing to check",
    );
  });

  test("a listing that fails with a non-Error is still refused", async () => {
    const io: ControlBytesCliIo = {
      ...harness([], {}).io,
      listFiles: () => Promise.reject("boom"),
    };
    expect(await runCli(io)).toBe(EXIT_UNUSABLE);
  });

  test("a file that cannot be read is a check that could not look, and fails", async () => {
    const denied: NodeJS.ErrnoException = new Error(
      "EACCES: permission denied, open 'a.ts'",
    );
    denied.code = "EACCES";
    const { io, err } = harness(["a.ts"], { "a.ts": denied });
    expect(await runCli(io)).toBe(EXIT_UNUSABLE);
    expect(err.join("\n")).toContain("cannot read a.ts");
    expect(err.join("\n")).toContain("permission denied");
  });

  test("a non-Error read failure is refused too", async () => {
    const io: ControlBytesCliIo = {
      ...harness(["a.ts"], {}).io,
      readBytes: () => Promise.reject("boom"),
    };
    expect(await runCli(io)).toBe(EXIT_UNUSABLE);
  });

  test("a file listed in the index but deleted from the tree is skipped and named", async () => {
    // `git ls-files --cached` still lists a file removed with a plain `rm`. It has
    // no bytes to be wrong, so skipping it is sound — but saying nothing is not.
    const { io, out } = harness(["gone.ts", "a.ts"], { "a.ts": "ok\n" });
    expect(await runCli(io)).toBe(0);
    expect(out.join("\n")).toContain("1 listed file(s) absent");
    expect(out.join("\n")).toContain("gone.ts");
    expect(out.join("\n")).toContain("scanned 1 text files");
  });

  test("an empty listing is refused rather than reported as a pass it did not make", async () => {
    // Exit 0 here would print "scanned 0 text files ... OK" and read as green.
    // This repo's text-file set cannot legitimately be empty; zero in scope means
    // the listing did not look.
    const { io, out, err } = harness([], {});
    expect(await runCli(io)).toBe(EXIT_UNUSABLE);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain("no text files to scan");
    expect(err.join("\n")).toContain(
      "refusing to report that as nothing to check",
    );
  });

  test("a listing of only unscanned kinds is refused for the same reason", async () => {
    // The nastier shape of the same fault: the listing worked, and every path in
    // it fell outside the allowlist — so nothing was read and nothing was wrong.
    const { io } = harness(["a.ttf", "b.png"], {});
    expect(await runCli(io)).toBe(EXIT_UNUSABLE);
  });
});
