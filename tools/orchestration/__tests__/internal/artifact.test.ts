import { describe, expect, test } from "vitest";
import { join } from "node:path";
import {
  ARTIFACT_FILE_NAME,
  ARTIFACT_VERSION,
  PLAN_VERIFY_ARTIFACT_ENV,
  PROVENANCE_UNKNOWN,
  artifactPathFor,
  buildArtifact,
  errorText,
  parseArtifact,
  serializeArtifact,
  writeArtifact,
  type ArtifactScope,
  type GitProvenance,
} from "../../src/internal/artifact.js";
import type { PremiseResult } from "../../src/internal/premise-types.js";

const premiseResult = (
  lane: string,
  status: PremiseResult["status"],
  reason?: string,
): PremiseResult => ({
  premise: {
    plan: `docs/planning/${lane}.md`,
    lane,
    script: `grep -q ${lane} src/x.ts`,
  },
  status,
  exitCode: status === "holds" ? 0 : 1,
  output: reason ?? "",
  ...(reason === undefined ? {} : { reason }),
});

const git = (over: Partial<GitProvenance> = {}): GitProvenance => ({
  branch: "feat/s5-backlog-panel",
  head: "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567",
  ...over,
});

const full: ArtifactScope = { kind: "full" };
const partial: ArtifactScope = {
  kind: "partial",
  plans: ["docs/planning/one.md"],
};

const valid = () =>
  buildArtifact([premiseResult("W1", "holds")], {
    at: "2026-09-13T12:00:00.000Z",
    git: git(),
    scope: full,
    plans: ["docs/planning/a.md"],
  });

describe("artifactPathFor", () => {
  const demo = { repo: "acme/demo" };

  test("the env var overrides the default location — the test and CI seam", () => {
    expect(
      artifactPathFor({ [PLAN_VERIFY_ARTIFACT_ENV]: "/tmp/pv.json" }),
    ).toBe("/tmp/pv.json");
  });

  test("an empty override is not a location; it does not mask the real root", () => {
    expect(
      artifactPathFor({ [PLAN_VERIFY_ARTIFACT_ENV]: "", WAVE_LOG_ROOT: "/w" }),
    ).toBe(join("/w", ARTIFACT_FILE_NAME));
  });

  test("without the override the artifact lives in the wave-log root", () => {
    expect(artifactPathFor({ WAVE_LOG_ROOT: "/w" })).toBe(
      join("/w", ARTIFACT_FILE_NAME),
    );
  });

  test("with no override and no root, the default is THIS repo's root — never the shared ~/.waves", () => {
    const path = artifactPathFor({ HOME: "/home/op" }, demo);
    expect(path).toBe(join("/home/op/.waves-demo", ARTIFACT_FILE_NAME));
    expect(path).not.toContain("/.waves/");
    expect(path).not.toContain("docs");
  });

  test("the config's waveLogDir is honoured, with HOME expanded", () => {
    expect(
      artifactPathFor(
        { HOME: "/home/op" },
        { ...demo, waveLogDir: "$HOME/.waves-hexagen" },
      ),
    ).toBe(join("/home/op/.waves-hexagen", ARTIFACT_FILE_NAME));
  });

  test("an unset HOME falls back to /tmp/.waves-<name>, the per-repo root rule", () => {
    expect(artifactPathFor({}, demo)).toBe(
      join("/tmp/.waves-demo", ARTIFACT_FILE_NAME),
    );
  });

  test("with no repo to name a root it refuses rather than using a shared one", () => {
    expect(() => artifactPathFor({ HOME: "/home/op" })).toThrow(
      /no repository name/,
    );
  });
});

describe("buildArtifact", () => {
  test("carries the provenance the panel must render and one record per premise", () => {
    expect(
      buildArtifact([premiseResult("S5", "stale", "already merged")], {
        at: "2026-09-13T12:00:00.000Z",
        git: git(),
        scope: full,
        plans: ["docs/planning/a.md"],
      }),
    ).toEqual({
      version: ARTIFACT_VERSION,
      at: "2026-09-13T12:00:00.000Z",
      git: git(),
      scope: full,
      plans: ["docs/planning/a.md"],
      premises: [
        {
          lane: "S5",
          plan: "docs/planning/S5.md",
          status: "stale",
          reason: "already merged",
        },
      ],
    });
  });

  test("a record is lane, plan, status and reason — never the script text", () => {
    // The artifact crosses a trust boundary (a long-lived server reads it);
    // executable text in it would smuggle back the design the owner rejected.
    expect(serializeArtifact(valid())).not.toContain("grep");
  });

  test("a partial run records which plans it covered", () => {
    expect(
      buildArtifact([], { at: "x", git: git(), scope: partial, plans: [] })
        .scope,
    ).toEqual(partial);
  });
});

