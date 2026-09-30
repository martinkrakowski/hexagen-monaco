import { describe, test, expect } from "vitest";
import { readFile } from "node:fs/promises";

import {
  collect,
  type CollectDeps,
} from "../../src/wave-status/lib/collect.js";
import type { LaneStatus } from "../../src/internal/wave-types.js";

/**
 * The join, proved against a recording of a wave's whole shape: a `gh` PR
 * listing beside the listing of one wave log directory and its `events.jsonl`.
 *
 * The fixture is SYNTHETIC and so is every name in it. The source's fixture was
 * a verbatim recording of a real repository — its real pull-request list and its
 * real wave directory — and this package is published, so nothing of that ships.
 * What is NOT invented is what the data is for: the slug rewording, the event
 * whose `pr` is the only join, the four branch families, the re-cased tails, the
 * near misses, and the lanes that ran and never reported. A hand-built fixture
 * that assumed the convention was followed would prove nothing; these cases are
 * the ones that broke the join.
 */
interface RecordedFixture {
  readonly source: string;
  readonly waveDirName: string;
  readonly entries: readonly string[];
  readonly events: string;
  readonly ghPrList: readonly {
    readonly number: number;
    readonly state: string;
    readonly headRefName: string;
    readonly headRefOid: string;
  }[];
}

const ROOT = "/recorded";
const REPO_ROOT = "/recorded-repo";
const REPO = "acme/demo";

async function recordedFixture(): Promise<{
  readonly lanes: readonly LaneStatus[];
  readonly fixture: RecordedFixture;
}> {
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/pr-lane-join-synthetic.json", import.meta.url),
      "utf8",
    ),
  ) as RecordedFixture;
  const dir = `${ROOT}/${fixture.waveDirName}`;
  const deps: CollectDeps = {
    repoRoot: REPO_ROOT,
    repo: REPO,
    planningDir: `${REPO_ROOT}/docs/planning`,
    readdir: async (path) => {
      if (path === ROOT) return [fixture.waveDirName];
      if (path === dir) return fixture.entries;
      throw new Error(`ENOENT: readdir ${path}`);
    },
    readFile: async (path) => {
      if (path === `${dir}/events.jsonl`) return fixture.events;
      throw new Error(`ENOENT: readFile ${path}`);
    },
    open: async (path) => {
      throw new Error(`ENOENT: open ${path}`);
    },
    pgrep: async () => 0,
    gh: async (args) =>
      (args[0] === "api" && args[1].includes("pulls")) || args[0] === "pr"
        ? JSON.stringify(fixture.ghPrList)
        : "not json",
  };
  const status = await collect(deps, ROOT, "2026-03-14T12:00:00Z");
  // The recorded listing is well-formed, so the PR sweep must have read it: a
  // row the parser dropped would leave the silent nine absent for the wrong reason.
  expect(status.prs).toBeUndefined();
  return {
    fixture,
    lanes:
      status.waves.find((wave) => wave.id === "landing-pages")?.lanes ?? [],
  };
}

/** Every lane → PR number the recorded data produces. Derived from the rules, not the code. */
const RECORDED_JOIN: Readonly<Record<string, number>> = {
  "Q1-amber-route": 3104,
  "Q1a-birch-select": 3117,
  "Q2-cedar-probing": 3122,
  "X12-delta-version": 3091,
  "X1a-ember-vocabulary": 3108,
  "X1b-fjord-outline": 3113,
  "X2a-garnet-stacking-list": 3096,
  "X2b-heron-drift-cycle": 3120,
  "H3a-iris-required": 3099,
  "H3b-juniper-props": 3125,
  "H4-kestrel-rules": 3102,
  "H5-lichen-editor": 3110,
  "H6-marlin-coral-index": 3093,
  "H7a1-nettle-store": 3115,
  "D8a-osprey-shuffle": 3106,
  "D1c-pebble-hardening": 3128,
  "D2a-quartz-layout": 3101,
  "D2b1-russet-toolbar": 3119,
};

/**
 * The lanes the recording's events name — all 24, sorted. The join resolves 18
 * of them; the rest are the near-misses the last test pins.
 */
const RECORDED_EVENT_LANES: readonly string[] = [
  "D1-quartz-cli",
  "D1c-pebble-hardening",
  "D2a-quartz-layout",
  "D2b-sorrel-viewer",
  "D2b1-russet-toolbar",
  "D7b3r",
  "D8-osprey-occlusion",
  "D8a-osprey-shuffle",
  "ES7b",
  "H3a-iris-required",
  "H3b-juniper-props",
  "H4-kestrel-rules",
  "H5-lichen-editor",
  "H6-marlin-coral-index",
  "H7a-nettle-library",
  "H7a1-nettle-store",
  "Q1-amber-route",
  "Q1a-birch-select",
  "Q2-cedar-probing",
  "X12-delta-version",
  "X1a-ember-vocabulary",
  "X1b-fjord-outline",
  "X2a-garnet-stacking-list",
  "X2b-heron-drift-cycle",
];

/**
 * Lanes the recording ran but never reported: a log and a PR carry their name,
 * no event does. Under the evidence rule they are invisible to the page — the
 * honest cost of "a log never buys a row", asserted so the cost cannot quietly
 * turn back into a phantom-lane revival. Closing the gap means making the
 * runners emit, not making the page guess from filenames again.
 */
const NEVER_REPORTED: readonly string[] = [
  "D1a-quartz-cli",
  "E6c9",
  "E5k",
  "E5p",
  "ES7",
  "N3",
  "N7",
  "N9",
  "NQ",
];

