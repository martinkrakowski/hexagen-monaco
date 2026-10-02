import { describe, it, expect } from "vitest";
import { readBundle, type LoadedBundle } from "../bundle/read-bundle";
import { deriveSteps, STEP_IDS } from "../steps";
import {
  buildBundle,
  contract,
  observed,
  slice,
  validFiles,
  type FixtureFile,
} from "./bundle-fixtures";

async function load(files: FixtureFile[]): Promise<LoadedBundle> {
  const r = await readBundle(await buildBundle(files));
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.bundle;
}
const without = (...paths: string[]) =>
  validFiles().filter((f) => !paths.includes(f.path));
const status = (b: LoadedBundle) =>
  Object.fromEntries(deriveSteps(b).map((s) => [s.id, s.status]));

describe("deriveSteps", () => {
  it("lists the six steps in order, each with its CLI command", async () => {
    const steps = deriveSteps(await load(validFiles()));
    expect(steps.map((s) => s.label)).toEqual([
      "Checkout",
      "Observe",
      "Slice",
      "Contract",
      "Grant",
      "Evidence",
    ]);
    expect(STEP_IDS).toHaveLength(6);
    expect(steps.find((s) => s.id === "evidence")?.command).toBe(
      "hexagen evidence pack",
    );
    for (const s of steps) expect(s.command.length).toBeGreaterThan(0);
  });

  it("marks a complete bundle present everywhere", async () => {
    expect(status(await load(validFiles()))).toEqual({
      checkout: "present",
      observe: "present",
      slice: "present",
      contract: "present",
      grant: "present",
      evidence: "present",
    });
  });

  it("marks Observe incomplete when edgesComplete is false", async () => {
    const files = validFiles().map((f) =>
      f.path === "observed.json"
        ? { ...f, content: observed({ edgesComplete: false }) }
        : f,
    );
    const b = await load(files);
    expect(status(b).observe).toBe("incomplete");
    expect(
      deriveSteps(b)
        .find((s) => s.id === "observe")
        ?.detail.join(" "),
    ).toMatch(/Go/);
  });

  it("marks Observe incomplete when the scan was truncated", async () => {
    const files = validFiles().map((f) =>
      f.path === "observed.json"
        ? { ...f, content: observed({ truncated: true }) }
        : f,
    );
    expect(status(await load(files)).observe).toBe("incomplete");
  });

  it("marks absent documents missing", async () => {
    const s = status(
      await load(
        without(
          "observed.json",
          "slice.json",
          "contract.json",
          "grants/0-g1.json",
          "evidence/trace.jsonl",
          "evidence/verdicts.json",
          "tip.json",
        ),
      ),
    );
    expect(s).toEqual({
      checkout: "missing",
      observe: "missing",
      slice: "missing",
      contract: "missing",
      grant: "missing",
      evidence: "missing",
    });
  });

  it("marks Evidence incomplete when the verdicts are absent", async () => {
    expect(status(await load(without("evidence/verdicts.json"))).evidence).toBe(
      "incomplete",
    );
  });

  it("marks Contract incomplete when it names another slice", async () => {
    const files = validFiles().map((f) =>
      f.path === "contract.json"
        ? { ...f, content: contract.replace("slice-1", "slice-2") }
        : f,
    );
    expect(status(await load(files)).contract).toBe("incomplete");
  });

  it("derives the status from the bundle only: slice present, contract present, still no Grant", async () => {
    const s = status(await load(without("grants/0-g1.json")));
    expect(s.slice).toBe("present");
    expect(s.grant).toBe("missing");
    expect(slice).toContain("slice-1");
  });

  it("builds the evidence view: tail with denials marked, and the recorded verdict", async () => {
    const ev = deriveSteps(await load(validFiles())).find(
      (s) => s.id === "evidence",
    )?.evidence;
    expect(ev?.tail.map((l) => [l.seq, l.denial])).toEqual([
      [0, false],
      [1, true],
    ]);
    expect(ev?.denials[0]?.reason).toBe("outside the slice");
    expect(ev?.verdict).toMatch(/all 2 trace lines valid/i);
  });
});