describe("parseArtifact", () => {
  const corrupt = (mutate: (raw: Record<string, unknown>) => void): string => {
    const raw = JSON.parse(serializeArtifact(valid())) as Record<
      string,
      unknown
    >;
    mutate(raw);
    return JSON.stringify(raw);
  };

  test("round-trips what buildArtifact produced", () => {
    const artifact = valid();
    expect(parseArtifact(serializeArtifact(artifact))).toEqual(artifact);
  });

  test("refuses text that is not JSON", () => {
    expect(() => parseArtifact("{ not json")).toThrow(/not valid JSON/);
  });

  test.each([
    ["an array, not an object", "[]"],
    [
      "a foreign version",
      corrupt((raw) => {
        raw.version = ARTIFACT_VERSION + 1;
      }),
    ],
    [
      "a missing at",
      corrupt((raw) => {
        delete raw.at;
      }),
    ],
    [
      "an at that is not a real instant",
      corrupt((raw) => {
        raw.at = "yesterday-ish";
      }),
    ],
    [
      "git provenance that is missing",
      corrupt((raw) => {
        delete raw.git;
      }),
    ],
    [
      "git provenance without a head sha",
      corrupt((raw) => {
        (raw.git as Record<string, unknown>).head = "";
      }),
    ],
    [
      "a scope that is neither full nor partial",
      corrupt((raw) => {
        raw.scope = { kind: "guess" };
      }),
    ],
    [
      "a partial scope whose plans are missing",
      corrupt((raw) => {
        raw.scope = { kind: "partial" };
      }),
    ],
    [
      "a full scope smuggling a plans list",
      corrupt((raw) => {
        raw.scope = { kind: "full", plans: ["a"] };
      }),
    ],
    [
      "a missing scope — absence is never read as a full run",
      corrupt((raw) => {
        delete raw.scope;
      }),
    ],
    [
      "plans that is not an array",
      corrupt((raw) => {
        raw.plans = "docs/planning";
      }),
    ],
    [
      "a plans array holding a non-string",
      corrupt((raw) => {
        raw.plans = [{ plan: "a" }];
      }),
    ],
    [
      "premises that is not an array",
      corrupt((raw) => {
        raw.premises = "W1 holds";
      }),
    ],
    [
      "a premise record that is not an object",
      corrupt((raw) => {
        raw.premises = ["W1"];
      }),
    ],
    [
      "a premise record with an unknown status",
      corrupt((raw) => {
        (raw.premises as Record<string, unknown>[])[0].status = "probably-fine";
      }),
    ],
    [
      "a premise record missing its lane",
      corrupt((raw) => {
        delete (raw.premises as Record<string, unknown>[])[0].lane;
      }),
    ],
    [
      "a reason that is not a string",
      corrupt((raw) => {
        (raw.premises as Record<string, unknown>[])[0].reason = 7;
      }),
    ],
    [
      "git provenance missing a branch",
      corrupt((raw) => {
        delete (raw.git as Record<string, unknown>).branch;
      }),
    ],
    [
      "git provenance with an empty branch",
      corrupt((raw) => {
        (raw.git as Record<string, unknown>).branch = "";
      }),
    ],
    [
      "git provenance with a non-string branch",
      corrupt((raw) => {
        (raw.git as Record<string, unknown>).branch = { name: "feat" };
      }),
    ],
    [
      "a premise record missing its plan",
      corrupt((raw) => {
        delete (raw.premises as Record<string, unknown>[])[0].plan;
      }),
    ],
    [
      "a premise record with an empty plan",
      corrupt((raw) => {
        (raw.premises as Record<string, unknown>[])[0].plan = "";
      }),
    ],
    [
      "a premise record with a non-string plan",
      corrupt((raw) => {
        (raw.premises as Record<string, unknown>[])[0].plan = null;
      }),
    ],
  ])("refuses %s", (_name, text) => {
    expect(() => parseArtifact(text as string)).toThrow(
      /malformed|not valid JSON/,
    );
  });

  test("strips fields the schema does not own — an added `script` never crosses the boundary", () => {
    const text = corrupt((raw) => {
      (raw.premises as Record<string, unknown>[])[0].script = "rm -rf /";
    });
    expect(JSON.stringify(parseArtifact(text))).not.toContain("rm -rf");
  });

  test("an omitted reason stays absent rather than defaulted", () => {
    const text = corrupt((raw) => {
      delete (raw.premises as Record<string, unknown>[])[0].reason;
    });
    expect(parseArtifact(text).premises[0]).not.toHaveProperty("reason");
  });
});

describe("errorText", () => {
  test("an Error speaks with its message", () => {
    expect(errorText(new Error("disk full"))).toBe("disk full");
  });

  test("an Error with no message says what it is, not nothing", () => {
    expect(errorText(new Error(""))).toBe("Error");
  });

  test("a thrown string is already text", () => {
    expect(errorText("read-only filesystem")).toBe("read-only filesystem");
  });

  test("a thrown value with no text still yields a word, never the empty string", () => {
    expect(errorText(null)).toBe("null");
    expect(errorText(undefined)).toBe("undefined");
  });
});

test("PROVENANCE_UNKNOWN is exported so no consumer re-invents a spelling", () => {
  expect(PROVENANCE_UNKNOWN).toBe("unknown");
});

describe("writeArtifact", () => {
  test("writes to a temporary sibling file and renames it over the target", async () => {
    const operations: {
      op: string;
      path?: string;
      oldPath?: string;
      newPath?: string;
    }[] = [];
    const fs = {
      mkdir: async (p: string) => {
        operations.push({ op: "mkdir", path: p });
      },
      writeFile: async (p: string) => {
        operations.push({ op: "writeFile", path: p });
      },
      rename: async (oldPath: string, newPath: string) => {
        operations.push({ op: "rename", oldPath, newPath });
      },
    };
    const target = "/custom/dir/plan-verify.json";
    await writeArtifact(target, '{"version":1}', fs);
    expect(operations[0]).toEqual({ op: "mkdir", path: "/custom/dir" });
    expect(operations[1]?.op).toBe("writeFile");
    expect(operations[1]?.path).not.toBe(target);
    expect(operations[1]?.path?.startsWith("/custom/dir/")).toBe(true);
    expect(operations[2]).toEqual({
      op: "rename",
      oldPath: operations[1]?.path,
      newPath: target,
    });
  });

  test("writes atomically to disk when using the default filesystem implementation", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(join(tmpdir(), "artifact-write-"));
    try {
      const target = join(dir, "plan-verify.json");
      await writeArtifact(target, '{"test":true}');
      const content = await readFile(target, "utf8");
      expect(content).toBe('{"test":true}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
