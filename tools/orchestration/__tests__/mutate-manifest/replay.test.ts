import { describe, expect, test, vi } from "vitest";
import type { MutationDeps } from "../../src/mutate/lib/types.js";
import {
  EXIT_MISMATCH,
  EXIT_VERIFIED,
  exitCodeFor,
  formatChecks,
  replayManifest,
  type ScratchDeps,
} from "../../src/mutate-manifest/lib/replay.js";
import type { Manifest } from "../../src/mutate-manifest/lib/types.js";

const manifest = (
  over: Partial<Manifest["mutations"][number]> = {},
): Manifest => ({
  version: 1,
  lane: "W4",
  mutations: [
    {
      file: "target.ts",
      before: "alpha",
      after: "beta",
      because: "the guard must red",
      command: ["run", "tests"],
      verdict: "caught",
      ...over,
    },
  ],
});

/**
 * A fake target file plus a command whose result the test chooses — separately
 * for the untouched source and for the mutated source, which is how a real
 * suite behaves: green before, red after. The mutation engine is real — that is
 * the point of the replay — so the file must genuinely contain the `before`
 * text exactly once.
 */
const deps = (
  mutated: { exitCode: number; launchError?: string },
  baseline: { exitCode: number; launchError?: string } = { exitCode: 0 },
): MutationDeps => {
  let current = Buffer.from("alpha", "utf8");
  return {
    readFile: async (path) => (path.endsWith(".before") ? "alpha" : "beta"),
    readFileBuffer: async () => current,
    writeFileBuffer: async (_path, buffer) => {
      current = Buffer.from(buffer);
    },
    execute: async () =>
      current.toString("utf8") === "alpha"
        ? { stdout: "", stderr: "", ...baseline }
        : { stdout: "", stderr: "", ...mutated },
  };
};

const scratch = (): ScratchDeps => ({
  makeDir: async () => "/scratch",
  writeText: async () => undefined,
  removeDir: async () => undefined,
  join: (...parts) => parts.join("/"),
});

describe("replayManifest", () => {
  test("verifies a claim when the mutation is caught, as recorded", async () => {
    const checks = await replayManifest(
      manifest(),
      deps({ exitCode: 1 }),
      scratch(),
    );
    expect(checks[0]).toMatchObject({ status: "verified", observed: "caught" });
  });

  test("reports a mismatch when the claimed catch does not reproduce", async () => {
    const checks = await replayManifest(
      manifest(),
      deps({ exitCode: 0 }),
      scratch(),
    );
    expect(checks[0]).toMatchObject({
      status: "mismatch",
      observed: "survived",
    });
  });

  test("writes each mutation's texts to its own scratch pair", async () => {
    const writeText = vi.fn<(path: string, text: string) => Promise<void>>(
      async () => undefined,
    );
    await replayManifest(manifest(), deps({ exitCode: 1 }), {
      ...scratch(),
      writeText,
    });
    expect(writeText.mock.calls.map((c) => c[0])).toEqual([
      "/scratch/0.before",
      "/scratch/0.after",
    ]);
  });

  test("removes the scratch directory even when a mutation throws", async () => {
    const removeDir = vi.fn(async () => undefined);
    const broken: MutationDeps = {
      ...deps({ exitCode: 1 }),
      readFileBuffer: async () => {
        throw new Error("unreadable");
      },
    };
    await expect(
      replayManifest(manifest(), broken, { ...scratch(), removeDir }),
    ).rejects.toThrow();
    expect(removeDir).toHaveBeenCalledWith("/scratch");
  });

  test("reports a red baseline as one, and never as a verified claim", async () => {
    const writeFileBuffer = vi.fn<
      (path: string, buffer: Buffer) => Promise<void>
    >(async () => undefined);
    const checks = await replayManifest(
      manifest(),
      { ...deps({ exitCode: 1 }, { exitCode: 1 }), writeFileBuffer },
      scratch(),
    );
    expect(checks[0]).toMatchObject({ status: "red-baseline" });
    expect(checks[0]?.observed).toBeUndefined();
    expect(checks.map((c) => c.status)).not.toContain("verified");
    expect(writeFileBuffer).not.toHaveBeenCalled();
  });

  test("does not count a catch when the command never launched on the mutation", async () => {
    const checks = await replayManifest(
      manifest(),
      deps({ exitCode: 1, launchError: "spawn run ENOENT" }),
      scratch(),
    );
    expect(checks[0]).toMatchObject({
      status: "launch-failure",
      launchError: "spawn run ENOENT",
    });
    expect(checks.map((c) => c.status)).not.toContain("verified");
  });

  test("reports a command that never launched at baseline, without touching the source", async () => {
    const writeFileBuffer = vi.fn<
      (path: string, buffer: Buffer) => Promise<void>
    >(async () => undefined);
    const checks = await replayManifest(
      manifest(),
      {
        ...deps(
          { exitCode: 1 },
          { exitCode: 0, launchError: "spawn run ENOENT" },
        ),
        writeFileBuffer,
      },
      scratch(),
    );
    expect(checks[0]).toMatchObject({
      status: "launch-failure",
      launchError: "spawn run ENOENT",
    });
    expect(writeFileBuffer).not.toHaveBeenCalled();
  });
});

