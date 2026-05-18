import test from "node:test";
import assert from "node:assert";
import {
  compileStage0Prompt,
  compileStage1Prompt,
  compileStage2Prompt,
  compileStage3Prompt,
  compileStage4Prompt,
  compileStage6Prompt,
  buildStageRetryPrompt,
} from "../../../src/domain/prompts/generate-manifest.prompt.js";
import { compileTopologyUserPrompt } from "../../../src/domain/prompts/generate-topology.prompt.js";

// Minimal valid state for each stage — matches PipelineState interface

test("compileStage0Prompt includes user description", () => {
  const prompt = compileStage0Prompt({ userDescription: "Test system" });
  assert.match(prompt, /Test system/);
});

test("compileStage1Prompt includes user description", () => {
  const state = {
    stage0: {
      intent: "Invoice management system",
      projectName: undefined,
      explicitTechnologies: [],
      explicitPatterns: [],
      ambiguities: [],
    },
  };
  const prompt = compileStage1Prompt(state);
  assert.match(prompt, /Invoice management system/);
});

test("compileStage2Prompt includes classification", () => {
  const state = {
    stage0: {
      intent: "Test",
      projectName: undefined,
      explicitTechnologies: [],
      explicitPatterns: [],
      ambiguities: [],
    },
    stage1: {
      verbs: [],
      nouns: [],
      subdomains: ["invoicing-billing"],
      aggregateRoots: [],
      entities: [],
      valueObjects: [],
      domainEvents: [],
      useCases: [],
    },
    stage2: {
      accepted: [
        {
          name: "invoicing-billing",
          type: "core",
          responsibility: "test",
          aggregateRoots: [],
          useCaseNames: [],
          eventsPublished: [],
          reasoning: "test",
        },
      ],
      rejected: [],
      uncertain: [],
    },
  };
  const prompt = compileStage2Prompt(state);
  assert.match(prompt, /invoicing-billing/);
});

test("compileStage3Prompt includes intent header and all accepted contexts", () => {
  const state = {
    stage0: {
      intent: "Test",
      projectName: undefined,
      explicitTechnologies: [],
      explicitPatterns: [],
      ambiguities: [],
    },
    stage1: {
      verbs: [],
      nouns: [],
      subdomains: ["invoicing-billing"],
      aggregateRoots: [],
      entities: [],
      valueObjects: [],
      domainEvents: [],
      useCases: [],
    },
    stage2: {
      accepted: [
        {
          name: "invoicing-billing",
          type: "core",
          responsibility: "test",
          aggregateRoots: [],
          useCaseNames: [],
          eventsPublished: [],
          reasoning: "test",
        },
      ],
      rejected: [],
      uncertain: [],
    },
  } as any;
  const prompt = compileStage3Prompt(state);
  assert.match(prompt, /<original_intent>/);
  assert.match(prompt, /<accepted_contexts>/);
  assert.match(prompt, /invoicing-billing/);
  assert.match(prompt, /notification-delivery/);
});

test("compileStage4Prompt includes intent header and context names", () => {
  const state = {
    stage0: {
      intent: "Test",
      projectName: undefined,
      explicitTechnologies: [],
      explicitPatterns: [],
      ambiguities: [],
    },
    stage2: {
      accepted: [
        {
          name: "invoicing-billing",
          type: "core",
          responsibility: "test",
          aggregateRoots: [],
          useCaseNames: [],
          eventsPublished: [],
          reasoning: "test",
        },
      ],
      rejected: [],
      uncertain: [],
    },
    stage3: { contextName: "invoicing-billing", in: [], out: [] },
  } as any;
  const prompt = compileStage4Prompt(state, { userDescription: "test" });
  assert.match(prompt, /<original_intent>/);
  assert.match(prompt, /invoicing-billing/);
});

test("compileStage6Prompt includes validation rules", () => {
  const state = {
    stage0: {
      intent: "Test",
      projectName: undefined,
      explicitTechnologies: [],
      explicitPatterns: [],
      ambiguities: [],
    },
    stage2: {
      accepted: [
        {
          name: "invoicing-billing",
          type: "core",
          responsibility: "test",
          aggregateRoots: [],
          useCaseNames: [],
          eventsPublished: [],
          reasoning: "test",
        },
      ],
      rejected: [],
      uncertain: [],
    },
    stage5: { yaml: "test", parsedObject: {}, assemblyWarnings: [] },
    contextMappings: [],
  } as any;
  const prompt = compileStage6Prompt(state);
  assert.match(prompt, /validation/);
});

