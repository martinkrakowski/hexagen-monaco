import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refactorWithAI, mcpConstructed } = vi.hoisted(() => ({
  refactorWithAI: vi.fn(),
  mcpConstructed: vi.fn(),
}));
vi.mock("../../src/services/action-service.js", () => ({ refactorWithAI }));
vi.mock("../../src/services/mcp-client.service.js", () => ({
  MCPClientService: class {
    constructor() {
      mcpConstructed();
      throw new Error("MCP client must not be constructed in brownfield mode");
    }
  },
}));

import { BrownfieldView } from "../../src/brownfield/BrownfieldView.js";
import { main } from "../../src/main.js";
import {
  GRANT,
  OBSERVED,
  SLICE,
  TRACE,
  makeWorkspace,
  mount,
  tick,
  until,
} from "./harness.js";

const runner = vi.fn(async (file: string) => ({
  stdout: `Grant g-1 (${file.split("/").pop()})\nsignature: verified\nkey: /k fp:abcd`,
  stderr: "",
  exitCode: 0,
}));

const open: Array<() => void> = [];
afterEach(() => {
  open.splice(0).forEach((u) => u());
  vi.clearAllMocks();
});

function view(root: string, quit = vi.fn()) {
  const m = mount(
    <BrownfieldView
      workspaceRoot={root}
      interactive
      onQuit={quit}
      grantShowRunner={runner}
    />,
  );
  open.push(m.unmount);
  return m;
}

describe("brownfield view panes", () => {
  it("renders slice, grant and trace tail from fixtures", async () => {
    const root = makeWorkspace({
      ".hexagen/slice.json": SLICE,
      ".hexagen/observed.json": OBSERVED,
      ".hexagen/grants/g1.json": GRANT,
      ".hexagen/evidence/trace.jsonl": TRACE,
    });
    const m = view(root);
    const out = await until(m.frame, "signature: verified");
    expect(out).toContain("src/billing/");
    expect(out).toContain("src/billing/vendor/");
    expect(out).toContain("abc1234");
    expect(out).toContain("edgesComplete: true");
    expect(out).toContain("g1.json");
    expect(out).toContain("signature: verified");
    expect(out).toContain("tool_alpha completed");
    expect(out).toMatch(/#1 .*tool_beta grant_missing DENIAL/);
    expect(out).toMatch(/#2 .*tool_gamma grant_denied DENIAL/);
    expect(out).not.toMatch(/tool_alpha completed DENIAL/);
  });

  it("shows a message per pane for missing files, without crashing", async () => {
    const m = view(makeWorkspace({}));
    const out = await until(m.frame, "slice.json not found");
    expect(out).toContain(".hexagen/slice.json not found");
    expect(out).toContain(".hexagen/grants/ not found");
    expect(out).toContain("trace.jsonl not found");
  });

  it("shows a message for invalid files, without crashing", async () => {
    const m = view(
      makeWorkspace({
        ".hexagen/slice.json": "{not json",
        ".hexagen/grants/g1.json": "{}",
        ".hexagen/evidence/trace.jsonl": "garbage\n{}\n",
      }),
    );
    const out = await until(m.frame, "unreadable");
    expect(out).toContain("slice.json is not valid JSON");
    expect(out).toContain("2 line(s) unreadable");
  });

  it("reports a failing grant show inline", async () => {
    const bad = vi.fn(async () => ({
      stdout: "",
      stderr: "x is not a grant",
      exitCode: 2,
    }));
    const root = makeWorkspace({ ".hexagen/grants/g1.json": "{}" });
    const m = mount(
      <BrownfieldView
        workspaceRoot={root}
        interactive
        onQuit={vi.fn()}
        grantShowRunner={bad}
      />,
    );
    open.push(m.unmount);
    expect(await until(m.frame, "x is not a grant")).toContain(
      "x is not a grant",
    );
  });

  it("lets the user pick a grant with j", async () => {
    const root = makeWorkspace({
      ".hexagen/grants/a.json": GRANT,
      ".hexagen/grants/b.json": GRANT,
    });
    const m = view(root);
    await until(m.frame, "(a.json)");
    m.press("\t");
    await tick();
    m.press("j");
    expect(await until(m.frame, "(b.json)")).toContain("(b.json)");
  });
});

describe("brownfield mode is read-only", () => {
  it("ignores r: no refactor, no status change, no mention", async () => {
    const root = makeWorkspace({
      ".hexagen/slice.json": SLICE,
      ".hexagen/evidence/trace.jsonl": TRACE,
    });
    const m = view(root);
    const before = await until(m.frame, "tool_gamma");
    m.press("r");
    await tick(150);
    expect(refactorWithAI).not.toHaveBeenCalled();
    expect(m.frame()).toBe(before);
    expect(before).not.toMatch(/refactor/i);
  });

  it("constructs no MCP client and never loads the architecture app", async () => {
    const startBrownfield = vi.fn();
    const startGreenfield = vi.fn();
    await main(["--brownfield", "--workspace-root", "/x/y"], {
      startBrownfield,
      startGreenfield,
      cwd: "/cwd",
      fail: vi.fn(),
    });
    expect(startBrownfield).toHaveBeenCalledWith("/x/y");
    expect(startGreenfield).not.toHaveBeenCalled();
    expect(mcpConstructed).not.toHaveBeenCalled();
  });

  it("defaults the workspace root to cwd and starts the real view without MCP", async () => {
    const startBrownfield = vi.fn();
    await main(["--brownfield"], {
      startBrownfield,
      startGreenfield: vi.fn(),
      cwd: "/cwd",
      fail: vi.fn(),
    });
    expect(startBrownfield).toHaveBeenCalledWith("/cwd");
    // The real runner path must not pull in the MCP client either.
    const run = await import("../../src/brownfield/run.js");
    expect(typeof run.startBrownfield).toBe("function");
    expect(mcpConstructed).not.toHaveBeenCalled();
  });

  it("starts the architecture app without the flag, and rejects a bare --workspace-root", async () => {
    const startGreenfield = vi.fn(async () => {});
    const fail = vi.fn();
    await main([], {
      startBrownfield: vi.fn(),
      startGreenfield,
      cwd: "/c",
      fail,
    });
    expect(startGreenfield).toHaveBeenCalled();
    await main(["--brownfield", "--workspace-root"], {
      startBrownfield: vi.fn(),
      startGreenfield,
      cwd: "/c",
      fail,
    });
    expect(fail).toHaveBeenCalledWith("--workspace-root needs a directory");
  });
});
