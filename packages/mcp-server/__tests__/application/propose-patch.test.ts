/**
 * `hexagen_propose_patch` end to end on a real temporary tree: the real
 * `GrantSignatureAdapter`, `TraceWriteAdapter` and `ProposalWorkspaceAdapter`,
 * no spies. The fixture has no `.architecture/manifest.yaml`, so the trace is
 * chained (brownfield) and `grant_missing` is written.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  canonicalGrantPayload,
  type Grant,
} from "../../src/application/kernel/grant.js";
import type { ProposePatchToolResult } from "../../src/application/ports/in/propose-patch-tool.port.js";
import { ProposePatchToolUseCase } from "../../src/application/use-cases/propose-patch-tool.use-case.js";
import { GrantSignatureAdapter } from "../../src/infrastructure/adapters/grant-signature.adapter.js";
import { ProposalWorkspaceAdapter } from "../../src/infrastructure/adapters/proposal-workspace.adapter.js";
import { TraceWriteAdapter } from "../../src/infrastructure/adapters/trace-write.adapter.js";
import { proposePatchTool } from "../../src/infrastructure/adapters/tools/propose-patch.js";
import { toolRegistry } from "../../src/infrastructure/adapters/tools/registry.js";
import type { MCPServerAdapterDependencies } from "../../src/infrastructure/adapters/mcp-server.types.js";

const NOW = new Date("2026-10-02T12:00:00.000Z");
const KEY = randomBytes(32).toString("hex");
const TOOL = "hexagen_propose_patch";
const HUNK = "@@ -1 +1 @@\n-a\n+b\n";

function modify(p: string): string {
  return `diff --git a/${p} b/${p}\nindex 1111111..2222222 100644\n--- a/${p}\n+++ b/${p}\n${HUNK}`;
}

function rename(from: string, to: string): string {
  return `diff --git a/${from} b/${to}\nsimilarity index 100%\nrename from ${from}\nrename to ${to}\n`;
}

function sign(grant: Omit<Grant, "signature">): Grant {
  const signature = createHmac("sha256", Buffer.from(KEY, "hex"))
    .update(canonicalGrantPayload(grant as Grant))
    .digest("hex");
  return { ...grant, signature };
}

function baseGrant(over: Partial<Grant> = {}): Omit<Grant, "signature"> {
  return {
    id: "grant-1",
    principal: "fde",
    agent: "agent",
    paths: ["src/", "docs/"],
    tools: [TOOL],
    mode: "propose",
    expires_at: "2026-10-03T00:00:00.000Z",
    ...over,
  };
}

/** Every file under `root` outside `.hexagen/`, as `path -> sha256`. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = path.relative(root, full);
      if (rel === ".hexagen") continue;
      const st = statSync(full);
      if (st.isDirectory()) {
        out[`${rel}/`] = "dir";
        walk(full);
      } else {
        out[rel] = createHash("sha256")
          .update(readFileSync(full))
          .digest("hex");
      }
    }
  };
  walk(root);
  return out;
}

function caseInsensitive(dir: string): boolean {
  writeFileSync(path.join(dir, "CaseProbe"), "");
  const result = existsSync(path.join(dir, "caseprobe"));
  rmSync(path.join(dir, "CaseProbe"));
  return result;
}

let root: string;
let keyFile: string;
let use: ProposePatchToolUseCase;

function put(rel: string, text: string): void {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
}

function trace(): Array<Record<string, unknown>> {
  const file = path.join(root, ".hexagen", "evidence", "trace.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function proposals(): string[] {
  const dir = path.join(root, ".hexagen", "proposals");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function writeSlice(
  paths: string[] = ["src/", "docs/"],
  excludes: string[] = ["src/gen/"],
): void {
  put(
    ".hexagen/slice.json",
    JSON.stringify({
      schemaVersion: "1.0.0",
      id: "slice-7",
      repo: { commit: "abc1234" },
      paths,
      excludes,
      createdBy: "fde",
      createdAt: "2026-10-01T00:00:00.000Z",
    }),
  );
}

async function propose(
  patch: string,
  grant: Grant | undefined = sign(baseGrant()),
): Promise<ProposePatchToolResult> {
  return use.execute({ patch, grant });
}

function denied(r: ProposePatchToolResult): { code: string; reason: string } {
  if (r.allowed) throw new Error("expected a denial");
  return r;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "propose-patch-"));
  keyFile = path.join(root, "..", `${path.basename(root)}.key`);
  writeFileSync(keyFile, KEY);
  put("src/a.ts", "a\n");
  put("src/gen/x.ts", "a\n");
  put("docs/readme.md", "a\n");
  put("outside/o.ts", "a\n");
  writeSlice();
  use = new ProposePatchToolUseCase(
    new ProposalWorkspaceAdapter(root),
    new TraceWriteAdapter(root),
    new GrantSignatureAdapter(root, { keyFile, env: {} }),
    () => NOW,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(keyFile, { force: true });
});

describe("hexagen_propose_patch", () => {
  it("stores an allowed patch, traces it, and leaves the tree byte-identical", async () => {
    const before = snapshot(root);
    const patch = modify("src/a.ts");
    const r = await propose(patch);
    expect(r.allowed).toBe(true);
    if (!r.allowed) return;

    expect(snapshot(root)).toEqual(before);
    expect(r.paths).toEqual(["src/a.ts"]);
    expect(r.apply_with).toBe(`git apply -p1 ${r.patch_file}`);
    expect(readFileSync(path.join(root, r.patch_file), "utf-8")).toBe(patch);
    expect(proposals()).toEqual([
      `${r.proposal_id}.json`,
      `${r.proposal_id}.patch`,
    ]);

    const meta = JSON.parse(
      readFileSync(path.join(root, r.meta_file), "utf-8"),
    ) as Record<string, unknown>;
    expect(meta).toEqual({
      id: r.proposal_id,
      grantId: "grant-1",
      sliceId: "slice-7",
      tool: TOOL,
      paths: ["src/a.ts"],
      traceSeq: 0,
      createdAt: NOW.toISOString(),
    });

    const lines = trace();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      grant_id: "grant-1",
      goal_id: "slice-7",
      halt_reason: "completed",
      seq: 0,
    });
    expect((lines[0]?.tool_calls as Array<{ name: string }>)[0]?.name).toBe(
      TOOL,
    );
    expect(r.trace_seq).toBe(0);
  });

  it("gives each proposal its own random id and the second trace line seq 1", async () => {
    const a = await propose(modify("src/a.ts"));
    const b = await propose(modify("src/a.ts"));
    if (!a.allowed || !b.allowed) throw new Error("expected both allowed");
    expect(a.proposal_id).not.toBe(b.proposal_id);
    expect(a.proposal_id).toMatch(/^[0-9a-f]{24}$/);
    expect(b.trace_seq).toBe(1);
  });

  it("denies a patch outside the slice, with a trace line (plan section 6 item 2)", async () => {
    const before = snapshot(root);
    const r = denied(await propose(modify("outside/o.ts")));
    expect(r.code).toBe("grant_denied");
    expect(proposals()).toEqual([]);
    expect(snapshot(root)).toEqual(before);
    expect(trace()).toHaveLength(1);
    expect(trace()[0]).toMatchObject({
      grant_id: "grant-1",
      goal_id: "slice-7",
      halt_reason: "grant_denied",
    });
  });

  it("denies, by the slice alone, a path the grant lists but the slice does not", async () => {
    const wide = sign(baseGrant({ paths: ["src/", "docs/", "outside/"] }));
    const r = denied(await propose(modify("outside/o.ts"), wide));
    expect(r.reason).toMatch(/outside the slice/);
    expect(trace()[0]).toMatchObject({ halt_reason: "grant_denied" });
  });

  it("denies a path inside an excluded prefix even though grant and slice paths cover it", async () => {
    const r = denied(await propose(modify("src/gen/x.ts")));
    expect(r.reason).toMatch(/outside the slice/);
  });

  it("denies when there is no slice, and still traces it (goal_id falls back to the caller's)", async () => {
    rmSync(path.join(root, ".hexagen", "slice.json"));
    const r = await use.execute({
      patch: modify("src/a.ts"),
      grant: sign(baseGrant()),
      goal_id: "caller-goal",
    });
    expect(denied(r).reason).toMatch(/slice/);
    expect(trace()[0]).toMatchObject({ goal_id: "caller-goal" });
  });

  it.each([
    [
      "from inside the slice to outside it",
      rename("src/a.ts", "outside/o2.ts"),
    ],
    [
      "from outside the slice to inside it",
      rename("outside/o.ts", "src/o2.ts"),
    ],
  ])("denies a rename %s (both sides are read)", async (_name, patch) => {
    const r = denied(await propose(patch));
    expect(r.code).toBe("grant_denied");
    expect(proposals()).toEqual([]);
    expect(trace()[0]).toMatchObject({ halt_reason: "grant_denied" });
  });

  it("allows a rename wholly inside the slice", async () => {
    const r = await propose(rename("src/a.ts", "src/b.ts"));
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("denies symlink, submodule, binary and header-less patches, each with a trace line", async () => {
    const cases = [
      "diff --git a/src/l b/src/l\nnew file mode 120000\nindex 0000000..2222222\n--- /dev/null\n+++ b/src/l\n@@ -0,0 +1 @@\n+target\n",
      "diff --git a/src/s b/src/s\nnew file mode 160000\nindex 0000000..2222222\n",
      "diff --git a/src/b.bin b/src/b.bin\nindex 1..2 100644\nGIT binary patch\nliteral 1\n",
      "just some text\n",
    ];
    for (const patch of cases) {
      expect(denied(await propose(patch)).reason).toMatch(/Patch refused/);
    }
    expect(trace()).toHaveLength(cases.length);
    expect(proposals()).toEqual([]);
  });

  it("judges /dev/null create and delete on the real path only", async () => {
    const created = `diff --git a/src/n.ts b/src/n.ts\nnew file mode 100644\nindex 0000000..2222222\n--- /dev/null\n+++ b/src/n.ts\n@@ -0,0 +1 @@\n+x\n`;
    const deleted = `diff --git a/src/a.ts b/src/a.ts\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/src/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n`;
    const c = await propose(created);
    const d = await propose(deleted);
    expect(c.allowed && d.allowed).toBe(true);
    if (c.allowed) expect(c.paths).toEqual(["src/n.ts"]);
    if (d.allowed) expect(d.paths).toEqual(["src/a.ts"]);
    const outside = `diff --git a/outside/n.ts b/outside/n.ts\nnew file mode 100644\nindex 0000000..2222222\n--- /dev/null\n+++ b/outside/n.ts\n@@ -0,0 +1 @@\n+x\n`;
    const wide = sign(baseGrant({ paths: ["src/", "outside/"] }));
    expect(denied(await propose(outside, wide)).reason).toMatch(
      /outside the slice/,
    );
    expect(existsSync(path.join(root, "src", "n.ts"))).toBe(false);
  });

  it("writes a grant_missing record and denies, for no grant and for a grant with no id", async () => {
    const none = denied(await use.execute({ patch: modify("src/a.ts") }));
    expect(none.code).toBe("grant_missing");
    const noId = sign({ ...baseGrant(), id: "" });
    const second = denied(await propose(modify("src/a.ts"), noId));
    expect(second.code).toBe("grant_missing");

    const lines = trace();
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatchObject({
        kind: "grant_missing",
        tool: TOOL,
        goal_id: "slice-7",
      });
      expect(line.grant_id).toBeUndefined();
    }
    expect(proposals()).toEqual([]);
  });

  it("denies a tampered, an expired and a revoked grant with their own codes", async () => {
    const good = sign(baseGrant());
    const tampered: Grant = { ...good, paths: ["src/", "docs/", "outside/"] };
    expect(denied(await propose(modify("src/a.ts"), tampered)).code).toBe(
      "grant_denied",
    );
    const expired = sign(baseGrant({ expires_at: "2026-10-01T00:00:00.000Z" }));
    expect(denied(await propose(modify("src/a.ts"), expired)).code).toBe(
      "grant_expired",
    );
    const revoked = sign(baseGrant({ revoked_at: "2026-10-02T00:00:00.000Z" }));
    expect(denied(await propose(modify("src/a.ts"), revoked)).code).toBe(
      "grant_revoked",
    );
    const unsigned: Grant = { ...good, signature: undefined };
    expect(denied(await propose(modify("src/a.ts"), unsigned)).code).toBe(
      "grant_denied",
    );
    expect(trace().map((l) => l.halt_reason)).toEqual([
      "grant_denied",
      "grant_expired",
      "grant_revoked",
      "grant_denied",
    ]);
    expect(proposals()).toEqual([]);
  });

  it("denies a grant whose tools do not name the tool", async () => {
    const g = sign(baseGrant({ tools: ["hexagen_create_context"] }));
    expect(denied(await propose(modify("src/a.ts"), g)).reason).toMatch(
      /does not include tool/,
    );
  });

  it("does not run the mode check: a propose-mode grant is allowed, a write-mode one too", async () => {
    expect((await propose(modify("src/a.ts"))).allowed).toBe(true);
    const write = sign(baseGrant({ mode: "write" }));
    expect((await propose(modify("src/a.ts"), write)).allowed).toBe(true);
  });

  it("refuses traversal and absolute paths", async () => {
    for (const p of ["a/../../x", "/etc/passwd"]) {
      expect(denied(await propose(modify(p))).reason).toMatch(/Patch refused/);
    }
  });

  it("denies a path whose directory is a symlink out of the repo", async () => {
    const outsideDir = mkdtempSync(path.join(tmpdir(), "propose-out-"));
    try {
      symlinkSync(outsideDir, path.join(root, "src", "escape"));
      const r = denied(await propose(modify("src/escape/f.ts")));
      expect(r.reason).toMatch(/outside the repository/);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("denies a path whose directory is a symlink to an excluded in-repo directory", async () => {
    symlinkSync(path.join(root, "src", "gen"), path.join(root, "src", "alias"));
    const r = denied(await propose(modify("src/alias/x.ts")));
    expect(r.reason).toMatch(/outside the slice/);
  });

  it("denies a path outside the slice even when its on-disk target is inside it", async () => {
    symlinkSync(path.join(root, "src"), path.join(root, "outside", "link"));
    const wide = sign(baseGrant({ paths: ["src/", "outside/"] }));
    const r = denied(await propose(modify("outside/link/a.ts"), wide));
    expect(r.reason).toMatch(
      /Path 'outside\/link\/a\.ts' is outside the slice/,
    );
  });

  it("denies a spelling that a case-insensitive filesystem maps onto an excluded directory", async (ctx) => {
    if (!caseInsensitive(root)) ctx.skip();
    // `src/Gen/` is not matched by the exclude `src/gen/` as text; only the
    // on-disk spelling reveals it.
    const r = denied(await propose(modify("src/Gen/x.ts")));
    expect(r.reason).toMatch(
      /On-disk path 'src\/gen\/x\.ts' is outside the slice/,
    );
    // A top-level case change is caught by the text check already.
    expect(denied(await propose(modify("SRC/Gen/x.ts"))).code).toBe(
      "grant_denied",
    );
  });

  it("never overwrites an existing proposal file", async () => {
    const r = await propose(modify("src/a.ts"));
    if (!r.allowed) throw new Error("expected allowed");
    const before = readFileSync(path.join(root, r.patch_file), "utf-8");
    await propose(modify("docs/readme.md"));
    expect(readFileSync(path.join(root, r.patch_file), "utf-8")).toBe(before);
  });

  it("is registered, and its handler flags a denial as an error", async () => {
    expect(toolRegistry.get(TOOL)).toBe(proposePatchTool);
    expect(proposePatchTool.description).toMatch(/PROPOSE-ONLY/);
    expect(proposePatchTool.description).toMatch(/git apply -p1/);
    const deps = {
      proposePatchToolUseCase: use,
    } as unknown as MCPServerAdapterDependencies;
    const ok = await proposePatchTool.handler(
      { patch: modify("src/a.ts"), grant: sign(baseGrant()) },
      deps,
    );
    expect(ok.isError).toBeUndefined();
    const bad = await proposePatchTool.handler(
      { patch: modify("outside/o.ts"), grant: sign(baseGrant()) },
      deps,
    );
    expect(bad.isError).toBe(true);
  });
});
