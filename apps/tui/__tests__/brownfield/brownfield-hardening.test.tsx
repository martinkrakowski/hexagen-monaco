import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrownfieldView } from "../../src/brownfield/BrownfieldView.js";
import {
  clean,
  listGrantFiles,
  loadGrantShow,
  loadTraceTail,
  makeGrantShowRunner,
} from "../../src/brownfield/read-files.js";
import {
  GRANT,
  SLICE,
  TRACE,
  makeWorkspace,
  mount,
  tick,
  until,
} from "./harness.js";

const open: Array<() => void> = [];
afterEach(() => {
  open.splice(0).forEach((u) => u());
});

const okRunner = vi.fn(async (file: string) => ({
  stdout: `Grant ${path.basename(file)}\nsignature: verified`,
  stderr: "",
  exitCode: 0,
}));

function view(root: string, runner = okRunner) {
  const m = mount(
    <BrownfieldView
      workspaceRoot={root}
      interactive
      onQuit={vi.fn()}
      grantShowRunner={runner}
    />,
  );
  open.push(m.unmount);
  return m;
}

async function grantWs() {
  const root = makeWorkspace({ ".hexagen/grants/g.json": GRANT });
  const listed = await listGrantFiles(root);
  if (!listed.ok) throw new Error(listed.message);
  return { root, file: listed.value[0] as string };
}

const EVIL = "\u001b]0;x\u0007\u001b[2J";

describe("terminal escape injection", () => {
  it("clean strips C0, DEL, C1 and ESC sequences but keeps newline and tab", () => {
    expect(clean(`a\u0007b\rc\u007fd\u0085e\u009bf\ng\th`)).toBe(
      "abcdef\ng\th",
    );
    expect(clean(`x${EVIL}y`)).toBe("xy");
    expect(clean("a\u001bPpayload\u001b\\b\u001b_apc\u0007c\u001bZd")).toBe(
      "abcd",
    );
  });

  it("renders slice and trace data with no escape or bell bytes", async () => {
    const slice = JSON.parse(SLICE);
    slice.repo.commit = `c${EVIL}`;
    slice.paths = [`src/${EVIL}/`];
    const trace = JSON.stringify({
      kind: "grant_missing",
      seq: 0,
      prev_hash: "0".repeat(64),
      time: `t${EVIL}`,
      tool: `tool${EVIL}x`,
      reason: "r",
    });
    const m = view(
      makeWorkspace({
        ".hexagen/slice.json": JSON.stringify(slice),
        ".hexagen/evidence/trace.jsonl": trace,
        ".hexagen/grants/g.json": GRANT,
      }),
    );
    const out = await until(m.frame, "grant_missing");
    expect(out).toContain("grant_missing");
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("\u0007");
  });

  it("cleans grant show output", async () => {
    const { root, file } = await grantWs();
    const r = await loadGrantShow(file, root, async () => ({
      stdout: `Grant ${EVIL}g`,
      stderr: "",
      exitCode: 0,
    }));
    expect(r).toEqual({ ok: true, value: "Grant g" });
  });
});

