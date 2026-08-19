/**
 * HEX-029 / Wave A1 8.12(d) — conversation/governance types belong in domain.
 *
 * `app-compatibility.adapter.ts` declared ChatMessage, GovernancePayload, and
 * EditorState next to the adapter functions that consume them. Domain owns
 * those shapes; the adapter only imports them.
 *
 * Do not import @hexagen/local-llm ChatMessage here — local-llm depends_on
 * prompt-compiler. Owning a prompt-compiler ChatMessage keeps the graph.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ChatMessage,
  EditorState,
  GovernancePayload,
} from "../../src/domain";
import {
  buildGroundedSystemPrompt,
  prunedHistoryWindow,
} from "../../src/infrastructure/adapters/app-compatibility.adapter";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../../src");
const DOMAIN_DIR = path.join(SRC, "domain");
const ADAPTER = path.join(
  SRC,
  "infrastructure/adapters/app-compatibility.adapter.ts",
);

const TYPE_NAMES = ["ChatMessage", "GovernancePayload", "EditorState"] as const;

async function readDomainSources(): Promise<string> {
  const files = await fs.readdir(DOMAIN_DIR);
  const sources = await Promise.all(
    files
      .filter((name) => name.endsWith(".ts"))
      .map((name) => fs.readFile(path.join(DOMAIN_DIR, name), "utf8")),
  );
  return sources.join("\n");
}

describe("HEX-029 conversation types live in domain", () => {
  it("domain declares ChatMessage, GovernancePayload, and EditorState", async () => {
    const domain = await readDomainSources();
    assert.ok(domain.length > 0, "domain source walk must not be empty");
    for (const name of TYPE_NAMES) {
      assert.match(
        domain,
        new RegExp(`export interface ${name}\\b`),
        `${name} must be declared under src/domain`,
      );
    }
    assert.doesNotMatch(
      domain,
      /from\s+["']@hexagen\/local-llm/,
      "prompt-compiler domain must not import local-llm ChatMessage",
    );
  });

  it("adapter imports the types from domain and does not re-declare them", async () => {
    const source = await fs.readFile(ADAPTER, "utf8");
    assert.ok(
      source.length > 0,
      "adapter must exist — an empty scan is not a pass",
    );
    for (const name of TYPE_NAMES) {
      assert.doesNotMatch(
        source,
        new RegExp(`(?:export\\s+)?(?:interface|type)\\s+${name}\\b`),
        `${name} must not be re-declared in the adapter (exported or local)`,
      );
      assert.match(
        source,
        new RegExp(
          `import\\s+type\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["'][^"']*domain/`,
        ),
        `${name} must be import type'd from a domain/ module`,
      );
    }
    assert.doesNotMatch(
      source,
      /from\s+["']@hexagen\/local-llm/,
      "adapter must not invert the local-llm → prompt-compiler graph",
    );
  });

  it("prunedHistoryWindow accepts a domain ChatMessage[]", () => {
    const messages: ChatMessage[] = [
      { id: "1", role: "user", content: "hello" },
      { id: "2", role: "assistant", content: "hi" },
    ];
    const result = prunedHistoryWindow(messages, "sys", "next");
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { role: "user", content: "hello" });
    assert.deepEqual(result[1], { role: "assistant", content: "hi" });
  });

  it("buildGroundedSystemPrompt accepts domain GovernancePayload and EditorState", () => {
    const governance: GovernancePayload = {
      system: "orders",
      scope: "acme",
      architecture: "modular-monolith",
      boundedContexts: [{ name: "Ordering", type: "core" }],
      ports: { PlaceOrderPort: "Ordering" },
      invariants: [{ name: "no-cross-context-write", priority: "critical" }],
      timestamp: "2026-08-19T00:00:00.000Z",
    };
    const editor: EditorState = {
      filename: "order.ts",
      language: "typescript",
      content: "export {}",
      lineStart: 1,
      lineEnd: 1,
    };
    const prompt = buildGroundedSystemPrompt({ governance, editor });
    assert.match(prompt, /System: orders/);
    assert.match(prompt, /Ordering \(core\)/);
    assert.match(prompt, /PlaceOrderPort → Ordering/);
    assert.match(prompt, /order\.ts/);
  });
});
