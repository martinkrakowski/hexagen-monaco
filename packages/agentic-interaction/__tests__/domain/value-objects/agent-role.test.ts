import { describe, it } from "node:test";
import assert from "node:assert";
import {
  createArchitectAgent,
  createSecurityAuditor,
  createValidationSpecialist,
  type AgentContext,
} from "../../../src/domain/value-objects/agent-role.js";

describe("AgentRole", () => {
  it("ARCHITECT agent has correct role", () => {
    const agent: AgentContext = createArchitectAgent();
    assert.strictEqual(agent.role, "ARCHITECT");
    assert.ok(agent.systemPrompt.length > 0);
    assert.strictEqual(agent.maxRetries, 2);
  });

  it("SECURITY_AUDITOR has shorter timeout", () => {
    const agent = createSecurityAuditor();
    assert.strictEqual(agent.role, "SECURITY_AUDITOR");
    assert.ok(agent.timeoutMs < 30_000);
  });

  it("VALIDATION_SPECIALIST has correct config", () => {
    const agent = createValidationSpecialist();
    assert.strictEqual(agent.role, "VALIDATION_SPECIALIST");
    assert.strictEqual(agent.maxRetries, 2);
    assert.ok(agent.systemPrompt.includes("hallucinated"));
  });
});