describe("trace tail", () => {
  it("is labelled unverified", async () => {
    const m = view(makeWorkspace({ ".hexagen/evidence/trace.jsonl": TRACE }));
    const out = await until(m.frame, "unverified tail");
    expect(out).toContain("unverified tail: chain and signatures not checked");
    expect(out).toContain("hexagen evidence pack");
  });

  it("reads only the last 256 KiB of a large file", async () => {
    const line = (i: number) =>
      JSON.stringify({
        kind: "grant_missing",
        seq: i,
        prev_hash: "0".repeat(64),
        time: "2026-10-01T00:00:00Z",
        tool: "t".repeat(100),
        reason: "r",
      });
    const lines = Array.from({ length: 6000 }, (_, i) => line(i));
    const root = makeWorkspace({
      ".hexagen/evidence/trace.jsonl": lines.join("\n") + "\n",
    });
    const r = await loadTraceTail(root, 20);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.rows.at(-1)?.seq).toBe(5999);
    expect(r.value.rows).toHaveLength(20);
    expect(r.value.unreadable).toBe(0);
    expect(r.value.truncated).toBe(true);
    expect(r.value.total).toBeLessThan(6000);
    const m = view(root);
    expect(await until(m.frame, "unverified")).toMatch(/of ≥\d+ line/);
  });

  it("drops the partial first line when the read starts mid-file", async () => {
    const big = "x".repeat(300 * 1024);
    const root = makeWorkspace({
      ".hexagen/evidence/trace.jsonl": `{"seq":0,"halt_reason":"completed","pad":"${big}"}\n{"seq":1,"halt_reason":"completed"}\n`,
    });
    const r = await loadTraceTail(root, 20);
    expect(r.ok && r.value.rows.map((x) => x.seq)).toEqual([1]);
    expect(r.ok && r.value.unreadable).toBe(0);
  });
});

describe.skipIf(process.platform === "win32")("symlinks", () => {
  it("refuses a trace symlinked outside .hexagen", async () => {
    const outside = makeWorkspace({ "t.jsonl": TRACE });
    const root = makeWorkspace({ ".hexagen/slice.json": SLICE });
    mkdirSync(path.join(root, ".hexagen", "evidence"));
    symlinkSync(
      path.join(outside, "t.jsonl"),
      path.join(root, ".hexagen", "evidence", "trace.jsonl"),
    );
    const r = await loadTraceTail(root);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/outside \.hexagen/);
    const m = view(root);
    expect(await until(m.frame, "outside .hexagen")).toContain(
      "trace.jsonl resolves outside .hexagen",
    );
  });

  it("refuses a symlinked slice and a symlinked .hexagen", async () => {
    const outside = makeWorkspace({ "slice.json": SLICE });
    const root = makeWorkspace({});
    mkdirSync(path.join(root, ".hexagen"));
    symlinkSync(
      path.join(outside, "slice.json"),
      path.join(root, ".hexagen", "slice.json"),
    );
    const m = view(root);
    expect(await until(m.frame, "outside .hexagen")).toContain(
      "slice.json resolves outside .hexagen",
    );
  });

  it("skips a grant file symlinked outside", async () => {
    const outside = makeWorkspace({ "g.json": GRANT });
    const root = makeWorkspace({ ".hexagen/grants/ok.json": GRANT });
    symlinkSync(
      path.join(outside, "g.json"),
      path.join(root, ".hexagen", "grants", "evil.json"),
    );
    const m = view(root);
    const out = await until(m.frame, "ok.json");
    expect(out).toContain("ok.json");
    expect(out).not.toContain("evil.json");
  });
});

describe("grant show runner error mapping", () => {
  const mk = (err: Record<string, unknown>) =>
    makeGrantShowRunner(((
      _c: string,
      _a: string[],
      _o: unknown,
      cb: (e: Error | null, out: string, err: string) => void,
    ) => {
      cb(Object.assign(new Error("boom"), err), "", "");
    }) as never);

  it("maps a timeout", async () => {
    const { root, file } = await grantWs();
    const r = await loadGrantShow(
      file,
      root,
      mk({ killed: true, signal: "SIGTERM" }),
    );
    expect(!r.ok && r.message).toMatch(/timed out/);
    expect(!r.ok && r.message).not.toMatch(/PATH/);
  });

  it("maps output over the buffer", async () => {
    const { root, file } = await grantWs();
    const r = await loadGrantShow(
      file,
      root,
      mk({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }),
    );
    expect(!r.ok && r.message).toMatch(/too large/);
    expect(!r.ok && r.message).not.toMatch(/PATH/);
  });

  it("hints at PATH only for ENOENT", async () => {
    const { root, file } = await grantWs();
    const r = await loadGrantShow(file, root, mk({ code: "ENOENT" }));
    expect(!r.ok && r.message).toMatch(/PATH/);
  });
});

