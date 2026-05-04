import { describe, it } from "node:test";
import assert from "node:assert";
import {
  CONTEXT_LIST_SYSTEM_PROMPT,
  PORTS_LIST_SYSTEM_PROMPT,
} from "../src/domain/prompts/generate-manifest.prompt.js";

function extractJsonExample(prompt: string): string {
  const correctMatch = prompt.match(
    /EXAMPLE OF CORRECT OUTPUT:\s*([\s\S]*?)(?=EXAMPLE OF INCORRECT OUTPUT|$)/,
  );
  if (correctMatch) {
    return correctMatch[1].trim();
  }
  throw new Error("No EXAMPLE OF CORRECT OUTPUT found in prompt");
}

describe("prompt-generation", () => {
  describe("CONTEXT_LIST_SYSTEM_PROMPT", () => {
    it("example is valid JSON", () => {
      const example = extractJsonExample(CONTEXT_LIST_SYSTEM_PROMPT);
      assert.doesNotThrow(
        () => JSON.parse(example),
        "Context example should parse without error",
      );
    });

    it("example has required fields", () => {
      const example = extractJsonExample(CONTEXT_LIST_SYSTEM_PROMPT);
      const parsed = JSON.parse(example);
      assert.ok(parsed.contexts, "Should have contexts field");
      assert.ok(Array.isArray(parsed.contexts), "contexts should be an array");
    });

    it("example contexts have required fields", () => {
      const example = extractJsonExample(CONTEXT_LIST_SYSTEM_PROMPT);
      const parsed = JSON.parse(example);
      for (const ctx of parsed.contexts) {
        assert.ok(ctx.name, "Context should have name");
        assert.ok(ctx.type, "Context should have type");
        assert.ok(ctx.description, "Context should have description");
      }
    });

    it("enforces type enum values", () => {
      assert.ok(
        CONTEXT_LIST_SYSTEM_PROMPT.includes("'core'"),
        "Prompt should mention 'core'",
      );
      assert.ok(
        CONTEXT_LIST_SYSTEM_PROMPT.includes("'supporting'"),
        "Prompt should mention 'supporting'",
      );
      assert.ok(
        CONTEXT_LIST_SYSTEM_PROMPT.includes("'driver'"),
        "Prompt should mention 'driver'",
      );
      assert.ok(
        CONTEXT_LIST_SYSTEM_PROMPT.includes("'shared-kernel'"),
        "Prompt should mention 'shared-kernel'",
      );
    });

    it("says type must not be empty", () => {
      const lowerPrompt = CONTEXT_LIST_SYSTEM_PROMPT.toLowerCase();
      assert.ok(
        lowerPrompt.includes("not empty") ||
          lowerPrompt.includes("not be empty"),
        "Prompt should warn against empty type",
      );
    });
  });

  describe("PORTS_LIST_SYSTEM_PROMPT", () => {
    it("example is valid JSON", () => {
      const example = extractJsonExample(PORTS_LIST_SYSTEM_PROMPT);
      assert.doesNotThrow(
        () => JSON.parse(example),
        "Ports example should parse without error",
      );
    });

    it("example has in and out arrays", () => {
      const example = extractJsonExample(PORTS_LIST_SYSTEM_PROMPT);
      const parsed = JSON.parse(example);
      assert.ok(parsed.in !== undefined, "Should have in field");
      assert.ok(parsed.out !== undefined, "Should have out field");
      assert.ok(Array.isArray(parsed.in), "in should be an array");
      assert.ok(Array.isArray(parsed.out), "out should be an array");
    });

    it("example ports have required fields", () => {
      const example = extractJsonExample(PORTS_LIST_SYSTEM_PROMPT);
      const parsed = JSON.parse(example);
      const allPorts = [...parsed.in, ...parsed.out];
      for (const port of allPorts) {
        assert.ok(port.name, "Port should have name");
        assert.ok(port.type, "Port should have type");
        assert.ok(port.description, "Port should have description");
      }
    });

    it("enforces exact type values", () => {
      assert.ok(
        PORTS_LIST_SYSTEM_PROMPT.includes('"use-case"'),
        "Prompt should mention 'use-case'",
      );
      assert.ok(
        PORTS_LIST_SYSTEM_PROMPT.includes('"infrastructure"'),
        "Prompt should mention 'infrastructure'",
      );
    });

    it("includes both in and out arrays requirement", () => {
      assert.ok(
        PORTS_LIST_SYSTEM_PROMPT.includes('"in"') &&
          PORTS_LIST_SYSTEM_PROMPT.includes('"out"'),
        "Prompt should mention both in and out arrays",
      );
    });
  });
});