describe("a retired claim", () => {
  const retired = (): Manifest =>
    manifest({
      retired:
        "the rail has had no YAML view since that stage gate; the subject is deleted",
    });

  test("is not run at all — no baseline, no mutation, no command", async () => {
    const execute = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
    }));
    const writeFileBuffer = vi.fn<
      (path: string, buffer: Buffer) => Promise<void>
    >(async () => undefined);
    const checks = await replayManifest(
      retired(),
      { ...deps({ exitCode: 1 }), execute, writeFileBuffer },
      scratch(),
    );
    expect(checks[0]).toMatchObject({ status: "retired" });
    expect(execute).not.toHaveBeenCalled();
    expect(writeFileBuffer).not.toHaveBeenCalled();
  });

  test("does not fail the replay — that is the point of retiring it", async () => {
    const checks = await replayManifest(
      retired(),
      deps({ exitCode: 1 }),
      scratch(),
    );
    expect(exitCodeFor(checks)).toBe(EXIT_VERIFIED);
  });

  test("is printed with its reason, never silently dropped", async () => {
    const text = formatChecks(
      "W4",
      await replayManifest(retired(), deps({ exitCode: 1 }), scratch()),
    );
    expect(text).toContain("RETIRED  target.ts");
    expect(text).toContain(
      "reason: the rail has had no YAML view since that stage gate",
    );
    expect(text).toContain(
      "W4: 1 mutation(s) retired with a stated reason, not run.",
    );
  });

  test("is not counted as re-run, so the summary never overstates the work", async () => {
    const both: Manifest = {
      ...manifest(),
      mutations: [...manifest().mutations, ...retired().mutations],
    };
    const text = formatChecks(
      "W4",
      await replayManifest(both, deps({ exitCode: 1 }), scratch()),
    );
    expect(text).toContain(
      "W4: 1 mutation(s) re-run, every verdict reproduced.",
    );
    expect(text).toContain(
      "W4: 1 mutation(s) retired with a stated reason, not run.",
    );
  });

  test("a manifest with nothing left to run says so, instead of reporting a green replay", async () => {
    const text = formatChecks(
      "W4",
      await replayManifest(retired(), deps({ exitCode: 1 }), scratch()),
    );
    expect(text).toContain(
      "W4: all 1 mutation(s) are retired — this manifest now runs nothing.",
    );
    expect(text).not.toContain("every verdict reproduced");
  });

  test("never hides a live mutation that failed beside it", async () => {
    const both: Manifest = {
      ...manifest(),
      mutations: [...manifest().mutations, ...retired().mutations],
    };
    const checks = await replayManifest(both, deps({ exitCode: 0 }), scratch());
    expect(formatChecks("W4", checks)).toContain(
      "W4: 1 of 1 mutation(s) did not reproduce.",
    );
    expect(exitCodeFor(checks)).toBe(EXIT_MISMATCH);
  });

  test("never hides a blocked mutation beside it either", async () => {
    const both: Manifest = {
      ...manifest(),
      mutations: [...manifest().mutations, ...retired().mutations],
    };
    const checks = await replayManifest(
      both,
      deps({ exitCode: 1 }, { exitCode: 1 }),
      scratch(),
    );
    expect(formatChecks("W4", checks)).toContain(
      "W4: 1 of 1 mutation(s) could not be checked",
    );
    expect(exitCodeFor(checks)).toBe(EXIT_MISMATCH);
  });
});

