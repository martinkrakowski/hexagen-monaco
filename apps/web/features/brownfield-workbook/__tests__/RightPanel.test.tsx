import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RightPanel } from "../right/RightPanel";
import { BrownfieldViewerPage } from "../BrownfieldViewerPage";
import { PROPOSAL_DISPLAY_CAP_BYTES } from "../right/proposal-text";
import {
  PATCH,
  grantDoc,
  loadSpec,
  missingLine,
  proposalMeta,
  traceLine,
} from "./right-fixtures";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("fetch must not be called");
    }),
  );
  vi.stubGlobal("XMLHttpRequest", function () {
    throw new Error("XHR must not be used");
  });
  vi.stubGlobal("WebSocket", function () {
    throw new Error("WebSocket must not be used");
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const proposalFiles = (patch: string | Uint8Array = PATCH) => [
  { path: "proposals/p1.patch", role: "proposal", content: patch },
  { path: "proposals/p1.json", role: "proposal", content: proposalMeta() },
];

describe("RightPanel: the grant", () => {
  it("renders tools, paths, mode, expiry, principal, agent and the slice", async () => {
    render(<RightPanel bundle={await loadSpec()} />);
    const g = screen.getByTestId("grant-g1");
    expect(within(g).getByText("hexagen_propose_patch")).toBeTruthy();
    expect(within(g).getByText("core/")).toBeTruthy();
    expect(within(g).getByText("propose")).toBeTruthy();
    expect(within(g).getByText("fde-alice")).toBeTruthy();
    expect(within(g).getByText("agent-7")).toBeTruthy();
    expect(within(g).getByText(/2026-10-01T12:00:00\.000Z/)).toBeTruthy();
    expect(within(g).queryByText(/expired at bundle time/i)).toBeNull();
    expect(screen.getByText(/slice-1/)).toBeTruthy();
  });

  it("judges expiry at the bundle's time, not the wall clock", async () => {
    const bundle = await loadSpec({
      grants: [grantDoc({ expires_at: "2026-10-01T09:00:00.000Z" })],
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
    render(<RightPanel bundle={bundle} />);
    expect(screen.getByText(/expired at bundle time/i)).toBeTruthy();
  });

  it("does not call a grant expired because the wall clock moved on", async () => {
    const bundle = await loadSpec();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
    render(<RightPanel bundle={bundle} />);
    expect(screen.queryByText(/expired at bundle time/i)).toBeNull();
  });

  it("lists every grant and says so when none can be told active", async () => {
    render(
      <RightPanel
        bundle={await loadSpec({
          grants: [grantDoc({ id: "g1" }), grantDoc({ id: "g2" })],
          trace: [traceLine({ grant_id: "gX" })],
        })}
      />,
    );
    expect(screen.getByTestId("grant-g1")).toBeTruthy();
    expect(screen.getByTestId("grant-g2")).toBeTruthy();
    expect(screen.getByText(/cannot tell which grant is active/i)).toBeTruthy();
  });

  it("strips control characters from grant text", async () => {
    render(
      <RightPanel
        bundle={await loadSpec({
          grants: [grantDoc({ principal: "al\u001b[31mice\u0007" })],
        })}
      />,
    );
    expect(screen.getByText("alice")).toBeTruthy();
  });
});

describe("RightPanel: proposals", () => {
  it("renders a diff as inert text in a pre, with per-line classes", async () => {
    const hostile = `${PATCH}+<img src=x onerror=alert(1)>\n+<script>alert(1)</script>\n`;
    const { container } = render(
      <RightPanel
        bundle={await loadSpec({ proposals: proposalFiles(hostile) })}
      />,
    );
    const pre = screen.getByTestId("proposal-p1").querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img, script")).toBeNull();
    expect(pre?.querySelectorAll("*").length).toBeGreaterThan(0);
    for (const el of pre?.querySelectorAll("*") ?? []) {
      expect(el.tagName).toBe("SPAN");
    }
    expect(screen.getByText("+const a = 2;").className).toMatch(/emerald/);
    expect(screen.getByText("-const a = 1;").className).toMatch(/destructive/);
  });

  it("strips control characters from a diff", async () => {
    render(
      <RightPanel
        bundle={await loadSpec({
          proposals: proposalFiles("+x\u001b[2Jy\u0007\n"),
        })}
      />,
    );
    expect(screen.getByText("+xy")).toBeTruthy();
  });

  it("shows the metadata and a copy button for the apply command", async () => {
    render(
      <RightPanel bundle={await loadSpec({ proposals: proposalFiles() })} />,
    );
    const p = screen.getByTestId("proposal-p1");
    expect(within(p).getAllByText("core/a.ts").length).toBeGreaterThan(0);
    expect(
      within(p).getByText("git apply -p1 .hexagen/proposals/p1.patch"),
    ).toBeTruthy();
  });

  it("labels a non-UTF-8 proposal, and the bundle still opens", async () => {
    const bad = new Uint8Array([0x2b, 0x61, 0xff, 0x62, 0x0a]);
    render(
      <RightPanel bundle={await loadSpec({ proposals: proposalFiles(bad) })} />,
    );
    expect(
      screen.getByText(/not valid UTF-8; shown with replacement characters/i),
    ).toBeTruthy();
    expect(screen.getByText("+a�b")).toBeTruthy();
  });

  it("does not label a valid proposal", async () => {
    render(
      <RightPanel bundle={await loadSpec({ proposals: proposalFiles() })} />,
    );
    expect(screen.queryByText(/not valid UTF-8/i)).toBeNull();
  });

  it("caps the bytes shown and says it truncated", async () => {
    const big = "+0123456789abcdef0123456789abcdef\n".repeat(
      Math.ceil((PROPOSAL_DISPLAY_CAP_BYTES * 1.5) / 34),
    );
    render(
      <RightPanel bundle={await loadSpec({ proposals: proposalFiles(big) })} />,
    );
    const p = screen.getByTestId("proposal-p1");
    expect(within(p).getByText(/truncated/i)).toBeTruthy();
    const shown = p.querySelector("pre")?.textContent?.length ?? 0;
    expect(shown).toBeLessThanOrEqual(PROPOSAL_DISPLAY_CAP_BYTES);
    expect(shown).toBeGreaterThan(PROPOSAL_DISPLAY_CAP_BYTES / 2);
  });

  it("says so when the bundle has no proposals", async () => {
    render(<RightPanel bundle={await loadSpec()} />);
    expect(screen.getByText(/no proposals in this bundle/i)).toBeTruthy();
  });
});

describe("RightPanel: denials", () => {
  it("renders each denial code as its own line, and no other line", async () => {
    render(
      <RightPanel
        bundle={await loadSpec({
          trace: [
            traceLine({ seq: 0 }),
            traceLine({
              seq: 1,
              halt_reason: "grant_denied",
              tool_calls: [
                {
                  name: "hexagen_propose_patch",
                  args_digest: "a",
                  result_digest: "b",
                  time: "2026-10-01T09:30:00.000Z",
                },
              ],
            }),
            traceLine({ seq: 2, halt_reason: "grant_expired" }),
            traceLine({ seq: 3, halt_reason: "grant_revoked" }),
            traceLine({ seq: 4, halt_reason: "error" }),
            missingLine({ seq: 5, reason: "no grant\u001b[0m supplied" }),
          ],
        })}
      />,
    );
    const items = within(screen.getByTestId("denials")).getAllByRole(
      "listitem",
    );
    expect(items.map((i) => i.getAttribute("data-code"))).toEqual([
      "grant_denied",
      "grant_expired",
      "grant_revoked",
      "grant_missing",
    ]);
    expect(
      within(items[0] as HTMLElement).getByText(/hexagen_propose_patch/),
    ).toBeTruthy();
    expect(
      within(items[0] as HTMLElement).getByText(/2026-10-01T09:30:00\.000Z/),
    ).toBeTruthy();
    expect(within(items[0] as HTMLElement).queryByText(/reason/i)).toBeNull();
    expect(
      within(items[3] as HTMLElement).getByText(/no grant supplied/),
    ).toBeTruthy();
  });

  it("says there are none when the trace holds no denial", async () => {
    render(<RightPanel bundle={await loadSpec()} />);
    expect(screen.getByText(/no denials in the trace/i)).toBeTruthy();
  });

  it("shows denials beyond the trace tail", async () => {
    const trace = [traceLine({ seq: 0, halt_reason: "grant_denied" })];
    for (let i = 1; i < 40; i++) trace.push(traceLine({ seq: i }));
    render(<RightPanel bundle={await loadSpec({ trace })} />);
    expect(
      within(screen.getByTestId("denials")).getAllByRole("listitem"),
    ).toHaveLength(1);
  });
});

describe("RightPanel: more of the record", () => {
  it("says revoked at bundle time", async () => {
    render(
      <RightPanel
        bundle={await loadSpec({
          grants: [grantDoc({ revoked_at: "2026-10-01T10:00:00.000Z" })],
        })}
      />,
    );
    expect(screen.getByText(/revoked at bundle time/i)).toBeTruthy();
  });

  it("says an unreadable expiry is denied", async () => {
    render(
      <RightPanel
        bundle={await loadSpec({ grants: [grantDoc({ expires_at: "soon" })] })}
      />,
    );
    expect(
      screen.getByText(/unreadable expiry; such a grant is denied/i),
    ).toBeTruthy();
  });

  it("shows max_files when present", async () => {
    render(
      <RightPanel
        bundle={await loadSpec({ grants: [grantDoc({ max_files: 7 })] })}
      />,
    );
    expect(within(screen.getByTestId("grant-g1")).getByText("7")).toBeTruthy();
  });

  it("notes that error lines are counted by the pack but not listed here", async () => {
    render(
      <RightPanel
        bundle={await loadSpec({
          trace: [traceLine({ halt_reason: "error" })],
        })}
      />,
    );
    expect(
      screen.getByText(/1 other non-completed line.*only grant denials/i),
    ).toBeTruthy();
  });

  it("lists proposal entries it cannot show", async () => {
    render(
      <RightPanel
        bundle={await loadSpec({
          proposals: [
            ...proposalFiles(),
            { path: "proposals/q.json", role: "proposal", content: "{}" },
            { path: "proposals/sub/z.patch", role: "proposal", content: "x" },
          ],
        })}
      />,
    );
    expect(screen.getByText(/not shown/i)).toBeTruthy();
    expect(screen.getByText(/proposals\/q\.json/)).toBeTruthy();
    expect(screen.getByText(/proposals\/sub\/z\.patch/)).toBeTruthy();
    expect(screen.queryByTestId("proposal-sub/z")).toBeNull();
  });

  it("shows an unreadable grant as such, and the page still renders", async () => {
    render(
      <RightPanel
        bundle={await loadSpec({ grants: ["{not json", grantDoc()] })}
      />,
    );
    expect(screen.getByText(/could not be read as a grant/i)).toBeTruthy();
    expect(screen.getByTestId("grant-g1")).toBeTruthy();
  });

  it("strips control characters from every rendered field", async () => {
    const h = (t: string) => `${t}\u001b[31m\u0007\u0085\u009b`;
    const { container } = render(
      <RightPanel
        bundle={await loadSpec({
          grants: [
            grantDoc({
              id: h("g1"),
              principal: h("p"),
              agent: h("a"),
              mode: h("m"),
              tools: [h("t")],
              paths: [h("x/")],
              expires_at: h("2026-10-01T09:00:00.000Z"),
              revoked_at: h("2026-10-01T09:00:00.000Z"),
            }),
          ],
          trace: [
            traceLine({
              grant_id: h("g1"),
              halt_reason: "grant_denied",
              tool_calls: [
                {
                  name: h("tool"),
                  args_digest: "a",
                  result_digest: "b",
                  time: h("t"),
                },
              ],
            }),
            missingLine({ tool: h("tool"), reason: h("why"), time: h("t") }),
          ],
          proposals: [
            {
              path: "proposals/p1.patch",
              role: "proposal",
              content: h("+diff\n"),
            },
            {
              path: "proposals/p1.json",
              role: "proposal",
              content: proposalMeta({
                grantId: h("g"),
                tool: h("tool"),
                paths: [h("core/a.ts")],
              }),
            },
          ],
        })}
      />,
    );
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    // population-guard: the text is non-empty (asserted above)
    expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  });
});

describe("RightPanel: viewer only", () => {
  it("has no form, no text box and no tool-calling button", async () => {
    render(
      <RightPanel bundle={await loadSpec({ proposals: proposalFiles() })} />,
    );
    expect(document.querySelector("form")).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(document.querySelectorAll("input, textarea, select")).toHaveLength(
      0,
    );
    const buttons = screen.queryAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      const name = b.getAttribute("aria-label") ?? b.textContent ?? "";
      expect(name.length).toBeGreaterThan(0);
      expect(name).not.toMatch(/run|apply|send|execute|call/i);
    }
  });

  it("says the agent runs locally under MCP", async () => {
    render(<RightPanel bundle={await loadSpec()} />);
    expect(
      screen.getByText(
        /agent runs locally under MCP.*only shows what the bundle recorded/i,
      ),
    ).toBeTruthy();
  });
});

describe("BrownfieldViewerPage: right slot", () => {
  it("mounts the panel in slot-right-panel", async () => {
    render(
      <BrownfieldViewerPage
        name="Client"
        status="ready"
        intake={{ phase: "ready", fileName: "b.zip", bundle: await loadSpec() }}
        onFile={vi.fn()}
      />,
    );
    expect(
      within(screen.getByTestId("slot-right-panel")).getByTestId("grant-g1"),
    ).toBeTruthy();
  });
});
