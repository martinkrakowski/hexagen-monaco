import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGE3_PORTS_SYSTEM_PROMPT,
  compileStage3Prompt,
} from "../../../src/domain/prompts/generate-manifest.prompt.ts";
import type { PipelineState } from "../../../src/domain/value-objects/pipeline-state.ts";

test("STAGE3_PORTS_SYSTEM_PROMPT contains app-metadata exclusion block", () => {
  assert.match(STAGE3_PORTS_SYSTEM_PROMPT, /APP-LEVEL METADATA IS NOT A PORT/);
  assert.match(STAGE3_PORTS_SYSTEM_PROMPT, /responsibilities/);
  assert.match(STAGE3_PORTS_SYSTEM_PROMPT, /deployment/);
  assert.match(STAGE3_PORTS_SYSTEM_PROMPT, /schedule/);
  assert.match(STAGE3_PORTS_SYSTEM_PROMPT, /NEVER emit/i);
});

test("compileStage3Prompt compiles correctly and includes explicit technologies", () => {
  const state: PipelineState = {
    stage0: {
      intent: "Core portal functionality",
      projectName: "krakowski-portal",
      explicitTechnologies: ["PostgreSQL", "React"],
      runtimeConcerns: ["email-retry", "vercel"],
      explicitPatterns: [],
      ambiguities: [],
      isStructuredConfig: true,
    },
    stage1: {
      verbs: [],
      nouns: [],
      subdomains: ["customer-onboarding"],
      aggregateRoots: [
        {
          name: "Customer",
          subdomain: "customer-onboarding",
          identityFields: ["customerId"],
        },
      ],
      domainEvents: [],
      useCases: [],
    },
    stage2: {
      accepted: [
        {
          name: "customer-onboarding",
          type: "core",
          reasoning: "Manages customer registration",
          responsibility: "Handle onboarding and registration.",
          aggregateRoots: ["Customer"],
        },
      ],
      rejected: [],
      uncertain: [],
    },
  };

  const compiled = compileStage3Prompt(state);

  // Verify basic structure is compiled
  assert.match(compiled, /ACCEPTED BOUNDED CONTEXTS:/);
  assert.match(compiled, /customer-onboarding \(core\)/);
  assert.match(compiled, /AGGREGATE ROOTS/);
  assert.match(
    compiled,
    /Customer \(subdomain: customer-onboarding, identity: customerId\)/,
  );
  assert.match(compiled, /EXPLICIT TECHNOLOGIES/);
  assert.match(compiled, /PostgreSQL, React/);
});

test("Stage 3 prompt MUST NOT contain worker responsibilities (Phase 1 gate)", () => {
  const state: PipelineState = {
    stage0: {
      intent: "Core portal functionality",
      projectName: "krakowski-portal",
      explicitTechnologies: ["PostgreSQL"],
      runtimeConcerns: ["email-retry", "vercel", "fly.io"],
      explicitPatterns: [],
      ambiguities: [],
      isStructuredConfig: true,
    },
    stage1: {
      verbs: [],
      nouns: [],
      subdomains: ["customer-onboarding"],
      aggregateRoots: [
        {
          name: "Customer",
          subdomain: "customer-onboarding",
          identityFields: ["customerId"],
        },
      ],
      domainEvents: [],
      useCases: [],
    },
    stage2: {
      accepted: [
        {
          name: "customer-onboarding",
          type: "core",
          reasoning: "Manages customer registration",
          responsibility: "Handle onboarding and registration.",
          aggregateRoots: ["Customer"],
        },
      ],
      rejected: [],
      uncertain: [],
    },
  };

  const compiled = compileStage3Prompt(state);

  // Assert via assert.doesNotMatch that worker responsibilities/platforms are not present
  assert.doesNotMatch(compiled, /email-retry/);
  assert.doesNotMatch(compiled, /vercel/);
  assert.doesNotMatch(compiled, /fly\.io/);

  // Assert via assert.match that PostgreSQL is present
  assert.match(compiled, /PostgreSQL/);
});
