/**
 * DOS-2.1 — the grounded prompt must not hide ports behind `.slice(0, 10)`.
 *
 * The live map from `apps/web/app/api/llm/context/route.ts` is already
 * complete. Both adapters truncated it to ten insertion-ordered rows, so
 * 85 of 95 entries never reached the model and an accurate owner could
 * lose its seat to a phantom. The fix is one formatter, used by both
 * adapters, with no numeric cap.
 *
 * Anti-stub: "no slice in source" alone is satisfiable by deleting the
 * listing. The 11-port prompt assertion is the content a stub cannot
 * manufacture. The source walk is the class check that a second adapter
 * cannot quietly keep the old window.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGroundedSystemPrompt } from "../../../src/infrastructure/adapters/app-compatibility.adapter";
import { formatPortOwnershipLines } from "../../../src/infrastructure/adapters/format-port-ownership";
import { GroundedPromptAdapter } from "../../../src/infrastructure/adapters/migrated-grounded-prompt.adapter";
import type { BuildSystemInstructionRequest } from "../../../src/application/ports/in/build-system-instruction.port";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADAPTERS_DIR = path.resolve(HERE, "../../../src/infrastructure/adapters");

const ELEVEN_PORTS: Record<string, string> = {
  ZebraPort: "context-z",
  AlphaPort: "context-a",
  BetaPort: "context-b",
  GammaPort: "context-g",
  DeltaPort: "context-d",
  EpsilonPort: "context-e",
  ZetaPort: "context-zeta",
  EtaPort: "context-eta",
  ThetaPort: "context-th",
  IotaPort: "context-i",
  KappaPort: "context-k",
};

function elevenPortPrompt(): string {
  return buildGroundedSystemPrompt({
    governance: {
      system: "orders",
      scope: "acme",
      architecture: "modular-monolith",
      boundedContexts: [],
      ports: ELEVEN_PORTS,
      invariants: [],
      timestamp: "2026-08-19T00:00:00.000Z",
    },
    editor: {
      filename: "order.ts",
      language: "typescript",
      content: "export {}",
      lineStart: 1,
      lineEnd: 1,
    },
  });
}

describe("formatPortOwnershipLines (DOS-2.1)", () => {
  it("renders every entry, sorted by port name — the 11th is not dropped", () => {
    const rendered = formatPortOwnershipLines(ELEVEN_PORTS);
    const names = Object.keys(ELEVEN_PORTS);
    assert.equal(names.length, 11, "fixture must stay above the old window");
    for (const name of names) {
      assert.match(
        rendered,
        new RegExp(`- ${name} → ${ELEVEN_PORTS[name]}`),
        `${name} must appear; a 10-row window would drop at least one`,
      );
    }
    const order = rendered
      .split("\n")
      .map((line) => line.replace(/^ {2}- ([^ ]+) →.*/, "$1"));
    assert.deepEqual(
      order,
      [...names].sort((left, right) => left.localeCompare(right)),
      "listing must be name-sorted, not insertion order",
    );
  });

  it("returns an empty string for an empty map (caller supplies fallback)", () => {
    assert.equal(formatPortOwnershipLines({}), "");
  });
});

describe("buildGroundedSystemPrompt lists every port", () => {
  it("includes all 11 ports and does not say (selected)", () => {
    const prompt = elevenPortPrompt();
    assert.match(prompt, /PORT OWNERSHIP:/);
    assert.doesNotMatch(prompt, /PORT OWNERSHIP \(selected\)/);
    for (const name of Object.keys(ELEVEN_PORTS)) {
      assert.match(prompt, new RegExp(`- ${name} →`));
    }
  });
});

describe("both grounded-prompt adapters share the un-windowed formatter", () => {
  const adapterFiles = [
    "app-compatibility.adapter.ts",
    "migrated-grounded-prompt.adapter.ts",
  ] as const;

  it("finds both adapters and neither still slices to 10", async () => {
    assert.equal(
      adapterFiles.length,
      2,
      "DOS-2.1 named two adapters; shrinking the list re-opens the class",
    );
    for (const fileName of adapterFiles) {
      const source = await fs.readFile(
        path.join(ADAPTERS_DIR, fileName),
        "utf8",
      );
      assert.ok(
        source.length > 0,
        `${fileName} must exist — an empty scan is not a pass`,
      );
      assert.match(
        source,
        /formatPortOwnershipLines/,
        `${fileName} must call the shared formatter; a local copy can grow a window again`,
      );
      assert.doesNotMatch(
        source,
        /\.slice\(\s*0\s*,\s*10\s*\)/,
        `${fileName} still has the old 10-row window`,
      );
    }
  });

  it("GroundedPromptAdapter heading matches the live prompt (no selected window)", async () => {
    const adapter = new GroundedPromptAdapter();
    const instruction = await adapter.build(
      {} as BuildSystemInstructionRequest,
    );
    assert.match(instruction.content, /PORT OWNERSHIP:/);
    assert.doesNotMatch(instruction.content, /PORT OWNERSHIP \(selected\)/);
  });
});
