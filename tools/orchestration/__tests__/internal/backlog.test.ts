import { describe, expect, test } from "vitest";
import { readBacklog } from "../../src/internal/backlog.js";
import {
  buildArtifact,
  serializeArtifact,
} from "../../src/internal/artifact.js";

const artifact = buildArtifact(
  [
    {
      premise: { plan: "docs/planning/a.md", lane: "W1", script: "true" },
      status: "holds" as const,
      exitCode: 0,
      output: "",
    },
  ],
  {
    at: "2026-09-13T12:00:00.000Z",
    git: { branch: "feat/s5-backlog-panel", head: "0a1b2c3d" },
    scope: { kind: "full" },
    plans: ["docs/planning/a.md"],
  },
);

const enoent = () =>
  Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });

describe("readBacklog", () => {
  test("a well-formed artifact is the recorded backlog, verbatim", async () => {
    const readFile = async () => serializeArtifact(artifact);
    expect(await readBacklog(readFile, "/p.json")).toEqual({
      state: "recorded",
      artifact,
    });
  });

  test("no artifact is absent — never an empty premise list", async () => {
    const readFile = async (): Promise<string> => {
      throw enoent();
    };
    expect(await readBacklog(readFile, "/p.json")).toEqual({ state: "absent" });
  });

  test("a read that failed for a reason other than absence is unknown", async () => {
    const readFile = async (): Promise<string> => {
      throw Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
    };
    expect(await readBacklog(readFile, "/p.json")).toEqual({
      state: "unknown",
    });
  });

  test("a thrown non-object is unknown, not a crash", async () => {
    const readFile = async (): Promise<string> => {
      throw "boom";
    };
    expect(await readBacklog(readFile, "/p.json")).toEqual({
      state: "unknown",
    });
  });

  test("a thrown null is unknown, not a crash", async () => {
    const readFile = async (): Promise<string> => {
      throw null;
    };
    expect(await readBacklog(readFile, "/p.json")).toEqual({
      state: "unknown",
    });
  });

  test("a malformed artifact is unknown — the panel cannot stand on it", async () => {
    const readFile = async () => "{ this is not an artifact";
    expect(await readBacklog(readFile, "/p.json")).toEqual({
      state: "unknown",
    });
  });

  test("a valid artifact at a version nothing can stand on is unknown", async () => {
    const raw = JSON.parse(serializeArtifact(artifact)) as Record<
      string,
      unknown
    >;
    raw.version = 99;
    expect(
      await readBacklog(async () => JSON.stringify(raw), "/p.json"),
    ).toEqual({
      state: "unknown",
    });
  });
});