describe("formatChecks", () => {
  test("says plainly when every verdict reproduced", async () => {
    const checks = await replayManifest(
      manifest(),
      deps({ exitCode: 1 }),
      scratch(),
    );
    expect(formatChecks("W4", checks)).toBe(
      "W4: 1 mutation(s) re-run, every verdict reproduced.",
    );
  });

  test("names the file, both verdicts, and what the mismatch means", async () => {
    const checks = await replayManifest(
      manifest(),
      deps({ exitCode: 0 }),
      scratch(),
    );
    const text = formatChecks("W4", checks);
    expect(text).toContain("MISMATCH  target.ts");
    expect(text).toContain("claimed: caught    observed: survived");
    expect(text).toContain("the guard must red");
    expect(text).toContain("tests do not catch");
    expect(text).toContain("W4: 1 of 1 mutation(s) did not reproduce.");
  });

  test("names the command that was already red, and says the claim was not checked", async () => {
    const checks = await replayManifest(
      manifest(),
      deps({ exitCode: 1 }, { exitCode: 1 }),
      scratch(),
    );
    const text = formatChecks("W4", checks);
    expect(text).toContain("RED BASELINE  target.ts");
    expect(text).toContain("command: run tests");
    expect(text).toContain("the guard must red");
    expect(text).toContain("W4: 1 of 1 mutation(s) could not be checked");
  });

  test("names the command that never ran, and why", async () => {
    const checks = await replayManifest(
      manifest(),
      deps({ exitCode: 1, launchError: "spawn run ENOENT" }),
      scratch(),
    );
    const text = formatChecks("W4", checks);
    expect(text).toContain("LAUNCH FAILURE  target.ts");
    expect(text).toContain("command: run tests");
    expect(text).toContain("error: spawn run ENOENT");
    expect(text).toContain("W4: 1 of 1 mutation(s) could not be checked");
  });
});

describe("exitCodeFor", () => {
  test("is non-zero on a mismatch, so CI can refuse the claim", async () => {
    expect(
      exitCodeFor(
        await replayManifest(manifest(), deps({ exitCode: 0 }), scratch()),
      ),
    ).toBe(EXIT_MISMATCH);
  });

  test("is zero when every claim reproduced", async () => {
    expect(
      exitCodeFor(
        await replayManifest(manifest(), deps({ exitCode: 1 }), scratch()),
      ),
    ).toBe(EXIT_VERIFIED);
  });

  test("is non-zero when a red baseline blocked the check", async () => {
    const checks = await replayManifest(
      manifest(),
      deps({ exitCode: 1 }, { exitCode: 1 }),
      scratch(),
    );
    expect(exitCodeFor(checks)).toBe(EXIT_MISMATCH);
  });

  test("is non-zero when the command never launched", async () => {
    const checks = await replayManifest(
      manifest(),
      deps({ exitCode: 1 }, { exitCode: 0, launchError: "spawn run ENOENT" }),
      scratch(),
    );
    expect(exitCodeFor(checks)).toBe(EXIT_MISMATCH);
  });
});
