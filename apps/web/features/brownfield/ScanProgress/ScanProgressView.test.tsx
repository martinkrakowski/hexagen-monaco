import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ScanProgressView } from "./ScanProgressView";
import type { ScanStageProgress } from "./scan-stream";

/**
 * S2 rendering (BF-5.3). jest-dom is not registered here, so assertions use
 * `toBeTruthy()` / `getAttribute()` / `toBeNull()`.
 *
 * The load-bearing test in this file is the one that proves a git progress
 * line containing a percentage is shown VERBATIM in the log and is not turned
 * into a bar: "no synthetic percentages" is a rule about what the UI draws, not
 * about which characters may appear in a transcript.
 */

function stage(overrides: Partial<ScanStageProgress> = {}): ScanStageProgress {
  return {
    stage: 0,
    label: "Clone",
    phase: "running",
    durationMs: null,
    lines: [],
    clipped: false,
    receivedBytes: null,
    ...overrides,
  };
}

function renderView(
  overrides: Partial<Parameters<typeof ScanProgressView>[0]> = {},
) {
  const props = {
    repoLabel: "acme/checkout @ main",
    stages: [stage(), stage({ stage: 1, label: "Scan", phase: "waiting" })],
    summary: "Clone in progress…",
    streaming: true,
    logLines: [],
    logClipped: false,
    runId: null,
    failure: null,
    outcome: null,
    ...overrides,
  };
  return { ...render(<ScanProgressView {...props} />), props };
}

describe("ScanProgressView", () => {
  it("names the repository and announces the summary politely", () => {
    renderView();
    expect(screen.getByText("Scanning acme/checkout @ main")).toBeTruthy();
    const live = screen.getByRole("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("Clone in progress…");
  });

  it("composes StageProgressList rather than drawing its own dots", () => {
    const { container } = renderView({
      stages: [
        stage({ phase: "done", durationMs: 1900 }),
        stage({ stage: 1, label: "Scan", phase: "running" }),
      ],
    });
    const dots = container.querySelectorAll("[data-stage-status]");
    expect(dots).toHaveLength(2);
    expect(dots[0].getAttribute("data-stage-status")).toBe("complete");
    expect(dots[1].getAttribute("data-stage-status")).toBe("active");
    // The component's own accessible naming, unchanged by this host.
    expect(dots[0].getAttribute("aria-label")).toBe("Clone: complete");
    // And the duration it renders for a completed stage.
    expect(container.textContent).toContain("1.9s");
  });

  it("draws NO progress bar and no percentage of its own", () => {
    const { container } = renderView({
      stages: [stage({ receivedBytes: 19_293_798 })],
    });
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.querySelector("progress")).toBeNull();
    expect(container.textContent).not.toContain("%");
    // A real figure IS shown, because it is real.
    expect(container.textContent).toContain("18.4 MiB");
  });

  it("shows git's own percentage line verbatim in the log without drawing one", () => {
    const { container } = renderView({
      logLines: [
        "remote: Enumerating objects: 2481, done.",
        "Receiving objects:  62% (1540/2481), 8.10 MiB",
      ],
      stages: [stage({ receivedBytes: null })],
    });
    expect(container.textContent).toContain("Receiving objects:  62%");
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    // No figure was reported for the stage, so the stage row shows none —
    // it does not fall back to the number embedded in the log line.
    const stageRow = container.querySelector("ul li span:last-child");
    expect(stageRow?.textContent).toBe("");
  });

  it("hides and shows the log without losing it", () => {
    const { container } = renderView({
      logLines: ["remote: Counting objects"],
    });
    const toggle = screen.getByRole("button", { name: "Hide" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const controls = toggle.getAttribute("aria-controls") ?? "";
    expect(document.getElementById(controls)).toBeTruthy();

    fireEvent.click(toggle);
    const reopened = screen.getByRole("button", { name: "Show" });
    expect(reopened.getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById(controls)).toBeNull();
    expect(container.textContent).not.toContain("remote: Counting objects");
  });

  it("renders no log panel at all when nothing has been logged", () => {
    renderView({ logLines: [] });
    expect(screen.queryByRole("button", { name: /hide|show/i })).toBeNull();
  });

  it("says when the log was clipped rather than silently dropping lines", () => {
    const { container } = renderView({
      logLines: ["a", "b"],
      logClipped: true,
    });
    expect(container.textContent).toContain("most recent 200 lines");
  });

  it("shows the failure copy and NO result panel when the run is blocked", () => {
    const { container } = renderView({
      streaming: false,
      summary: "That repository could not be cloned",
      failure: {
        title: "That repository could not be cloned",
        detail: "The repository could not be cloned.",
        hint: "Check the owner, repository and branch.",
        code: "clone_failed",
      },
    });
    // Twice on purpose: once as the live-region summary, once as the panel's
    // heading. `getAllByText` rather than `getByText`, which would throw.
    expect(
      screen.getAllByText("That repository could not be cloned").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("Check the owner, repository and branch."),
    ).toBeTruthy();
    // "blocked, no artifacts": nothing that reads as a result is on screen.
    expect(container.textContent).not.toContain("hexagen scan exited");
    expect(container.firstElementChild?.getAttribute("aria-busy")).toBe(
      "false",
    );
  });

  it("composes ScanResultPanel for a finished run, and the note under it", () => {
    const { container } = renderView({
      streaming: false,
      summary: "Scan finished. The result is below.",
      outcome: {
        verdict: "violations",
        exitCode: 1,
        projectName: "checkout",
        layoutExcerpt: "contexts:\n  orders: {}",
        filesScanned: 2481,
        reportMarkdown: "# report",
        errorMessage: null,
      },
      resultNote: "Ratifying the layout arrives next.",
    });
    expect(screen.getByText("Scan found violations")).toBeTruthy();
    expect(container.textContent).toContain("hexagen scan exited 1");
    expect(container.textContent).toContain("2481 files scanned");
    expect(screen.getByText("Ratifying the layout arrives next.")).toBeTruthy();
  });

  it("shows the server's run id so it can be quoted in a bug report", () => {
    const { container } = renderView({
      runId: "4f1b2c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    });
    expect(container.textContent).toContain(
      "4f1b2c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    );
  });

  it("marks the region busy only while frames may still arrive", () => {
    const { container: live } = renderView({ streaming: true });
    expect(live.firstElementChild?.getAttribute("aria-busy")).toBe("true");
    const { container: settled } = renderView({ streaming: false });
    expect(settled.firstElementChild?.getAttribute("aria-busy")).toBe("false");
  });
});
