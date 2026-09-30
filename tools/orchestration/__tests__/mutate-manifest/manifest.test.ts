import { describe, expect, test } from "vitest";
import {
  ManifestError,
  parseManifest,
} from "../../src/mutate-manifest/lib/manifest.js";

const mutation = {
  file: "a.ts",
  before: "x",
  after: "y",
  because: "why",
  command: ["yarn", "t"],
  verdict: "caught",
};
const good = { version: 1, lane: "W4", mutations: [mutation] };

const parse = (over: Record<string, unknown> = {}): unknown =>
  parseManifest(JSON.stringify({ ...good, ...over }));
const withMutation = (over: Record<string, unknown>): unknown =>
  parse({ mutations: [{ ...mutation, ...over }] });

describe("parseManifest", () => {
  test("accepts a well-formed manifest", () => {
    expect(parse()).toEqual(good);
  });

  test("refuses text that is not JSON", () => {
    expect(() => parseManifest("{oops")).toThrow(ManifestError);
  });

  test("refuses a document that is not an object", () => {
    expect(() => parseManifest("[]")).toThrow(/must be an object/);
  });

  test("refuses an unknown version rather than guessing the shape", () => {
    expect(() => parse({ version: 2 })).toThrow(/version must be 1/);
  });

  test("refuses a missing lane", () => {
    expect(() => parse({ lane: "" })).toThrow(
      /lane must be a non-empty string/,
    );
  });

  test("refuses an empty manifest, which would claim nothing", () => {
    expect(() => parse({ mutations: [] })).toThrow(/claims nothing/);
    expect(() => parse({ mutations: "no" })).toThrow(/claims nothing/);
  });

  test("refuses a mutation that is not an object", () => {
    expect(() => parse({ mutations: ["x"] })).toThrow(
      /mutations\[0\] must be an object/,
    );
  });

  test("refuses an empty or non-string command", () => {
    expect(() => withMutation({ command: [] })).toThrow(/non-empty array/);
    expect(() => withMutation({ command: [1] })).toThrow(/non-empty array/);
    expect(() => withMutation({ command: "yarn t" })).toThrow(
      /non-empty array/,
    );
  });

  test("refuses a survived verdict, and says why it is not a result to ship", () => {
    expect(() => withMutation({ verdict: "survived" })).toThrow(
      /a finding to fix, not a result to ship/,
    );
  });

  test("refuses any verdict that is not caught", () => {
    expect(() => withMutation({ verdict: "maybe" })).toThrow(
      /must be "caught"/,
    );
  });

  test("refuses a no-op, where before and after are identical", () => {
    expect(() => withMutation({ after: "x" })).toThrow(/nothing is mutated/);
  });

  test("accepts a retirement that states its reason", () => {
    expect(
      withMutation({
        retired: "the subject was deleted when its module was removed",
      }),
    ).toEqual({
      ...good,
      mutations: [
        {
          ...mutation,
          retired: "the subject was deleted when its module was removed",
        },
      ],
    });
  });

  test("leaves `retired` off a live mutation rather than carrying an empty one", () => {
    expect(parse()).toEqual(good);
    expect(Object.keys((parse() as typeof good).mutations[0]!)).not.toContain(
      "retired",
    );
  });

  test("refuses a retirement with no reason — a bare flag, or an empty one", () => {
    for (const bad of [true, "", "   \n ", 1, null, {}]) {
      expect(() => withMutation({ retired: bad })).toThrow(
        /must be a non-empty reason string/,
      );
    }
  });

  test("says why an unexplained retirement is refused, not merely that it is", () => {
    expect(() => withMutation({ retired: true })).toThrow(
      /indistinguishable from abandoning a test that was catching something real/,
    );
  });

  test("refuses an empty file, before, after or because", () => {
    for (const field of ["file", "before", "after", "because"] as const) {
      expect(() => withMutation({ [field]: "" })).toThrow(
        new RegExp(`${field} must be a non-empty string`),
      );
      expect(() => withMutation({ [field]: 7 })).toThrow(
        new RegExp(`${field} must be a non-empty string`),
      );
    }
  });
});
