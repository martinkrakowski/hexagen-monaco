import test from "node:test";
import assert from "node:assert/strict";
import {
  compileStage0Prompt,
  compileStage1Prompt,
  compileStage2Prompt,
  compileStage3Prompt,
  compileStage4Prompt,
  compileStage6Prompt,
  buildStageRetryPrompt,
} from "../../../src/domain/prompts/generate-manifest.prompt.ts";
import { compileTopologyUserPrompt } from "../../../src/domain/prompts/generate-topology.prompt.ts";
import { compileAdapterUserPrompt } from "../../../src/domain/prompts/generate-adapters.prompt.ts";

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
  const state0 = {
    intent: "Test",
    projectName: undefined,
    explicitTechnologies: [],
    explicitPatterns: [],
    ambiguities: [],
  };
  const state1 = {
    verbs: [],
    nouns: [],
    subdomains: ["invoicing-billing"],
    aggregateRoots: [],
    entities: [],
    valueObjects: [],
    domainEvents: [],
    useCases: [],
  };
  const state2 = {
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
      {
        name: "notification-delivery",
        type: "supporting",
        responsibility: "test",
        aggregateRoots: [],
        useCaseNames: [],
        eventsPublished: [],
        reasoning: "test",
      },
    ],
    rejected: [],
    uncertain: [],
  };
  const state = {
    stage0: state0,
    stage1: state1,
    stage2: state2,
  };
  const prompt = compileStage3Prompt(state);
  assert.match(prompt, /<original_intent>/);
  assert.match(prompt, /<accepted_contexts>/);
  assert.match(prompt, /invoicing-billing/);
  assert.match(prompt, /notification-delivery/);
});

test("compileStage4Prompt includes intent header and context names", () => {
  const state0 = {
    intent: "Test",
    projectName: undefined,
    explicitTechnologies: [],
    explicitPatterns: [],
    ambiguities: [],
  };
  const state2 = {
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
  };
  const state3 = {
    contexts: [{ contextName: "invoicing-billing", in: [], out: [] }],
  };
  const state = {
    stage0: state0,
    stage2: state2,
    stage3: state3,
  };
  const prompt = compileStage4Prompt(state, { userDescription: "test" });
  assert.match(prompt, /<original_intent>/);
  assert.match(prompt, /invoicing-billing/);
});

test("compileStage6Prompt includes validation rules", () => {
  const state0 = {
    intent: "Test",
    projectName: undefined,
    explicitTechnologies: [],
    explicitPatterns: [],
    ambiguities: [],
  };
  const state2 = {
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
  };
  const state5 = {
    yaml: "test",
    parsedObject: {},
    assemblyWarnings: [],
  };
  const state = {
    stage0: state0,
    stage2: state2,
    stage5: state5,
    contextMappings: [],
  };
  const prompt = compileStage6Prompt(state);
  assert.match(prompt, /R01/);
});

test("compileStage1Prompt includes user description (stage0->stage1)", () => {
  const state = {
    stage0: {
      intent: "Invoice management system",
      projectName: undefined,
      explicitTechnologies: [],
      explicitPatterns: [],
      ambiguities: [],
    },
    stage1: {},
  };
  const prompt = compileStage1Prompt(state);
  assert.match(prompt, /Invoice management system/);
});

test("compileStage2Prompt includes classification (stage1->stage2)", () => {
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
  };
  const prompt = compileStage2Prompt(state);
  assert.match(prompt, /invoicing-billing/);
});

test("compileStage3Prompt includes intent header", () => {
  const state0 = {
    originalIntent: "Test intent",
    userDescription: "Test",
  };
  const state1 = {
    aggregateRoots: [],
    domainEvents: [],
  };
  const state2 = {
    accepted: [
      {
        name: "invoicing-billing",
        type: "core",
        reasoning: "test",
      },
    ],
    rejected: [],
    uncertain: [],
  };
  const state = {
    stage0: state0,
    stage1: state1,
    stage2: state2,
  };
  const prompt = compileStage3Prompt(state);
  assert.match(prompt, /<original_intent>/);
  assert.match(prompt, /<accepted_contexts>/);
});

test("compileStage4Prompt includes domain analysis", () => {
  const state0 = {
    intent: "Test",
    projectName: undefined,
    explicitTechnologies: [],
    explicitPatterns: [],
    ambiguities: [],
  };
  const state2 = {
    accepted: [],
    rejected: [],
    uncertain: [],
  };
  const state3 = {
    contexts: [],
  };
  const state = {
    stage0: state0,
    stage2: state2,
    stage3: state3,
  };
  const prompt = compileStage4Prompt(state, { userDescription: "Test" });
  assert.match(prompt, /accepted_contexts/);
});

test("compileStage6Prompt includes R01 validation rule", () => {
  const state0 = {
    intent: "Test",
    projectName: undefined,
    explicitTechnologies: [],
    explicitPatterns: [],
    ambiguities: [],
  };
  const state2 = {
    accepted: [],
    rejected: [],
    uncertain: [],
  };
  const state5 = {
    yaml: "test",
    parsedObject: {},
    assemblyWarnings: [],
  };
  const state = {
    stage0: state0,
    stage2: state2,
    stage5: state5,
    contextMappings: [],
  };
  const prompt = compileStage6Prompt(state);
  assert.match(prompt, /R01/);
});

test("compileTopologyUserPrompt includes contexts", () => {
  const prompt = compileTopologyUserPrompt({ userDescription: "Test system" });
  assert.match(prompt, /Test system/);
});

test("compileTopologyUserPrompt escapes XML special characters", () => {
  const prompt = compileTopologyUserPrompt({
    userDescription: "Test & < > \" ' system",
  });
  assert.match(prompt, /Test &amp; &lt; &gt; &quot; &apos; system/);
});

test("compileTopologyUserPrompt includes maxContexts when provided", () => {
  const prompt = compileTopologyUserPrompt({
    userDescription: "Test",
    maxContexts: 5,
  });
  assert.match(prompt, /Maximum 5 bounded contexts/);
});

test("compileTopologyUserPrompt includes validationErrors when provided", () => {
  const prompt = compileTopologyUserPrompt({
    userDescription: "Test",
    validationErrors: "Invalid JSON format",
  });
  assert.match(prompt, /Invalid JSON format/);
  assert.match(prompt, /<validation_errors>/);
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

test("compileAdapterUserPrompt includes context name and ports", () => {
  const prompt = compileAdapterUserPrompt({
    contextName: "invoice-management",
    validatedPortInventory: ["CreateInvoicePort", "ListInvoicesPort"],
  });
  assert.match(prompt, /invoice-management/);
  assert.match(prompt, /CreateInvoicePort/);
  assert.match(prompt, /ListInvoicesPort/);
});

test("compileAdapterUserPrompt includes validation errors when provided", () => {
  const prompt = compileAdapterUserPrompt({
    contextName: "invoice-management",
    validatedPortInventory: ["CreateInvoicePort"],
    validationErrors: "Invalid adapter type",
  });
  assert.match(prompt, /Invalid adapter type/);
});