/**
 * The four lanes whose settled event carries NO `pr`, so the only way they can
 * join is the branch rules. An event's own `pr` is returned before those rules
 * run; a fixture where every lane carried one would leave the case-fold,
 * prefix-family and descendant rules unexercised and still pass.
 */
const BRANCH_ONLY_LANES: readonly string[] = [
  "Q1a-birch-select",
  "Q2-cedar-probing",
  "D8a-osprey-shuffle",
  "D2b1-russet-toolbar",
];

function assertNoEventPr(fixture: RecordedFixture): void {
  const events = fixture.events
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { lane: string; pr?: number });
  for (const lane of BRANCH_ONLY_LANES) {
    const own = events.filter((event) => event.lane === lane);
    expect(own.length, `${lane} has events`).toBeGreaterThan(0);
    for (const event of own) expect(event.pr, lane).toBeUndefined();
  }
}

describe("the PR-to-lane join against a recording of a wave's whole shape", () => {
  test("the fixture declares that it is synthetic, so nobody can mistake it for a recording", async () => {
    const { fixture } = await recordedFixture();
    expect(fixture.source).toMatch(/synthetic/i);
    expect(fixture.source).toMatch(/is a recording of any real repository/i);
  });

  test("the join is non-empty: 18 of the 24 recorded lanes the events name resolve to their PR", async () => {
    const { lanes } = await recordedFixture();
    expect(lanes.map((lane) => lane.lane).sort()).toEqual(
      [...RECORDED_EVENT_LANES].sort(),
    );
    const joined: Record<string, number> = {};
    for (const lane of lanes) {
      if (lane.derived.pr !== undefined)
        joined[lane.lane] = lane.derived.pr.number;
    }
    expect(joined).toEqual(RECORDED_JOIN);
  });

  test("a log and a PR name a lane, but only an event creates one: the silent nine are absent", async () => {
    // Every one of these really had a log and a pull request — it was dispatched
    // without the event writer being told. A collector that counted logs showed
    // them; this one shows nothing, and the nine are pinned here so the trade
    // stays a decision, not a drift.
    const { lanes } = await recordedFixture();
    const names = new Set(lanes.map((lane) => lane.lane));
    for (const silent of NEVER_REPORTED) {
      expect(names.has(silent)).toBe(false);
    }
  });

  test("the old exact `feat/<lane>` rule joined nothing: no feat slug spells a lane exactly", async () => {
    // The defect this whole fixture exists for: a collector that matched
    // `feat/<lane>` verbatim joined nothing at all, because every branch in it
    // was re-cased, re-worded or carried a suffix.
    const { lanes, fixture } = await recordedFixture();
    const oldRuleKeys = fixture.ghPrList
      .filter((entry) => entry.headRefName.startsWith("feat/"))
      .map((entry) => entry.headRefName.slice("feat/".length));
    expect(oldRuleKeys.length).toBeGreaterThan(0);
    expect(
      lanes
        .map((lane) => lane.lane)
        .filter((lane) => oldRuleKeys.includes(lane)),
    ).toEqual([]);
  });

  test("the event's own pr joins a lane whose branch slug was reworded and no branch could find", async () => {
    const { lanes, fixture } = await recordedFixture();
    const row = lanes.find((lane) => lane.lane === "X2a-garnet-stacking-list");
    // A merged PR, so the sweep never took its checks: the fact is "could not
    // ask", never the old overloaded word that meant four things at once. The
    // join — the point of this fixture — is untouched by it.
    expect(row?.derived.pr).toEqual({
      number: 3096,
      state: "merged",
      checks: "unknown",
    });
    expect(fixture.ghPrList.map((entry) => entry.headRefName)).not.toContain(
      "feat/X2a-garnet-stacking-list",
    );
  });

  test("the fallback normalises case and prefix family without being pinned to either", async () => {
    const { lanes, fixture } = await recordedFixture();
    assertNoEventPr(fixture);
    const rows = Object.fromEntries(
      lanes.map((lane) => [lane.lane, lane.derived.pr?.number]),
    );
    // `Q1a-birch-select` and `Q2-cedar-probing` reach lower-cased `fix/` tails;
    // `D8a-osprey-shuffle` reaches a `feat/` one; `D2b1-russet-toolbar` a `docs/` one. The
    // match is case-folded and prefix-agnostic, and pinned to no single family.
    expect(rows["Q1a-birch-select"]).toBe(3117);
    expect(rows["Q2-cedar-probing"]).toBe(3122);
    expect(rows["D8a-osprey-shuffle"]).toBe(3106);
    expect(rows["D2b1-russet-toolbar"]).toBe(3119);
  });

  test("a descendant slug joins its lane, and a lane never joins a sibling that merely shares a prefix", async () => {
    const { lanes, fixture } = await recordedFixture();
    assertNoEventPr(fixture);
    const rows = Object.fromEntries(
      lanes.map((lane) => [lane.lane, lane.derived.pr?.number]),
    );
    // `feat/d8a-osprey-shuffle-2` is a descendant of lane `D8a-osprey-shuffle` and joins it.
    expect(rows["D8a-osprey-shuffle"]).toBe(3106);
    // And none of these reaches a neighbour's pull request.
    expect(rows["H7a-nettle-library"]).toBeUndefined();
    expect(rows["D8-osprey-occlusion"]).toBeUndefined();
    expect(rows["D1-quartz-cli"]).toBeUndefined();
    expect(rows["D2b-sorrel-viewer"]).toBeUndefined();
    expect(rows["D7b3r"]).toBeUndefined();
    expect(rows["ES7b"]).toBeUndefined();
  });
});
