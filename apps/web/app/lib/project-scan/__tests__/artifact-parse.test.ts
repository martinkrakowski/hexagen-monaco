/**
 * Tier-A handoff ingest (F-07).
 *
 * Nothing is faked: real zips (JSZip), the real unpacker, the real temp dir,
 * the real filesystem. The one thing that must NOT happen is a subprocess —
 * this module has no exec seam to stub because it has no exec at all.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  HANDOFF_ARTIFACT_NAMES,
  MAX_HANDOFF_LEDGER_ENTRIES,
  buildHandoffResponse,
  ingestHandoffFiles,
  ingestHandoffZip,
  parseArchLintBaseline,
  parseSuppressionLedger,
} from "../artifact-parse";
import {
  MAX_SCAN_LAYOUT_EXCERPT_CHARS,
  MAX_SCAN_REPORT_CHARS,
  TIER_A_MAX_ENTRY_UNCOMPRESSED_BYTES,
  TIER_A_MAX_ZIP_ENTRIES,
} from "../limits";

const REPORT = "# Hexagen engagement report — Demo\n\nContexts: 3\n";

async function zipBuffer(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

function ledger(entries: unknown[]): string {
  return JSON.stringify({ entries });
}

function baseline(entries: unknown[], version: unknown = 1): string {
  return JSON.stringify({ version, entries });
}

const WELL_FORMED: Record<string, string> = {
  "hexagen-report.md": REPORT,
  "hexagen-report.html": "<h1>Hexagen engagement report</h1>",
  "suppression-ledger.json": ledger([
    {
      rule: "no-cross-context-import",
      file: "src/a.ts",
      specifier: "../b",
      reason: "legacy",
      expires: "2026-12-31",
    },
  ]),
  "manifest.yaml": "system: Demo\ncontexts: []\n",
  "layout.yaml": "contexts:\n  demo:\n    root: packages/demo\n",
  "arch-lint-baseline.json": baseline([
    { rule: "layer-violation", file: "src/c.ts", specifier: "infra" },
  ]),
};

describe("ingestHandoffZip", () => {
  it("parses a well-formed handoff zip and surfaces the report", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer(WELL_FORMED),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "parsed");
    if (outcome.kind !== "parsed") return;
    const { result } = outcome;
    assert.equal(result.source, "handoff-artifacts");
    assert.equal(result.verdict, "ingested");
    assert.equal(result.projectName, "Demo");
    assert.match(result.reportMarkdown ?? "", /Hexagen engagement report/);
    assert.match(result.layoutExcerpt ?? "", /contexts:/);
    assert.match(result.artifacts.manifestExcerpt ?? "", /system: Demo/);
    assert.equal(result.errorMessage, null);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(
      [...result.artifacts.present].sort(),
      [...HANDOFF_ARTIFACT_NAMES].sort(),
    );
    assert.deepEqual(result.artifacts.missing, []);
  });

  it("never executes anything: exitCode and filesScanned are always null", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer(WELL_FORMED),
      projectName: "Demo",
    });
    assert.equal(outcome.kind, "parsed");
    if (outcome.kind !== "parsed") return;
    assert.equal(outcome.result.exitCode, null);
    assert.equal(outcome.result.filesScanned, null);
  });

  it("validates the suppression ledger rather than echoing it", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer(WELL_FORMED),
      projectName: "Demo",
    });
    assert.equal(outcome.kind, "parsed");
    if (outcome.kind !== "parsed") return;
    assert.equal(outcome.result.artifacts.suppressionCount, 1);
    assert.deepEqual(outcome.result.artifacts.suppressions, [
      {
        rule: "no-cross-context-import",
        file: "src/a.ts",
        specifier: "../b",
        reason: "legacy",
        expires: "2026-12-31",
      },
    ]);
    assert.equal(outcome.result.artifacts.baselineVersion, 1);
    assert.equal(outcome.result.artifacts.baselineEntryCount, 1);
  });

  it("acknowledges the HTML report without returning its markup", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer(WELL_FORMED),
      projectName: "Demo",
    });
    assert.equal(outcome.kind, "parsed");
    if (outcome.kind !== "parsed") return;
    assert.equal(outcome.result.artifacts.reportHtmlPresent, true);
    // The HTML is attacker-supplied markup; it must not reach the client.
    assert.equal(JSON.stringify(outcome.result).includes("<h1>"), false);
  });

  it("rejects a zip over the Tier-A ENTRY-COUNT cap, not the 256 MiB scan profile", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= TIER_A_MAX_ZIP_ENTRIES; i += 1) {
      files[`file-${i}.txt`] = "x";
    }
    // Sanity: this archive is comfortably legal under DEFAULT_ZIP_UNPACK_LIMITS
    // (20,000 entries). Only the Tier-A profile rejects it.
    assert.ok(Object.keys(files).length > TIER_A_MAX_ZIP_ENTRIES);
    assert.ok(Object.keys(files).length < 20_000);

    const outcome = await ingestHandoffZip({
      zip: await zipBuffer(files),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "rejected");
    if (outcome.kind !== "rejected") return;
    assert.equal(outcome.reason, "zip-too-large");
    assert.match(outcome.message, /too many entries/i);
  });

  it("rejects a zip over the Tier-A PER-ENTRY byte cap", async () => {
    // 1 MiB + 1 byte: legal under the 32 MiB Tier-B per-entry cap, rejected by
    // the 1 MiB Tier-A cap. This is what proves the tight profile is in force.
    const oversize = "y".repeat(TIER_A_MAX_ENTRY_UNCOMPRESSED_BYTES + 1);
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer({ "hexagen-report.md": oversize }),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "rejected");
    if (outcome.kind !== "rejected") return;
    assert.equal(outcome.reason, "zip-too-large");
    assert.match(outcome.message, /uncompressed bytes/i);
  });

  it("rejects a zip-slip entry", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer({
        "hexagen-report.md": REPORT,
        "../outside.txt": "nope",
      }),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "rejected");
    if (outcome.kind !== "rejected") return;
    assert.equal(outcome.reason, "zip-slip");
    assert.match(outcome.message, /unsafe path/i);
  });

  it("rejects a duplicate-entry archive explicitly", async () => {
    const zip = new JSZip();
    zip.file("hexagen-report.md", "first");
    zip.file("hexagen-report.md/", "second");
    const outcome = await ingestHandoffZip({
      zip: Buffer.from(await zip.generateAsync({ type: "uint8array" })),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "rejected");
    if (outcome.kind !== "rejected") return;
    assert.equal(outcome.reason, "duplicate-zip-entry");
  });

  it("rejects a file that is not a zip at all", async () => {
    const outcome = await ingestHandoffZip({
      zip: Buffer.from("this is plainly not a zip archive"),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "rejected");
    if (outcome.kind !== "rejected") return;
    assert.equal(outcome.reason, "invalid-zip");
  });

  it("rejects an empty zip", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer({}),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "rejected");
    if (outcome.kind !== "rejected") return;
    assert.equal(outcome.reason, "empty-zip");
  });

  it("rejects a zip with no recognisable handoff artifacts", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer({ "src/index.ts": "export const a = 1;\n" }),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "rejected");
    if (outcome.kind !== "rejected") return;
    assert.equal(outcome.reason, "no-artifacts");
  });

  it("does NOT throw or fail when a baseline contains malformed JSON", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer({
        "hexagen-report.md": REPORT,
        "arch-lint-baseline.json": "{ this is not json",
      }),
      projectName: "Demo",
    });

    // Crucially "parsed", not "failed": a malformed artifact is a warning on an
    // otherwise usable ingest, never a 500.
    assert.equal(outcome.kind, "parsed");
    if (outcome.kind !== "parsed") return;
    assert.equal(outcome.result.verdict, "ingested");
    assert.equal(outcome.result.artifacts.baselineVersion, null);
    assert.equal(outcome.result.artifacts.baselineEntryCount, null);
    assert.ok(
      outcome.result.warnings.some((w) => /not valid JSON/.test(w)),
      `expected a malformed-JSON warning, got ${JSON.stringify(outcome.result.warnings)}`,
    );
  });

  it("does NOT throw when a suppression ledger is malformed JSON", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer({
        "hexagen-report.md": REPORT,
        "suppression-ledger.json": "[[[",
      }),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "parsed");
    if (outcome.kind !== "parsed") return;
    assert.equal(outcome.result.artifacts.suppressionCount, null);
    assert.ok(outcome.result.warnings.some((w) => /not valid JSON/.test(w)));
  });

  it("reports 'incomplete' when the report is absent but other artifacts are not", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer({ "layout.yaml": "contexts: {}\n" }),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "parsed");
    if (outcome.kind !== "parsed") return;
    assert.equal(outcome.result.verdict, "incomplete");
    assert.equal(outcome.result.reportMarkdown, null);
    assert.match(outcome.result.errorMessage ?? "", /hexagen-report\.md/);
    assert.ok(outcome.result.artifacts.missing.includes("hexagen-report.md"));
  });

  it("finds artifacts nested under a directory the user re-zipped", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer({ "handoff/hexagen-report.md": REPORT }),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "parsed");
    if (outcome.kind !== "parsed") return;
    assert.equal(outcome.result.verdict, "ingested");
    assert.match(outcome.result.reportMarkdown ?? "", /engagement report/);
  });

  it("picks the shallowest copy and warns when an artifact appears twice", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer({
        "hexagen-report.md": "# shallow\n",
        "nested/hexagen-report.md": "# deep\n",
      }),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "parsed");
    if (outcome.kind !== "parsed") return;
    assert.match(outcome.result.reportMarkdown ?? "", /shallow/);
    assert.ok(outcome.result.warnings.some((w) => /appeared 2 times/.test(w)));
  });

  it("clips an oversized report to the shared scan limit", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer({
        "hexagen-report.md": "R".repeat(MAX_SCAN_REPORT_CHARS + 4_000),
      }),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "parsed");
    if (outcome.kind !== "parsed") return;
    const report = outcome.result.reportMarkdown ?? "";
    assert.ok(report.length <= MAX_SCAN_REPORT_CHARS + 2);
    assert.match(report, /…$/);
    assert.ok(outcome.result.warnings.some((w) => /truncated/.test(w)));
  });

  it("clips an oversized layout excerpt to the shared scan limit", async () => {
    const outcome = await ingestHandoffZip({
      zip: await zipBuffer({
        "hexagen-report.md": REPORT,
        "layout.yaml": "L".repeat(MAX_SCAN_LAYOUT_EXCERPT_CHARS + 2_000),
      }),
      projectName: "Demo",
    });

    assert.equal(outcome.kind, "parsed");
    if (outcome.kind !== "parsed") return;
    const layout = outcome.result.layoutExcerpt ?? "";
    assert.ok(layout.length <= MAX_SCAN_LAYOUT_EXCERPT_CHARS + 2);
    assert.match(layout, /…$/);
  });
});

describe("ingestHandoffFiles", () => {
  it("parses loose artifact uploads without a zip", () => {
    const outcome = ingestHandoffFiles({
      projectName: "Demo",
      files: [
        { name: "hexagen-report.md", content: Buffer.from(REPORT) },
        {
          name: "suppression-ledger.json",
          content: Buffer.from(ledger([])),
        },
      ],
    });

    assert.equal(outcome.kind, "parsed");
    if (outcome.kind !== "parsed") return;
    assert.equal(outcome.result.verdict, "ingested");
    assert.equal(outcome.result.artifacts.suppressionCount, 0);
  });

  it("ignores unrecognised filenames and rejects when none remain", () => {
    const outcome = ingestHandoffFiles({
      projectName: "Demo",
      files: [{ name: "secrets.env", content: Buffer.from("TOKEN=1") }],
    });

    assert.equal(outcome.kind, "rejected");
    if (outcome.kind !== "rejected") return;
    assert.equal(outcome.reason, "no-artifacts");
  });

  it("strips a directory prefix from a loose filename without escaping", () => {
    const outcome = ingestHandoffFiles({
      projectName: "Demo",
      files: [
        { name: "../../hexagen-report.md", content: Buffer.from(REPORT) },
      ],
    });

    assert.equal(outcome.kind, "parsed");
    if (outcome.kind !== "parsed") return;
    assert.match(outcome.result.reportMarkdown ?? "", /engagement report/);
  });
});

describe("untrusted JSON validation", () => {
  it("rejects a non-object top level", () => {
    assert.equal(parseSuppressionLedger("[1,2,3]").ok, false);
    assert.equal(parseArchLintBaseline('"nope"').ok, false);
  });

  it("rejects a baseline with a missing or unsupported version", () => {
    const missing = parseArchLintBaseline(JSON.stringify({ entries: [] }));
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.match(missing.error, /numeric 'version'/);

    const unsupported = parseArchLintBaseline(baseline([], 9));
    assert.equal(unsupported.ok, false);
    if (unsupported.ok) return;
    assert.match(unsupported.error, /unsupported version 9/);
  });

  it("rejects a non-array 'entries'", () => {
    const result = parseSuppressionLedger(
      JSON.stringify({ entries: { rule: "x" } }),
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /not an array/);
  });

  it("skips malformed entries instead of trusting or throwing on them", () => {
    const result = parseSuppressionLedger(
      ledger([
        null,
        42,
        "string",
        { rule: "", file: "a.ts" },
        { rule: "r", file: "" },
        { rule: "r", file: "a.ts" },
      ]),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.total, 6);
    assert.equal(result.value.skipped, 5);
    assert.deepEqual(result.value.entries, [
      { rule: "r", file: "a.ts", specifier: "", reason: null, expires: null },
    ]);
  });

  it("drops a non-ISO 'expires' rather than passing it through", () => {
    const result = parseSuppressionLedger(
      ledger([{ rule: "r", file: "a.ts", expires: "next tuesday" }]),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.entries[0]?.expires, null);
  });

  it("accepts the legacy 'note' spelling of 'reason'", () => {
    const result = parseSuppressionLedger(
      ledger([{ rule: "r", file: "a.ts", note: "  legacy  " }]),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.entries[0]?.reason, "legacy");
  });

  it("rebuilds entries from whitelisted keys only — no crafted key survives", () => {
    const result = parseSuppressionLedger(
      '{"entries":[{"rule":"r","file":"a.ts","__proto__":{"polluted":true},"constructor":"x","evil":"y"}]}',
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const entry = result.value.entries[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(entry).sort(), [
      "expires",
      "file",
      "reason",
      "rule",
      "specifier",
    ]);
    assert.equal(
      ({} as Record<string, unknown>).polluted,
      undefined,
      "Object.prototype must not be polluted",
    );
  });

  it("caps how many entries reach the response but still reports the true total", () => {
    const entries = Array.from(
      { length: MAX_HANDOFF_LEDGER_ENTRIES + 10 },
      (_v, i) => ({ rule: "r", file: `f${i}.ts` }),
    );
    const result = parseSuppressionLedger(ledger(entries));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.entries.length, MAX_HANDOFF_LEDGER_ENTRIES);
    assert.equal(result.value.total, MAX_HANDOFF_LEDGER_ENTRIES + 10);
  });
});

describe("buildHandoffResponse", () => {
  it("is pure — same input, same output, no I/O", () => {
    const texts = {
      "hexagen-report.md": { text: REPORT, truncated: false },
    } as const;
    const a = buildHandoffResponse("Demo", { ...texts });
    const b = buildHandoffResponse("Demo", { ...texts });
    assert.deepEqual(a, b);
    assert.equal(a.verdict, "ingested");
  });

  it("warns when an artifact was truncated on the way in", () => {
    const result = buildHandoffResponse("Demo", {
      "hexagen-report.md": { text: REPORT, truncated: true },
    });
    assert.ok(result.warnings.some((w) => /truncated/.test(w)));
  });
});