describe("grant pane", () => {
  it("renders a NOT verified result (exit 1)", async () => {
    const runner = vi.fn(async () => ({
      stdout: "Grant g-1\nsignature: NOT verified: no key",
      stderr: "",
      exitCode: 1,
    }));
    const m = view(makeWorkspace({ ".hexagen/grants/a.json": GRANT }), runner);
    expect(await until(m.frame, "NOT verified")).toContain(
      "signature: NOT verified: no key",
    );
  });

  it("u re-runs grant show", async () => {
    const runner = vi.fn(async () => ({
      stdout: "Grant a\nsignature: verified",
      stderr: "",
      exitCode: 0,
    }));
    const m = view(makeWorkspace({ ".hexagen/grants/a.json": GRANT }), runner);
    await until(m.frame, "signature: verified");
    expect(runner).toHaveBeenCalledTimes(1);
    m.press("u");
    await tick(200);
    expect(runner.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("clamps the selection when the grant list shrinks", async () => {
    const root = makeWorkspace({
      ".hexagen/grants/a.json": GRANT,
      ".hexagen/grants/b.json": GRANT,
    });
    const m = view(root);
    await until(m.frame, "Grant a.json");
    m.press("\t");
    await tick();
    m.press("j");
    await until(m.frame, "Grant b.json");
    rmSync(path.join(root, ".hexagen", "grants", "b.json"));
    m.press("u");
    const out = await until(m.frame, "Grant a.json");
    expect(out).toContain("Grant a.json");
    expect(out).not.toContain("b.json");
  });
});

describe.skipIf(process.platform === "win32")("containment, round 3", () => {
  it("refuses a .hexagen symlinked outside the workspace", async () => {
    const outside = makeWorkspace({
      "slice.json": SLICE,
      "grants/g.json": GRANT,
      "evidence/trace.jsonl": TRACE,
    });
    const root = makeWorkspace({});
    symlinkSync(outside, path.join(root, ".hexagen"));
    const m = view(root);
    const out = await until(m.frame, "outside the workspace");
    expect(out).toContain(".hexagen resolves outside the workspace");
    expect(out).not.toContain("abc1234");
    expect(out).not.toContain("tool_alpha");
    expect(out).not.toContain("g.json");
  });

  it("refuses a grant that is swapped for an outside link after listing", async () => {
    const outside = makeWorkspace({ "g.json": GRANT });
    const { root, file } = await grantWs();
    const runner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
    }));
    rmSync(file);
    symlinkSync(path.join(outside, "g.json"), file);
    const r = await loadGrantShow(file, root, runner);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/outside \.hexagen/);
    expect(runner).not.toHaveBeenCalled();
  });

  it("lists the real path of each grant", async () => {
    const root = makeWorkspace({ ".hexagen/real/g.json": GRANT });
    mkdirSync(path.join(root, ".hexagen", "grants"));
    symlinkSync(
      path.join(root, ".hexagen", "real", "g.json"),
      path.join(root, ".hexagen", "grants", "link.json"),
    );
    const listed = await listGrantFiles(root);
    expect(listed.ok && listed.value[0]).toMatch(/real\/g\.json$/);
  });

  it("cleans the workspace root in the header", async () => {
    const parent = makeWorkspace({});
    const root = path.join(parent, `d${EVIL}x`);
    mkdirSync(root);
    const m = view(root);
    const out = await until(m.frame, "brownfield");
    expect(out).toMatch(/\/dx(\s|$)/m);
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("\u0007");
  });
});

describe("oversized trace record", () => {
  it("says so instead of reporting an empty file", async () => {
    const root = makeWorkspace({
      ".hexagen/evidence/trace.jsonl": `{"pad":"${"x".repeat(300 * 1024)}"}\n`,
    });
    const r = await loadTraceTail(root);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/larger than 256 KiB/);
    expect(!r.ok && r.message).not.toMatch(/empty/);
  });
});
