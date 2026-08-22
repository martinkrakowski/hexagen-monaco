/**
 * Consumer-side contract test for the scan envelope's `findings` (BF-0.3 / F-04).
 *
 * `types.ts` declares types only, so what is worth asserting is that the shape
 * `hexagen scan` ACTUALLY emits is consumable here without being reshaped on
 * the way in. The fixture below is a producer-shaped envelope line built around
 * a finding captured verbatim from a real run of the built linter
 * (`node tools/arch-linter/dist/cli.js --root <repo> --json --ratchet`), so a
 * producer-side rename fails this test instead of silently yielding
 * `undefined` fields in the UI.
 *
 * Deliberately NOT asserted here: `introduced` / `baselineGrowth`. The linter
 * emits them, packages/sync drops them, and this side must never grow a reader
 * for fields the producer does not send.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { ProjectScanResponse, ScanFinding, ScanFindings } from "../types";

// String.raw keeps the `\n` sequences inside the JSON string escaped for
// JSON.parse rather than being turned into real newlines by TypeScript.
const ENVELOPE_LINE = String.raw`{"schemaVersion":"1.0.0","layout":"contexts: []\n","filesScanned":null,"reportMarkdown":null,"error":null,"findings":{"fresh":[{"rule":"npm-package-in-domain","file":"packages/billing/src/domain/ports/out/llm-client.port.ts","specifier":"zod","message":"Domain Violation in [billing]:\n  npm package 'zod' imported in the domain layer (specifier 'zod')."}],"baselined":[],"stale":[{"rule":"cross-context-import","file":"packages/billing/src/app.ts","specifier":"@acme/shipping","message":"","reason":"legacy coupling","expires":"2026-12-31"}],"expired":[],"collected":true}}`;

/**
 * The envelope as the adapter finds it: the LAST stdout line starting with
 * `{`, after the human next-steps.
 */
function parseEnvelopeFindings(stdout: string): ScanFindings | undefined {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .at(-1);
  if (!line) return undefined;
  const parsed = JSON.parse(line) as { findings?: ScanFindings };
  return parsed.findings;
}

describe("scan envelope findings — consumer contract", () => {
  it("reads a producer-shaped envelope into ScanFindings without reshaping", () => {
    const findings = parseEnvelopeFindings(
      ["Kept existing .architecture/layout.yaml.", ENVELOPE_LINE].join("\n"),
    );

    assert.notEqual(findings, undefined);
    if (!findings) return;

    assert.equal(findings.collected, true);
    assert.equal(findings.failureReason, undefined);
    assert.equal(findings.fresh.length, 1);
    assert.equal(findings.baselined.length, 0);
    assert.equal(findings.expired.length, 0);

    // The four fields BF-0.3 names, all present and all strings.
    const fresh: ScanFinding = findings.fresh[0];
    assert.equal(fresh.rule, "npm-package-in-domain");
    assert.match(fresh.file, /llm-client\.port\.ts$/);
    assert.equal(fresh.specifier, "zod");
    assert.match(fresh.message, /npm package 'zod'/);

    // Baseline-sourced buckets carry `reason` / `expires` and an empty
    // `message`; a renderer that keys off `message` alone shows nothing for
    // them, which is why both optional fields are part of the type.
    const stale: ScanFinding = findings.stale[0];
    assert.equal(stale.message, "");
    assert.equal(stale.reason, "legacy coupling");
    assert.equal(stale.expires, "2026-12-31");
  });

  it("keeps 'could not be read' distinguishable from 'clean tree'", () => {
    // Both have four empty arrays. `collected` is the ONLY thing separating a
    // scan that read no violations from one that could not read any, and
    // conflating them is how a broken gate gets rendered as a pass.
    const uncollected: ScanFindings = {
      fresh: [],
      baselined: [],
      stale: [],
      expired: [],
      collected: false,
      failureReason: "hexagen-lint binary was not found",
    };
    const clean: ScanFindings = {
      fresh: [],
      baselined: [],
      stale: [],
      expired: [],
      collected: true,
    };

    assert.notEqual(uncollected.collected, clean.collected);
    assert.equal(typeof uncollected.failureReason, "string");
    assert.equal(clean.failureReason, undefined);

    // The assertions above compare two literals declared in this test and
    // cannot fail while the types compile. The invariant is now enforced by
    // the TYPE instead, so the checks below are the ones with teeth.
    //
    // Caveat, stated rather than glossed: apps/web/tsconfig.json excludes
    // **/*.test.ts, so `yarn typecheck` does not read this file and these
    // directives are not enforced in CI today. Verified by running tsc
    // against this file directly -- neither reports TS2578 ("unused
    // @ts-expect-error"), so both are suppressing real errors. They become
    // CI-enforced the moment that exclude is fixed, which is its own packet.

    // @ts-expect-error collected:false must carry a failureReason -- a bare
    // uncollected summary renders as "0 findings", i.e. a clean bill of health
    // for a scan that never ran.
    const missingReason: ScanFindings = {
      fresh: [],
      baselined: [],
      stale: [],
      expired: [],
      collected: false,
    };
    void missingReason;

    // @ts-expect-error a collected summary cannot carry a failure reason.
    const contradictory: ScanFindings = {
      fresh: [],
      baselined: [],
      stale: [],
      expired: [],
      collected: true,
      failureReason: "should not typecheck",
    };
    void contradictory;
  });

  it("is optional on ProjectScanResponse, so a pre-BF-0.3 CLI still typechecks", () => {
    // A response assembled before the CLI ran (rejected zip, missing binary)
    // has no findings at all. `undefined` means "not reported"; it must not be
    // synthesised into an empty-and-clean summary here.
    const withoutFindings: ProjectScanResponse = {
      verdict: "could-not-run",
      exitCode: null,
      projectName: "acme",
      layoutExcerpt: null,
      filesScanned: null,
      reportMarkdown: null,
      errorMessage: "hexagen CLI was not found on the server.",
    };
    assert.equal(withoutFindings.findings, undefined);

    const withFindings: ProjectScanResponse = {
      ...withoutFindings,
      verdict: "violations",
      exitCode: 1,
      errorMessage: null,
      findings: parseEnvelopeFindings(ENVELOPE_LINE) ?? null,
    };
    assert.equal(withFindings.findings?.fresh.length, 1);
  });
});
