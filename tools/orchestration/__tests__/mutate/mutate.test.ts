import { describe, expect, test, vi } from "vitest";
import {
  parseArgs,
  countOccurrences,
  applyMutation,
  runMutation,
  formatReport,
  RefusalError,
} from "../../src/mutate/lib/mutate.js";
import type {
  MutationDeps,
  ParsedMutateArgs,
} from "../../src/mutate/lib/types.js";

function makeFakeDeps(
  files: Record<string, string | Buffer> = {},
  commandResult: { exitCode: number; stdout: string; stderr: string } = {
    exitCode: 0,
    stdout: "",
    stderr: "",
  },
  overrides: Partial<MutationDeps> = {},
) {
  const store = new Map<string, Buffer>();
  for (const [path, content] of Object.entries(files)) {
    store.set(
      path,
      typeof content === "string" ? Buffer.from(content, "utf8") : content,
    );
  }

  const readFile = vi.fn(async (path: string) => {
    const buf = store.get(path);
    if (!buf) throw new Error(`ENOENT: ${path}`);
    return buf.toString("utf8");
  });

  const readFileBuffer = vi.fn(async (path: string) => {
    const buf = store.get(path);
    if (!buf) throw new Error(`ENOENT: ${path}`);
    return Buffer.from(buf);
  });

  const writeFileBuffer = vi.fn(async (path: string, content: Buffer) => {
    store.set(path, Buffer.from(content));
  });

  const execute = vi.fn(
    async (): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
      return commandResult;
    },
  );

  const deps: MutationDeps = {
    readFile,
    readFileBuffer,
    writeFileBuffer,
    execute,
    ...overrides,
  };

  return { deps, store, readFile, readFileBuffer, writeFileBuffer, execute };
}