test("compileStage1Prompt includes user description (stage0->stage1)", () => {
  const state = {
    stage0: { userDescription: "Invoice management system" },
    stage1: {},
  } as any;
  const prompt = compileStage1Prompt(state);
  assert.match(prompt, /Invoice management system/);
});

test("compileStage2Prompt includes classification (stage1->stage2)", () => {
  const state = {
    stage0: { userDescription: "Test" },
    stage1: {},
    stage2: {
      accepted: [{ name: "invoicing-billing", type: "core" }],
      rejected: [],
      uncertain: [],
    },
  } as any;
  const prompt = compileStage2Prompt(state);
  assert.match(prompt, /invoicing-billing/);
});

test("compileStage3Prompt includes intent header", () => {
  const state = {
    stage0: { originalIntent: "Test intent", userDescription: "Test" },
    stage1: { aggregateRoots: [], domainEvents: [] },
    stage2: {
      accepted: [
        { name: "invoicing-billing", type: "core", reasoning: "test" },
      ],
      rejected: [],
      uncertain: [],
    },
  } as any;
  const prompt = compileStage3Prompt(state);
  assert.match(prompt, /<original_intent>/);
  assert.match(prompt, /<accepted_contexts>/);
});

test("compileStage4Prompt includes domain analysis", () => {
  const state = {
    stage0: { userDescription: "Test" },
    stage2: { accepted: [] },
    stage3: { domainAnalysis: { subdomains: [], aggregateRoots: [] } },
  } as any;
  const prompt = compileStage4Prompt(state, { userDescription: "Test" });
  assert.match(prompt, /domain analysis/i);
});

test("compileStage6Prompt includes R01 validation rule", () => {
  const state = {
    stage0: {
      intent: "Test",
      projectName: undefined,
      explicitTechnologies: [],
      explicitPatterns: [],
      ambiguities: [],
    },
    stage2: { accepted: [], rejected: [], uncertain: [] },
    stage5: { yaml: "test", parsedObject: {}, assemblyWarnings: [] },
    contextMappings: [],
  } as any;
  const prompt = compileStage6Prompt(state);
  assert.match(prompt, /R01/); // R01 rule should appear in the prompt
});

test("compileTopologyUserPrompt includes contexts", () => {
  const prompt = compileTopologyUserPrompt({ userDescription: "Test system" });
  assert.match(prompt, /Test system/);
});

test("buildStageRetryPrompt (stage 0) includes error detail", () => {
  const result = buildStageRetryPrompt({
    stage: 0,
    attempt: 2,
    failedOutput: "invalid output",
    errorDetail: "JSON parse error",
    originalPrompt: "Original prompt",
  });
  assert.match(result.content, /JSON parse error/);
});

test("buildStageRetryPrompt (stage 2) includes stage 2 reminder", () => {
  const result = buildStageRetryPrompt({
    stage: 2,
    attempt: 1,
    failedOutput: '{"status": "accepted", "name": "missing-quotes"}',
    errorDetail: "JSON parse error: Expected string at position 25",
    originalPrompt: "Domain Subdomains: ...",
  });
  assert.match(result.content, /JSON parse error/);
  assert.match(result.content, /missing-quotes/);
});

test("buildStageRetryPrompt (stage 4) includes adapter context", () => {
  const result = buildStageRetryPrompt({
    stage: 4,
    attempt: 1,
    failedOutput: "invalid",
    errorDetail: "Missing adapters",
    originalPrompt: "Adapter assignment",
  });
  assert.match(result.content, /Missing adapters/);
});

test("buildStageRetryPrompt truncates failed output at 800 chars", () => {
  const longOutput = "x".repeat(1000);
  const result = buildStageRetryPrompt({
    stage: 3,
    attempt: 1,
    failedOutput: longOutput,
    errorDetail: "error",
    originalPrompt: "prompt",
  });
  assert.match(result.content, /\[truncated\]/);
  assert.ok(!result.content.includes("x".repeat(801)));
});
