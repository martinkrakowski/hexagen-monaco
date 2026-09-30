import { describe, expect, test } from "vitest";
import type { Config } from "../../src/internal/config.js";
import {
  isMutateGated,
  lockedNameList,
  programWord,
  renderSteps,
  resolveGateSteps,
  scriptNameOf,
  skipReason,
} from "../../src/gate/steps.js";

/**
 * The step list, resolved from a config passed in.
 *
 * Three rules live here and each is a place the port could have quietly kept a
 * fact about ONE repository: which steps are mutate-only, which steps hold the
 * machine-wide lock, and which steps may be skipped because the project never
 * declared them.
 */

/** Only the fields these tests read, so a default-heavy `Config` is not restated. */
function configWith(overrides: Partial<Config>): Config {
  return {
    ...(overrides as Config),
  } as Config;
}

describe("programWord", () => {
  test("reads the first word, stepping over npx --no-install", () => {
    expect(programWord("yarn build")).toBe("yarn");
    expect(programWord("npx --no-install some-bin")).toBe("some-bin");
    expect(programWord("  sh   -c  'exit 3'  ")).toBe("sh");
    expect(programWord("")).toBeUndefined();
  });
});

describe("the mutate omission", () => {
  test("matches the manifest verifier and every mutating bin, through npx", () => {
    expect(
      isMutateGated("npx --no-install hexagen-orchestration-verify-manifests"),
    ).toBe(true);
    expect(isMutateGated("npx --no-install hexagen-orchestration-mutate")).toBe(
      true,
    );
    expect(
      isMutateGated("npx --no-install hexagen-orchestration-mutate-anchors"),
    ).toBe(true);
    expect(
      isMutateGated("npx --no-install hexagen-orchestration-mutate-verify"),
    ).toBe(true);
    // Bare, not through npx.
    expect(isMutateGated("hexagen-orchestration-verify-manifests")).toBe(true);
  });

  test("does not match a non-mutating bin, or a bin that merely mentions one", () => {
    expect(isMutateGated("yarn build")).toBe(false);
    expect(
      isMutateGated("npx --no-install hexagen-orchestration-plan-verify"),
    ).toBe(false);
    // A step that runs the mutator as an ARGUMENT is not the mutator's own
    // step, and gating on a substring would drop it by accident.
    expect(
      isMutateGated("sh -c 'npx --no-install hexagen-orchestration-mutate'"),
    ).toBe(false);
    expect(
      isMutateGated("npx --no-install @hexagen/orchestration-mutate"),
    ).toBe(false);
  });

  test("mutate: false drops both kinds, mutate: true keeps both", () => {
    const steps = [
      { name: "build", command: "yarn build" },
      {
        name: "verify-manifests",
        command: "npx --no-install hexagen-orchestration-verify-manifests",
      },
      {
        name: "mutate",
        command: "npx --no-install hexagen-orchestration-mutate",
      },
    ];
    const omitted = resolveGateSteps(
      configWith({ mutate: false, gateSteps: steps }),
    ).map((step) => step.name);
    expect(omitted).toEqual(["build"]);

    const kept = resolveGateSteps(
      configWith({ mutate: true, gateSteps: steps }),
    ).map((step) => step.name);
    expect(kept).toEqual(["build", "verify-manifests", "mutate"]);
  });

  test("keeps config order, which is the order the gate runs", () => {
    const resolved = resolveGateSteps(
      configWith({
        mutate: false,
        gateSteps: [
          { name: "lint", command: "yarn lint" },
          { name: "build", command: "yarn build" },
          { name: "test:cov", command: "yarn test:cov" },
        ],
      }),
    ).map((step) => step.name);
    expect(resolved).toEqual(["lint", "build", "test:cov"]);
  });
});

describe("locked steps", () => {
  test("come from locked: true, never from a name", () => {
    const resolved = resolveGateSteps(
      configWith({
        mutate: false,
        gateSteps: [
          // The name this repo's source used to hardcode, with no `locked`:
          // it must NOT hold the lock.
          { name: "test:cov", command: "yarn test:cov" },
          // A name nobody has ever hardcoded, WITH `locked`: it must.
          {
            name: "arch:inventory",
            command: "yarn arch:inventory",
            locked: true,
          },
        ],
      }),
    );
    expect(resolved.map((step) => step.locked)).toEqual([false, true]);
    expect(lockedNameList(resolved)).toBe(" arch:inventory ");
  });

  test("a `locked: false` step is not locked, and no locked names renders as one space", () => {
    const resolved = resolveGateSteps(
      configWith({
        mutate: false,
        gateSteps: [{ name: "build", command: "yarn build", locked: false }],
      }),
    );
    expect(resolved[0]?.locked).toBe(false);
    expect(lockedNameList(resolved)).toBe(" ");
  });

  test("names are space-separated with a leading and a trailing space", () => {
    const resolved = resolveGateSteps(
      configWith({
        mutate: false,
        gateSteps: [
          { name: "one", command: "true", locked: true },
          { name: "two", command: "true", locked: true },
          { name: "three", command: "true" },
        ],
      }),
    );
    // The spaces are load-bearing: the loop matches by substring, and one
    // space keeps a name that prefixes another from matching both.
    expect(lockedNameList(resolved)).toBe(" one two ");
  });
});

describe("the skip rule's input", () => {
  test("names the script only for exactly `yarn <script>`", () => {
    expect(scriptNameOf("yarn build")).toBe("build");
    expect(scriptNameOf("  yarn   test:cov ")).toBe("test:cov");
    // Anything else names no script and so can never be missing one.
    expect(scriptNameOf("yarn build && yarn lint")).toBeUndefined();
    expect(
      scriptNameOf("npx --no-install hexagen-orchestration-verify-manifests"),
    ).toBeUndefined();
    expect(scriptNameOf("build")).toBeUndefined();
    expect(scriptNameOf("yarn")).toBeUndefined();
  });

  test("the reason names the script, so the line says what was missing", () => {
    expect(skipReason("check:env")).toBe("no check:env script in package.json");
  });
});

describe("renderSteps", () => {
  test("one name<TAB>command line per step, in order", () => {
    const resolved = resolveGateSteps(
      configWith({
        mutate: false,
        gateSteps: [
          { name: "build", command: "yarn build" },
          { name: "lint", command: "yarn lint" },
        ],
      }),
    );
    expect(renderSteps(resolved)).toBe("build\tyarn build\nlint\tyarn lint");
  });

  test("no trailing newline of its own — the caller owns the one the contract asks for", () => {
    const resolved = resolveGateSteps(
      configWith({
        mutate: false,
        gateSteps: [{ name: "build", command: "yarn build" }],
      }),
    );
    expect(renderSteps(resolved).endsWith("\n")).toBe(false);
  });
});
