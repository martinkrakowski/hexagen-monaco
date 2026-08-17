import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildEngagementReport } from "../../../src/commands/report/build-report.js";
import { generateContextMapMermaid } from "../../../src/commands/report/context-map.js";
import { buildHandoffZip } from "../../../src/commands/report/handoff.js";
import { parseLintJson } from "../../../src/commands/report/lint-collect.js";
import { collectRatchetTrend } from "../../../src/commands/report/ratchet-trend.js";
import { renderReportHtml } from "../../../src/commands/report/render-html.js";
import { renderReportMarkdown } from "../../../src/commands/report/render-markdown.js";
import { reportCommand } from "../../../src/commands/report/index.js";
import { writeZipStore } from "../../../src/commands/report/zip-store.js";
import type {
  GitReader,
  LintCollector,
} from "../../../src/commands/report/types.js";
import type { Manifest } from "../../../src/types/manifest.js";

const manifest: Manifest = {
  system: "acme-billing",
  bounded_contexts: [
    {
      name: "billing",
      type: "core",
      depends_on: ["shared"],
      layers: {
        application: { ports: { in: ["ChargePort"], out: ["LedgerPort"] } },
      },
    },
    {
      name: "shared",
      type: "shared-kernel",
      layers: { domain: {} },
    },
  ],
};

const silentGit: GitReader = {
  logFollow: () => [],
  show: () => null,
};

describe("generateContextMapMermaid", () => {
  it("emits a flowchart of depends_on and a classDiagram of ports", () => {
    const mermaid = generateContextMapMermaid(manifest);
    assert.match(mermaid, /flowchart LR/);
    assert.match(mermaid, /ctx0 --> ctx1/);
    assert.match(mermaid, /classDiagram/);
    assert.match(mermaid, /\+ChargePort/);
    assert.match(mermaid, /-LedgerPort/);
  });
});

describe("collectRatchetTrend", () => {
  it("reads entry counts from git history of the baseline file", () => {
    const git: GitReader = {
      logFollow: () => [
        { hash: "aaa", isoDate: "2026-08-01T00:00:00Z", subject: "grow" },
        { hash: "bbb", isoDate: "2026-07-01T00:00:00Z", subject: "seed" },
      ],
      show: (hash) =>
        hash === "aaa"
          ? '{"version":1,"entries":[{"rule":"r","file":"a.ts","specifier":"s"},{"rule":"r","file":"b.ts","specifier":"s"}]}'
          : '{"version":1,"entries":[{"rule":"r","file":"a.ts","specifier":"s"}]}',
    };
    const trend = collectRatchetTrend(
      git,
      ".architecture/arch-lint-baseline.json",
    );
    assert.deepEqual(
      trend.map((p) => p.entryCount),
      [2, 1],
    );
  });
});

describe("buildEngagementReport", () => {
  it("builds mermaid, ledger, drift, and trend without a live linter", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-report-"));
    await fs.mkdir(path.join(temp, ".architecture"), { recursive: true });
    await fs.writeFile(
      path.join(temp, ".architecture", "arch-lint-baseline.json"),
      '{"version":1,"entries":[{"rule":"npm-package-in-domain","file":"a.ts","specifier":"zod","reason":"tracked","expires":"2027-01-01"}]}\n',
      "utf8",
    );
    const lint: LintCollector = {
      collect: () => ({
        fresh: [
          {
            rule: "cross-package-import",
            file: "b.ts",
            specifier: "@acme/x",
            message: "illegal",
          },
        ],
        baselined: [],
        stale: [],
        expired: [],
        collected: true,
      }),
    };
    const report = buildEngagementReport({
      workspaceRoot: temp,
      manifest,
      generatedAt: "2026-08-17T00:00:00.000Z",
      git: silentGit,
      lint,
    });
    assert.equal(report.systemName, "acme-billing");
    assert.equal(report.contextCount, 2);
    assert.equal(report.suppressions[0]?.reason, "tracked");
    assert.equal(report.drift.fresh.length, 1);
    const md = renderReportMarkdown(report);
    assert.match(md, /acme-billing/);
    assert.match(md, /Fresh \(regressions\)/);
    assert.match(md, /tracked/);
    const html = renderReportHtml(report);
    assert.match(html, /mermaid/);
    assert.doesNotMatch(html, /next\.js/i);
    await fs.rm(temp, { recursive: true, force: true });
  });
});

describe("handoff zip", () => {
  it("packs report + manifest + baseline + ledger", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-handoff-"));
    await fs.mkdir(path.join(temp, ".architecture"), { recursive: true });
    await fs.writeFile(
      path.join(temp, ".architecture", "manifest.yaml"),
      "system: acme-billing\nbounded_contexts: []\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(temp, ".architecture", "layout.yaml"),
      "contexts: {}\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(temp, ".architecture", "arch-lint-baseline.json"),
      '{"version":1,"entries":[]}\n',
      "utf8",
    );
    const report = buildEngagementReport({
      workspaceRoot: temp,
      manifest,
      generatedAt: "2026-08-17T00:00:00.000Z",
      git: silentGit,
    });
    const zip = buildHandoffZip(report, temp);
    assert.ok(zip.length > 100);
    assert.equal(zip.subarray(0, 2).toString("utf8"), "PK");
    const names = ["hexagen-report.md", "manifest.yaml", "layout.yaml"];
    for (const name of names) {
      assert.ok(zip.includes(Buffer.from(name)), `zip should contain ${name}`);
    }
    await fs.rm(temp, { recursive: true, force: true });
  });

  it("round-trips a store zip local header", () => {
    const buf = writeZipStore([{ name: "a.txt", content: "hello" }]);
    assert.equal(buf.readUInt32LE(0), 0x04034b50);
  });
});

describe("parseLintJson", () => {
  it("reads the last JSON object from mixed stdout", () => {
    const parsed = parseLintJson(
      '[arch-lint] hello\n{"fresh":[{"rule":"r","file":"f.ts","specifier":"s","message":"m"}],"baselined":[],"stale":[],"expired":[]}\n',
    );
    assert.equal(parsed.collected, true);
    assert.equal(parsed.fresh[0]?.file, "f.ts");
  });
});

describe("reportCommand", () => {
  it("writes markdown, html, and a handoff zip in a fixture tree", async () => {
    const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "hexagen-report-cmd-"),
    );
    await fs.mkdir(path.join(temp, ".architecture"), { recursive: true });
    await fs.writeFile(
      path.join(temp, ".architecture", "manifest.yaml"),
      `system: acme-billing
scope: acme
architecture: modular-monolith
bounded_contexts:
  - name: shared
    type: shared-kernel
    layers:
      domain: {}
`,
      "utf8",
    );
    try {
      execFileSync("git", ["init"], { cwd: temp, stdio: "ignore" });
    } catch {
      // report still works without git history
    }
    const written = await reportCommand({
      cwd: temp,
      out: "out",
      handoff: true,
    });
    const md = await fs.readFile(written.markdownPath, "utf8");
    const html = await fs.readFile(written.htmlPath, "utf8");
    assert.match(md, /acme-billing/);
    assert.match(html, /mermaid/);
    assert.ok(written.handoffPath);
    const zip = await fs.readFile(written.handoffPath);
    assert.equal(zip.subarray(0, 2).toString("utf8"), "PK");
    await fs.rm(temp, { recursive: true, force: true });
  });
});