describe("parseArgs", () => {
  test("parses valid separated arguments", () => {
    const args = parseArgs([
      "--file",
      "src/foo.ts",
      "--before",
      "before.txt",
      "--after",
      "after.txt",
      "--because",
      "fixes edge case",
      "--",
      "yarn",
      "test",
    ]);
    expect(args).toEqual({
      file: "src/foo.ts",
      before: "before.txt",
      after: "after.txt",
      because: "fixes edge case",
      command: ["yarn", "test"],
    });
  });

  test("parses valid flags using '=' syntax", () => {
    const args = parseArgs([
      "--file=src/foo.ts",
      "--before=before.txt",
      "--after=after.txt",
      "--because=test reason",
      "--",
      "vitest",
      "run",
    ]);
    expect(args).toEqual({
      file: "src/foo.ts",
      before: "before.txt",
      after: "after.txt",
      because: "test reason",
      command: ["vitest", "run"],
    });
  });

  test("refuses when '--' separator is missing", () => {
    expect(() => parseArgs(["--file", "a.ts"])).toThrow(RefusalError);
    expect(() => parseArgs(["--file", "a.ts"])).toThrow(
      /missing '--' separator/,
    );
  });

  test("refuses when command after '--' is empty", () => {
    expect(() =>
      parseArgs([
        "--file",
        "a",
        "--before",
        "b",
        "--after",
        "c",
        "--because",
        "d",
        "--",
      ]),
    ).toThrow(/missing command after '--'/);
  });

  test("refuses when required flags are missing", () => {
    expect(() =>
      parseArgs([
        "--before",
        "b",
        "--after",
        "c",
        "--because",
        "d",
        "--",
        "test",
      ]),
    ).toThrow(/missing required flag --file/);

    expect(() =>
      parseArgs([
        "--file",
        "a",
        "--after",
        "c",
        "--because",
        "d",
        "--",
        "test",
      ]),
    ).toThrow(/missing required flag --before/);

    expect(() =>
      parseArgs([
        "--file",
        "a",
        "--before",
        "b",
        "--because",
        "d",
        "--",
        "test",
      ]),
    ).toThrow(/missing required flag --after/);

    expect(() =>
      parseArgs(["--file", "a", "--before", "b", "--after", "c", "--", "test"]),
    ).toThrow(/missing required flag --because/);
  });

  test("refuses missing or invalid values for flags", () => {
    expect(() => parseArgs(["--file", "--before", "b", "--", "test"])).toThrow(
      /--file requires a path/,
    );
    expect(() => parseArgs(["--file", "", "--", "test"])).toThrow(
      /--file requires a path/,
    );
    expect(() => parseArgs(["--file=", "--", "test"])).toThrow(
      /--file requires a path/,
    );
    expect(() => parseArgs(["--file=-flag", "--", "test"])).toThrow(
      /--file requires a path/,
    );

    expect(() => parseArgs(["--before", "--after", "c", "--", "test"])).toThrow(
      /--before requires a path/,
    );
    expect(() => parseArgs(["--before", "", "--", "test"])).toThrow(
      /--before requires a path/,
    );
    expect(() => parseArgs(["--before=", "--", "test"])).toThrow(
      /--before requires a path/,
    );
    expect(() => parseArgs(["--before=-flag", "--", "test"])).toThrow(
      /--before requires a path/,
    );

    expect(() => parseArgs(["--after", "--file", "f", "--", "test"])).toThrow(
      /--after requires a path/,
    );
    expect(() => parseArgs(["--after", "", "--", "test"])).toThrow(
      /--after requires a path/,
    );
    expect(() => parseArgs(["--after=", "--", "test"])).toThrow(
      /--after requires a path/,
    );
    expect(() => parseArgs(["--after=-flag", "--", "test"])).toThrow(
      /--after requires a path/,
    );

    expect(() => parseArgs(["--because", "--", "test"])).toThrow(
      /missing required flag --because/,
    );
  });

  test("refuses a --because value starting with '-'", () => {
    expect(() =>
      parseArgs([
        "--file",
        "a",
        "--before",
        "b",
        "--after",
        "c",
        "--because",
        "-flag",
        "--",
        "test",
      ]),
    ).toThrow(/--because value cannot start with '-'/);
    expect(() =>
      parseArgs([
        "--file",
        "a",
        "--before",
        "b",
        "--after",
        "c",
        "--because",
        "--other-flag",
        "--",
        "test",
      ]),
    ).toThrow(/--because value cannot start with '-'/);
    expect(() =>
      parseArgs([
        "--file",
        "a",
        "--before",
        "b",
        "--after",
        "c",
        "--because=-flag",
        "--",
        "test",
      ]),
    ).toThrow(/--because value cannot start with '-'/);
  });

  test("refuses empty or whitespace-only --because", () => {
    expect(() =>
      parseArgs([
        "--file",
        "a",
        "--before",
        "b",
        "--after",
        "c",
        "--because",
        "",
        "--",
        "test",
      ]),
    ).toThrow(/--because cannot be empty/);
    expect(() =>
      parseArgs([
        "--file",
        "a",
        "--before",
        "b",
        "--after",
        "c",
        "--because",
        "   ",
        "--",
        "test",
      ]),
    ).toThrow(/--because cannot be empty/);
    expect(() =>
      parseArgs([
        "--file",
        "a",
        "--before",
        "b",
        "--after",
        "c",
        "--because=",
        "--",
        "test",
      ]),
    ).toThrow(/--because cannot be empty/);
    expect(() =>
      parseArgs([
        "--file",
        "a",
        "--before",
        "b",
        "--after",
        "c",
        "--because=   ",
        "--",
        "test",
      ]),
    ).toThrow(/--because cannot be empty/);
  });

  test("refuses multi-line --because", () => {
    expect(() =>
      parseArgs([
        "--file",
        "a",
        "--before",
        "b",
        "--after",
        "c",
        "--because",
        "line 1\nline 2",
        "--",
        "test",
      ]),
    ).toThrow(/--because must be a single line/);

    expect(() =>
      parseArgs([
        "--file",
        "a",
        "--before",
        "b",
        "--after",
        "c",
        "--because",
        "line 1\r\nline 2",
        "--",
        "test",
      ]),
    ).toThrow(/--because must be a single line/);
  });

  test("refuses unknown arguments", () => {
    expect(() => parseArgs(["--unknown", "val", "--", "test"])).toThrow(
      /unknown argument: "--unknown"/,
    );
  });
});

