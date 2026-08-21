import { describe, it, expect } from "vitest";
import {
  transitionState,
  canTransition,
  getInitialState,
  isTerminalState,
  isBlockingState,
} from "./brownfield-flow-state-machine";
import type {
  BrownfieldFlowEvent,
  BrownfieldFlowState,
} from "./brownfield-flow-state-machine";

const ALL_STATES: BrownfieldFlowState[] = [
  "tier_pick",
  "uploading",
  "repo_entry",
  "scanning",
  "blocked",
  "layout_ratify",
  "manifest_ratify",
  "findings_review",
  "report",
  "gate_install",
];

/**
 * The transition table, restated independently of the implementation. If the
 * machine's table and this one drift, the exhaustive check below fails.
 */
const EXPECTED_EDGES: Record<BrownfieldFlowState, BrownfieldFlowState[]> = {
  tier_pick: ["uploading", "repo_entry"],
  uploading: ["scanning", "blocked", "tier_pick"],
  repo_entry: ["scanning", "blocked", "tier_pick"],
  scanning: ["layout_ratify", "blocked"],
  blocked: ["tier_pick"],
  layout_ratify: ["manifest_ratify", "tier_pick"],
  manifest_ratify: ["findings_review", "report", "layout_ratify"],
  findings_review: ["report", "manifest_ratify"],
  report: ["gate_install"],
  gate_install: [],
};

