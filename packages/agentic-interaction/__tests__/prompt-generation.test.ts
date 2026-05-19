import { describe, it } from "node:test";
import assert from "node:assert";
import {
  CONTEXT_LIST_SYSTEM_PROMPT,
  PORTS_LIST_SYSTEM_PROMPT,
} from "../src/domain/prompts/generate-manifest.prompt.js";

function extractNdjsonExamples(prompt: string): string[] {
  const lines = prompt.split("\n");
  const examples: string[] = [];
  let inExampleSection = false;

  for (const line of lines) {
    if (line.includes("CRITICAL OUTPUT FORMAT")) {
      inExampleSection = true;
      continue;
    }
    if (inExampleSection) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        examples.push(trimmed);
      } else if (trimmed.startsWith("{") && !trimmed.endsWith("}")) {
        examples.push(trimmed);
      } else if (examples.length > 0 && trimmed === "") {
        continue;
      } else if (
        examples.length > 0 &&
        !trimmed.startsWith("{") &&
        trimmed !== ""
      ) {
        break;
      }
    }
  }

  return examples;
}

function extractFirstNdjsonExample(prompt: string): string {
  const examples = extractNdjsonExamples(prompt);
  if (examples.length === 0) {
    throw new Error("No NDJSON examples found in prompt");
  }
  return examples[0];
}

describe("prompt-generation", () => {
  describe("CONTEXT_LIST_SYSTEM_PROMPT", () => {
    it("contains valid NDJSON example", () => {
      const example = extractFirstNdjsonExample(CONTEXT_LIST_SYSTEM_PROMPT);
      assert.doesNotThrow(
        () => JSON.parse(example),
        "Context example should parse without error",
      );
    });

    it("example has required fields", () => {
      const example = extractFirstNdjsonExample(CONTEXT_LIST_SYSTEM_PROMPT);
      const parsed = JSON.parse(example);
      assert.ok(parsed.name, "Example should have name");
      assert.ok(parsed.contextType, "Example should have contextType");
      assert.ok(parsed.reasoning, "Example should have reasoning");
    });

    it("enforces type enum values", () => {
      const prompt = CONTEXT_LIST_SYSTEM_PROMPT;
      assert.ok(
        prompt.includes("core,") || prompt.includes("core "),
        "Prompt should mention 'core'",
      );
      assert.ok(
        prompt.includes("supporting"),
        "Prompt should mention 'supporting'",
      );
      assert.ok(prompt.includes("generic"), "Prompt should mention 'generic'");
      assert.ok(prompt.includes("driver"), "Prompt should mention 'driver'");
      assert.ok(
        prompt.includes("shared-kernel"),
        "Prompt should mention 'shared-kernel'",
      );
    });

    it("says type must not be empty", () => {
      const lowerPrompt = CONTEXT_LIST_SYSTEM_PROMPT.toLowerCase();
      assert.ok(
        lowerPrompt.includes("not empty") ||
          lowerPrompt.includes("not be empty") ||
          lowerPrompt.includes("must be"),
        "Prompt should warn against empty type",
      );
    });
  });

  describe("PORTS_LIST_SYSTEM_PROMPT", () => {
    it("contains valid NDJSON example", () => {
      const example = extractFirstNdjsonExample(PORTS_LIST_SYSTEM_PROMPT);
      assert.doesNotThrow(
        () => JSON.parse(example),
        "Ports example should parse without error",
      );
    });

    it("example has in and out fields", () => {
      const examples = extractNdjsonExamples(PORTS_LIST_SYSTEM_PROMPT);
      const allPorts = examples
        .map((e) => JSON.parse(e))
        .filter((p) => p.type === "port");
      assert.ok(allPorts.length > 0, "Should have port examples");
    });

    it("example ports have required fields", () => {
      const examples = extractNdjsonExamples(PORTS_LIST_SYSTEM_PROMPT);
      const allPorts = examples
        .map((e) => JSON.parse(e))
        .filter((p) => p.type === "port");
      for (const port of allPorts) {
        assert.ok(port.name, "Port should have name");
        assert.ok(port.portType, "Port should have portType");
        assert.ok(port.description, "Port should have description");
      }
    });

    it("enforces exact type values", () => {
      assert.ok(
        PORTS_LIST_SYSTEM_PROMPT.includes('"command"'),
        "Prompt should mention 'command'",
      );
      assert.ok(
        PORTS_LIST_SYSTEM_PROMPT.includes('"repository"'),
        "Prompt should mention 'repository'",
      );
    });

    it("includes port type descriptions", () => {
      const prompt = PORTS_LIST_SYSTEM_PROMPT;
      assert.ok(
        prompt.includes("inbound") || prompt.includes("Inbound"),
        "Prompt should mention inbound",
      );
      assert.ok(
        prompt.includes("outbound") || prompt.includes("Outbound"),
        "Prompt should mention outbound",
      );
    });
  });
});