describe("countOccurrences", () => {
  test("returns 0 for empty substring", () => {
    expect(countOccurrences("some content", "")).toBe(0);
  });

  test("counts non-overlapping occurrences", () => {
    expect(countOccurrences("abc abc abc", "abc")).toBe(3);
    expect(countOccurrences("abc abc abc", "xyz")).toBe(0);
    expect(countOccurrences("aaaa", "aa")).toBe(2);
  });
});

describe("applyMutation", () => {
  test("applies a literal replacement without regex interpretation", () => {
    const original = "const x = $1 && [^;]*;";
    const before = "$1 && [^;]*";
    const after = "$$2 || (foo)";
    const mutated = applyMutation(original, before, after, "file.ts");
    expect(mutated).toBe("const x = $$2 || (foo);");
  });

  test("refuses empty before-text (Rule 3)", () => {
    expect(() => applyMutation("content", "", "after", "file.ts")).toThrow(
      /Refusal \(Rule 3\): before-text is empty/,
    );
  });

  test("refuses identical before and after text (Rule 3 no-op)", () => {
    expect(() =>
      applyMutation("const x = 1;", "const x = 1;", "const x = 1;", "file.ts"),
    ).toThrow(
      /Refusal \(Rule 3\): before-text and after-text are identical; a no-op is not a mutation/,
    );
  });

  test("refuses absent before-text (Rule 2)", () => {
    expect(() =>
      applyMutation("const x = 1;", "const y = 2;", "const y = 3;", "file.ts"),
    ).toThrow(
      /Refusal \(Rule 2\): before-text not found in file\.ts \(0 occurrences\)/,
    );
  });

  test("refuses ambiguous before-text with its count (Rule 2)", () => {
    expect(() =>
      applyMutation(
        "return true; return true;",
        "return true;",
        "return false;",
        "file.ts",
      ),
    ).toThrow(
      /Refusal \(Rule 2\): before-text is ambiguous: found 2 occurrences in file\.ts \(must be exactly one\)/,
    );

    expect(() => applyMutation("foo foo foo", "foo", "bar", "file.ts")).toThrow(
      /Refusal \(Rule 2\): before-text is ambiguous: found 3 occurrences in file\.ts \(must be exactly one\)/,
    );
  });
});