describe("BrownfieldFlowStateMachine", () => {
  describe("getInitialState", () => {
    it("starts on the tier picker, before any code moves", () => {
      expect(getInitialState()).toBe("tier_pick");
    });
  });

  describe("canTransition — exhaustive table", () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const allowed = EXPECTED_EDGES[from].includes(to);
        it(`${allowed ? "allows" : "rejects"} ${from} -> ${to}`, () => {
          expect(canTransition(from, to)).toBe(allowed);
        });
      }
    }
  });

  describe("transitionState — happy path", () => {
    const transitions: Array<{
      name: string;
      from: BrownfieldFlowState;
      event: BrownfieldFlowEvent;
      to: BrownfieldFlowState;
    }> = [
      {
        name: "SELECT_TIER(artifacts)",
        from: "tier_pick",
        event: { type: "SELECT_TIER", tier: "artifacts" },
        to: "uploading",
      },
      {
        name: "SELECT_TIER(zip)",
        from: "tier_pick",
        event: { type: "SELECT_TIER", tier: "zip" },
        to: "uploading",
      },
      {
        name: "SELECT_TIER(clone)",
        from: "tier_pick",
        event: { type: "SELECT_TIER", tier: "clone" },
        to: "repo_entry",
      },
      {
        name: "UPLOAD_COMPLETE",
        from: "uploading",
        event: { type: "UPLOAD_COMPLETE" },
        to: "scanning",
      },
      {
        name: "SUBMIT_REPO_REF",
        from: "repo_entry",
        event: {
          type: "SUBMIT_REPO_REF",
          repoUrl: "https://github.com/acme/widgets",
          ref: "main",
        },
        to: "scanning",
      },
      {
        name: "SCAN_COMPLETE",
        from: "scanning",
        event: { type: "SCAN_COMPLETE" },
        to: "layout_ratify",
      },
      {
        name: "RATIFY_LAYOUT",
        from: "layout_ratify",
        event: { type: "RATIFY_LAYOUT" },
        to: "manifest_ratify",
      },
      {
        name: "RATIFY_FINDINGS",
        from: "findings_review",
        event: { type: "RATIFY_FINDINGS" },
        to: "report",
      },
      {
        name: "INSTALL_GATE",
        from: "report",
        event: { type: "INSTALL_GATE" },
        to: "gate_install",
      },
    ];

    it.each(transitions)("moves to $to on $name", ({ from, event, to }) => {
      expect(transitionState(from, event)).toBe(to);
    });

    it("walks the full Tier-A path end to end", () => {
      let state = getInitialState();
      const script: BrownfieldFlowEvent[] = [
        { type: "SELECT_TIER", tier: "artifacts" },
        { type: "UPLOAD_COMPLETE" },
        { type: "SCAN_COMPLETE" },
        { type: "RATIFY_LAYOUT" },
        { type: "RATIFY_MANIFEST", freshFindingCount: 3 },
        { type: "RATIFY_FINDINGS" },
        { type: "INSTALL_GATE" },
      ];
      for (const event of script) {
        const next = transitionState(state, event);
        expect(canTransition(state, next)).toBe(true);
        state = next;
      }
      expect(state).toBe("gate_install");
    });
  });

  describe("blocked is recoverable", () => {
    it("enters blocked when the upload is rejected", () => {
      expect(
        transitionState("uploading", {
          type: "UPLOAD_FAILED",
          reason: "upload-rejected",
        }),
      ).toBe("blocked");
    });

    it("enters blocked when the scan could not run", () => {
      expect(
        transitionState("scanning", {
          type: "SCAN_BLOCKED",
          reason: "could-not-run",
        }),
      ).toBe("blocked");
    });

    it("enters blocked from repo entry when the repo is unreachable", () => {
      expect(
        transitionState("repo_entry", {
          type: "SCAN_BLOCKED",
          reason: "repo-unreachable",
        }),
      ).toBe("blocked");
    });

    it("recovers to the tier picker via TRY_ANOTHER_TIER", () => {
      expect(transitionState("blocked", { type: "TRY_ANOTHER_TIER" })).toBe(
        "tier_pick",
      );
      expect(canTransition("blocked", "tier_pick")).toBe(true);
    });

    it("recovers to the tier picker via Back too — blocked is never a dead end", () => {
      expect(transitionState("blocked", { type: "GO_BACK" })).toBe("tier_pick");
    });
  });

  describe("findings_review is skipped when there are no fresh findings", () => {
    it("goes straight to the report on zero fresh findings", () => {
      expect(
        transitionState("manifest_ratify", {
          type: "RATIFY_MANIFEST",
          freshFindingCount: 0,
        }),
      ).toBe("report");
      expect(canTransition("manifest_ratify", "report")).toBe(true);
    });

    it("stops at findings_review when there is at least one fresh finding", () => {
      expect(
        transitionState("manifest_ratify", {
          type: "RATIFY_MANIFEST",
          freshFindingCount: 1,
        }),
      ).toBe("findings_review");
    });
  });

  describe("back edges", () => {
    it("returns manifest_ratify -> layout_ratify", () => {
      expect(transitionState("manifest_ratify", { type: "GO_BACK" })).toBe(
        "layout_ratify",
      );
    });

    it("returns findings_review -> manifest_ratify", () => {
      expect(transitionState("findings_review", { type: "GO_BACK" })).toBe(
        "manifest_ratify",
      );
    });

    it("returns layout_ratify -> tier_pick, never re-running the scan", () => {
      expect(transitionState("layout_ratify", { type: "GO_BACK" })).toBe(
        "tier_pick",
      );
      expect(canTransition("layout_ratify", "scanning")).toBe(false);
    });

    it("returns uploading and repo_entry to the tier picker", () => {
      expect(transitionState("uploading", { type: "GO_BACK" })).toBe(
        "tier_pick",
      );
      expect(transitionState("repo_entry", { type: "GO_BACK" })).toBe(
        "tier_pick",
      );
    });

    it("ignores Back while scanning and on the tier picker itself", () => {
      expect(transitionState("scanning", { type: "GO_BACK" })).toBe("scanning");
      expect(transitionState("tier_pick", { type: "GO_BACK" })).toBe(
        "tier_pick",
      );
    });
  });

  describe("report is terminal-with-actions and never auto-navigates", () => {
    const nonInstallEvents: BrownfieldFlowEvent[] = [
      { type: "SCAN_COMPLETE" },
      { type: "RATIFY_LAYOUT" },
      { type: "RATIFY_MANIFEST", freshFindingCount: 0 },
      { type: "RATIFY_MANIFEST", freshFindingCount: 7 },
      { type: "RATIFY_FINDINGS" },
      { type: "UPLOAD_COMPLETE" },
      { type: "GO_BACK" },
    ];

    it.each(nonInstallEvents)(
      "stays on report for $type unless the user installs the gate",
      (event) => {
        expect(transitionState("report", event)).toBe("report");
      },
    );

    it("only leaves report on the explicit INSTALL_GATE action", () => {
      expect(transitionState("report", { type: "INSTALL_GATE" })).toBe(
        "gate_install",
      );
      expect(EXPECTED_EDGES.report).toEqual(["gate_install"]);
    });

    it("is not reported as terminal, so its actions keep rendering", () => {
      expect(isTerminalState("report")).toBe(false);
    });
  });

  describe("events that do not belong to the current screen are inert", () => {
    it("cannot install the gate from the tier picker", () => {
      expect(transitionState("tier_pick", { type: "INSTALL_GATE" })).toBe(
        "tier_pick",
      );
    });

    it("cannot ratify a layout that has not been scanned yet", () => {
      expect(transitionState("tier_pick", { type: "RATIFY_LAYOUT" })).toBe(
        "tier_pick",
      );
    });

    it("cannot re-enter the flow from the terminal gate_install state", () => {
      for (const event of [
        { type: "SELECT_TIER", tier: "zip" },
        { type: "GO_BACK" },
        { type: "TRY_ANOTHER_TIER" },
      ] as BrownfieldFlowEvent[]) {
        expect(transitionState("gate_install", event)).toBe("gate_install");
      }
    });
  });

  describe("isTerminalState", () => {
    it("is true only for gate_install", () => {
      for (const state of ALL_STATES) {
        expect(isTerminalState(state)).toBe(state === "gate_install");
      }
    });
  });

  describe("isBlockingState", () => {
    it("is true only while work is in flight", () => {
      for (const state of ALL_STATES) {
        expect(isBlockingState(state)).toBe(
          state === "uploading" || state === "scanning",
        );
      }
    });
  });
});

describe("findings_review is skipped only on an explicit zero", () => {
  // Malformed upstream data must not silently bypass a ratification step the
  // user is meant to see. Showing an extra screen is benign; skipping one is not.
  const skipCases: Array<[string, number, string]> = [
    ["exactly zero skips", 0, "report"],
    ["a positive count reviews", 7, "findings_review"],
    ["a negative count still reviews", -1, "findings_review"],
    ["NaN still reviews", Number.NaN, "findings_review"],
  ];

  for (const [name, count, expected] of skipCases) {
    it(name, () => {
      expect(
        transitionState("manifest_ratify", {
          type: "RATIFY_MANIFEST",
          freshFindingCount: count,
        }),
      ).toBe(expected);
    });
  }
});