describe("runMutation", () => {
  const baseArgs: ParsedMutateArgs = {
    file: "target.ts",
    before: "before.txt",
    after: "after.txt",
    because: "inverting boolean flag",
    command: ["yarn", "test"],
  };

  test("verdict caught: command exits non-zero and file is restored byte-identical", async () => {
    const originalBytes = Buffer.from("export const flag = true;\n");
    const { deps, store } = makeFakeDeps(
      {
        "target.ts": originalBytes,
        "before.txt": "flag = true",
        "after.txt": "flag = false",
      },
      { exitCode: 1, stdout: "1 test failed", stderr: "" },
    );

    const result = await runMutation(baseArgs, deps);
    expect(result.exitCode).toBe(1);
    expect(result.verdict).toBe("caught");
    expect(result.because).toBe("inverting boolean flag");
    expect(result.stdout).toBe("1 test failed");

    // Byte-identical restoration check
    expect(store.get("target.ts")?.equals(originalBytes)).toBe(true);
  });

  test("verdict survived: command exits 0 and file is restored byte-identical", async () => {
    const originalBytes = Buffer.from("export const flag = true;\n");
    const { deps, store } = makeFakeDeps(
      {
        "target.ts": originalBytes,
        "before.txt": "flag = true",
        "after.txt": "flag = false",
      },
      { exitCode: 0, stdout: "all tests passed", stderr: "" },
    );

    const result = await runMutation(baseArgs, deps);
    expect(result.exitCode).toBe(0);
    expect(result.verdict).toBe("survived");
    expect(result.because).toBe("inverting boolean flag");

    // Byte-identical restoration check
    expect(store.get("target.ts")?.equals(originalBytes)).toBe(true);
  });

  test("verdict caught when output says '0 failed' but exit code is non-zero", async () => {
    const originalBytes = Buffer.from("export const flag = true;\n");
    const { deps, store } = makeFakeDeps(
      {
        "target.ts": originalBytes,
        "before.txt": "flag = true",
        "after.txt": "flag = false",
      },
      {
        exitCode: 1,
        stdout: "Tests: 10 passed, 0 failed\nUnhandled error",
        stderr: "",
      },
    );

    const result = await runMutation(baseArgs, deps);
    expect(result.exitCode).toBe(1);
    expect(result.verdict).toBe("caught");

    // Byte-identical restoration check
    expect(store.get("target.ts")?.equals(originalBytes)).toBe(true);
  });

  test("file is byte-identical when command throws", async () => {
    const originalBytes = Buffer.from("export const flag = true;\n");
    const { deps, store } = makeFakeDeps(
      {
        "target.ts": originalBytes,
        "before.txt": "flag = true",
        "after.txt": "flag = false",
      },
      { exitCode: 0, stdout: "", stderr: "" },
      {
        execute: vi.fn(async () => {
          throw new Error("command process crashed unexpectedly");
        }),
      },
    );

    await expect(runMutation(baseArgs, deps)).rejects.toThrow(
      "command process crashed unexpectedly",
    );
    expect(store.get("target.ts")?.equals(originalBytes)).toBe(true);
  });

  test("refusal when target file cannot be read", async () => {
    const { deps } = makeFakeDeps({
      "before.txt": "a",
      "after.txt": "b",
    });

    await expect(runMutation(baseArgs, deps)).rejects.toThrow(
      /Refusal \(Rule 1\): failed to read target file/,
    );
  });

  test("refusal when before file cannot be read", async () => {
    const { deps } = makeFakeDeps({
      "target.ts": "content",
      "after.txt": "b",
    });

    await expect(runMutation(baseArgs, deps)).rejects.toThrow(
      /Refusal \(Rule 1\): failed to read before-file/,
    );
  });

  test("refusal when after file cannot be read", async () => {
    const { deps } = makeFakeDeps({
      "target.ts": "content",
      "before.txt": "content",
    });

    await expect(runMutation(baseArgs, deps)).rejects.toThrow(
      /Refusal \(Rule 1\): failed to read after-file/,
    );
  });

  test("refusal when read throws a non-Error value", async () => {
    const { deps } = makeFakeDeps(
      {},
      { exitCode: 0, stdout: "", stderr: "" },
      {
        readFileBuffer: vi.fn(async () => {
          throw "raw string error";
        }),
        readFile: vi.fn(async () => {
          throw "raw string error";
        }),
      },
    );

    await expect(runMutation(baseArgs, deps)).rejects.toThrow(
      "raw string error",
    );

    const { deps: depsBefore } = makeFakeDeps(
      { "target.ts": "content" },
      { exitCode: 0, stdout: "", stderr: "" },
      {
        readFile: vi.fn(async (p: string) => {
          if (p === "before.txt") throw "before string error";
          return "";
        }),
      },
    );
    await expect(runMutation(baseArgs, depsBefore)).rejects.toThrow(
      "before string error",
    );

    const { deps: depsAfter } = makeFakeDeps(
      { "target.ts": "content", "before.txt": "b" },
      { exitCode: 0, stdout: "", stderr: "" },
      {
        readFile: vi.fn(async (p: string) => {
          if (p === "before.txt") return "b";
          if (p === "after.txt") throw "after string error";
          return "";
        }),
      },
    );
    await expect(runMutation(baseArgs, depsAfter)).rejects.toThrow(
      "after string error",
    );
  });

  test("restore write failure rejects loudly with RefusalError (Rule 6) and does not return verdict", async () => {
    const originalBytes = Buffer.from("export const flag = true;\n");
    let writes = 0;
    const { deps } = makeFakeDeps(
      {
        "target.ts": originalBytes,
        "before.txt": "flag = true",
        "after.txt": "flag = false",
      },
      { exitCode: 0, stdout: "", stderr: "" },
      {
        writeFileBuffer: vi.fn(async (): Promise<void> => {
          writes++;
          if (writes > 1) throw new Error("restore disk error");
        }),
      },
    );

    await expect(runMutation(baseArgs, deps)).rejects.toThrow(
      /Refusal \(Rule 6\): failed to restore target\.ts: restore disk error\. Target file is left mutated; original content was recoverable from the pre-mutation buffer\./,
    );
  });

  test("restore write failure with non-Error value rejects loudly", async () => {
    const originalBytes = Buffer.from("export const flag = true;\n");
    let writes = 0;
    const { deps } = makeFakeDeps(
      {
        "target.ts": originalBytes,
        "before.txt": "flag = true",
        "after.txt": "flag = false",
      },
      { exitCode: 0, stdout: "", stderr: "" },
      {
        writeFileBuffer: vi.fn(async (): Promise<void> => {
          writes++;
          if (writes > 1) throw "raw restore write string error";
        }),
      },
    );

    await expect(runMutation(baseArgs, deps)).rejects.toThrow(
      /Refusal \(Rule 6\): failed to restore target\.ts: raw restore write string error/,
    );
  });

  test("interrupted mutation write still triggers restore path (Rule 6)", async () => {
    const originalBytes = Buffer.from("export const flag = true;\n");
    const writes: Buffer[] = [];
    const { deps, store } = makeFakeDeps(
      {
        "target.ts": originalBytes,
        "before.txt": "flag = true",
        "after.txt": "flag = false",
      },
      { exitCode: 0, stdout: "", stderr: "" },
      {
        writeFileBuffer: vi.fn(async (path: string, content: Buffer) => {
          writes.push(Buffer.from(content));
          if (writes.length === 1) {
            // First write: simulated crash/interruption during mutation write
            throw new Error("interrupted write during mutation");
          }
          store.set(path, Buffer.from(content));
        }),
      },
    );

    await expect(runMutation(baseArgs, deps)).rejects.toThrow(
      "interrupted write during mutation",
    );
    // Restore was still attempted and original file was restored
    expect(writes.length).toBe(2);
    expect(writes[1]?.equals(originalBytes)).toBe(true);
    expect(store.get("target.ts")?.equals(originalBytes)).toBe(true);
  });

  test("refusal when file did not change on disk after writing (Rule 4)", async () => {
    const originalBytes = Buffer.from("export const flag = true;\n");
    const { deps, store } = makeFakeDeps(
      {
        "target.ts": originalBytes,
        "before.txt": "flag = true",
        "after.txt": "flag = false",
      },
      { exitCode: 0, stdout: "", stderr: "" },
      {
        writeFileBuffer: vi.fn(async () => {
          // simulate write failure / no-op where file on disk does not change
        }),
      },
    );

    await expect(runMutation(baseArgs, deps)).rejects.toThrow(
      /Refusal \(Rule 4\): file target\.ts did not change after writing mutation/,
    );
    expect(store.get("target.ts")?.equals(originalBytes)).toBe(true);
  });

  test("refusal when file on disk differs from both original and intended mutation (Rule 4)", async () => {
    const originalBytes = Buffer.from("export const flag = true;\n");
    const { deps, store } = makeFakeDeps(
      {
        "target.ts": originalBytes,
        "before.txt": "flag = true",
        "after.txt": "flag = false",
      },
      { exitCode: 0, stdout: "", stderr: "" },
      {
        readFile: vi.fn(async (path: string) => {
          if (path === "before.txt") return "flag = true";
          if (path === "after.txt") return "flag = false";
          // Simulate external formatter or concurrent write producing third content
          return "export const flag = 'concurrent-lane-write';\n";
        }),
      },
    );

    await expect(runMutation(baseArgs, deps)).rejects.toThrow(
      /Refusal \(Rule 4\): file target\.ts does not match intended mutation after writing/,
    );
    expect(store.get("target.ts")?.equals(originalBytes)).toBe(true);
  });

  test("restores file on signal", async () => {
    const originalBytes = Buffer.from("export const flag = true;\n");
    let triggerSignal: (() => Promise<void>) | undefined;

    const { deps, store } = makeFakeDeps(
      {
        "target.ts": originalBytes,
        "before.txt": "flag = true",
        "after.txt": "flag = false",
      },
      { exitCode: 0, stdout: "", stderr: "" },
      {
        onSignal: (cleanup) => {
          triggerSignal = async () => {
            await cleanup();
          };
          return () => {
            triggerSignal = undefined;
          };
        },
        execute: vi.fn(async () => {
          if (triggerSignal) {
            await triggerSignal();
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }),
      },
    );

    await runMutation(baseArgs, deps);
    expect(store.get("target.ts")?.equals(originalBytes)).toBe(true);
  });

  test("concurrent restore calls share the same restoration promise", async () => {
    const originalBytes = Buffer.from("export const flag = true;\n");
    let triggerSignal: (() => Promise<void>) | undefined;
    let restoreWrites = 0;

    const { deps, store } = makeFakeDeps(
      {
        "target.ts": originalBytes,
        "before.txt": "flag = true",
        "after.txt": "flag = false",
      },
      { exitCode: 0, stdout: "", stderr: "" },
      {
        writeFileBuffer: vi.fn(async (path: string, content: Buffer) => {
          if (path === "target.ts" && content.equals(originalBytes)) {
            restoreWrites++;
            await new Promise((r) => setTimeout(r, 10));
          }
          store.set(path, Buffer.from(content));
        }),
        onSignal: (cleanup) => {
          triggerSignal = async () => {
            await cleanup();
          };
          return () => {
            triggerSignal = undefined;
          };
        },
        execute: vi.fn(async () => {
          if (triggerSignal) {
            void triggerSignal();
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }),
      },
    );

    await runMutation(baseArgs, deps);
    expect(store.get("target.ts")?.equals(originalBytes)).toBe(true);
    expect(restoreWrites).toBe(1);
  });

  describe("a signal that arrives while a write is pending", () => {
    const originalBytes = Buffer.from("export const flag = true;\n");
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };
    // Every write to the target goes through a gate the test opens by hand. A
    // write lands on disk only when its gate opens, as a slow disk would.
    const slowDeps = (gates: Array<ReturnType<typeof deferred>>) => {
      const events: string[] = [];
      let signal: (() => Promise<void>) | undefined;
      let unregistered = false;
      const made = makeFakeDeps(
        {
          "target.ts": originalBytes,
          "before.txt": "flag = true",
          "after.txt": "flag = false",
        },
        { exitCode: 0, stdout: "", stderr: "" },
      );
      let n = 0;
      const deps: MutationDeps = {
        ...made.deps,
        writeFileBuffer: async (path, content) => {
          const gate = gates[n++];
          events.push(`write ${n} started`);
          await gate?.promise;
          made.store.set(path, Buffer.from(content));
          events.push(`write ${n} landed`);
        },
        onSignal: (cleanup) => {
          signal = async () => {
            await cleanup();
            events.push("exit callback");
          };
          return () => {
            unregistered = true;
          };
        },
      };
      return {
        deps,
        events,
        store: made.store,
        signal: () => signal!(),
        isUnregistered: () => unregistered,
      };
    };

    test("during the mutation write, the original bytes are the last write and exit waits for them", async () => {
      const mutationGate = deferred();
      const restoreGate = deferred();
      const h = slowDeps([mutationGate, restoreGate]);

      const running = runMutation(baseArgs, h.deps);
      await vi.waitFor(() => expect(h.events).toContain("write 1 started"));

      const exiting = h.signal();
      // Nothing may restore over a write that is still in flight.
      await new Promise((r) => setTimeout(r, 20));
      expect(h.events).toEqual(["write 1 started"]);

      mutationGate.resolve();
      await vi.waitFor(() => expect(h.events).toContain("write 2 started"));
      expect(h.events).not.toContain("exit callback");
      restoreGate.resolve();
      await exiting;
      await running.catch(() => undefined);

      expect(h.store.get("target.ts")?.equals(originalBytes)).toBe(true);
      expect(h.events.at(-1)).not.toBe("write 1 landed");
      expect(h.events.indexOf("exit callback")).toBeGreaterThan(
        h.events.indexOf("write 2 landed"),
      );
    });

    test("during the restoring write, the handlers stay registered and exit waits for it", async () => {
      const mutationGate = deferred();
      const restoreGate = deferred();
      const h = slowDeps([mutationGate, restoreGate]);

      const running = runMutation(baseArgs, h.deps);
      await vi.waitFor(() => expect(h.events).toContain("write 1 started"));
      mutationGate.resolve();
      await vi.waitFor(() => expect(h.events).toContain("write 2 started"));

      // The restoring write is pending, so the process is still exposed.
      expect(h.isUnregistered()).toBe(false);
      const exiting = h.signal();
      await new Promise((r) => setTimeout(r, 20));
      expect(h.events).not.toContain("exit callback");

      restoreGate.resolve();
      await exiting;
      await running;

      expect(h.store.get("target.ts")?.equals(originalBytes)).toBe(true);
      expect(h.events.indexOf("exit callback")).toBeGreaterThan(
        h.events.indexOf("write 2 landed"),
      );
      expect(h.isUnregistered()).toBe(true);
    });
  });

  test("each refusal path leaves file byte-identical", async () => {
    const originalBytes = Buffer.from("alpha beta gamma\n");

    // 1. Absent
    const { deps: depsAbsent, store: storeAbsent } = makeFakeDeps({
      "target.ts": originalBytes,
      "before.txt": "delta",
      "after.txt": "omega",
    });
    await expect(runMutation(baseArgs, depsAbsent)).rejects.toThrow(/Rule 2/);
    expect(storeAbsent.get("target.ts")?.equals(originalBytes)).toBe(true);

    // 2. Ambiguous
    const { deps: depsAmbiguous, store: storeAmbiguous } = makeFakeDeps({
      "target.ts": Buffer.from("foo foo"),
      "before.txt": "foo",
      "after.txt": "bar",
    });
    await expect(runMutation(baseArgs, depsAmbiguous)).rejects.toThrow(
      /Rule 2/,
    );
    expect(
      storeAmbiguous.get("target.ts")?.equals(Buffer.from("foo foo")),
    ).toBe(true);

    // 3. No-op
    const { deps: depsNoop, store: storeNoop } = makeFakeDeps({
      "target.ts": originalBytes,
      "before.txt": "alpha",
      "after.txt": "alpha",
    });
    await expect(runMutation(baseArgs, depsNoop)).rejects.toThrow(/Rule 3/);
    expect(storeNoop.get("target.ts")?.equals(originalBytes)).toBe(true);

    // 4. Empty before
    const { deps: depsEmpty, store: storeEmpty } = makeFakeDeps({
      "target.ts": originalBytes,
      "before.txt": "",
      "after.txt": "omega",
    });
    await expect(runMutation(baseArgs, depsEmpty)).rejects.toThrow(/Rule 3/);
    expect(storeEmpty.get("target.ts")?.equals(originalBytes)).toBe(true);
  });
});

describe("formatReport", () => {
  test("prints exit code as first line above verdict, because, and test output", () => {
    const report = formatReport({
      exitCode: 1,
      verdict: "caught",
      because: "guards negative indices",
      stdout: "FAIL packages/core/test.ts\n  ✕ handles -1",
      stderr: "Error: assertion failed",
    });

    const lines = report.split("\n");
    expect(lines[0]).toBe("exit code: 1");
    expect(lines[1]).toBe("verdict: caught");
    expect(lines[2]).toBe("because: guards negative indices");
    expect(report).toContain("FAIL packages/core/test.ts");
    expect(report).toContain("Error: assertion failed");
  });

  test("handles empty command output cleanly", () => {
    const report = formatReport({
      exitCode: 0,
      verdict: "survived",
      because: "harmless comment change",
      stdout: "",
      stderr: "",
    });

    expect(report).toBe(
      "exit code: 0\nverdict: survived\nbecause: harmless comment change",
    );
  });
});
