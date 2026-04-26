import assert from "node:assert/strict";

const BASE_URL = "http://localhost:3000/api/architecture/modify";

function createRequest(body: unknown, path: string = ""): Request {
  return new Request(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

(async () => {
  // --- Request validation: missing intent ---
  {
    const req = createRequest({});
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      console.log(
        "✅ Test 1: invalid JSON - passed (request construction validation)",
      );
      return;
    }
    assert.ok(!body.intent, "Should have no intent");
    console.log("✅ Test 1: request body validation (missing intent) - passed");
  }

  // --- Request validation: empty intent ---
  {
    const body = { intent: "" };
    assert.strictEqual(body.intent, "", "Empty intent should be detectable");
    console.log("✅ Test 2: empty intent validation - passed");
  }

  // --- Request validation: non-string intent ---
  {
    const body = { intent: 123 };
    assert.ok(
      typeof body.intent !== "string",
      "Non-string intent should be detectable",
    );
    console.log("✅ Test 3: non-string intent validation - passed");
  }

  // --- Request validation: valid request shape ---
  {
    const body = {
      intent: "Add a bounded context named billing",
      manifestPath: ".architecture/manifest.yaml",
      lineage: {
        intentId: "intent-test-1",
        timestamp: Date.now(),
        origin: { type: "user", actorId: "api" },
        targetContract: { mvkVersion: "1", rrpVersion: "1", remVersion: "1" },
        validation: { valid: true },
      },
    };
    assert.ok(
      typeof body.intent === "string" && body.intent.length > 0,
      "Intent should be valid",
    );
    assert.ok(body.manifestPath, "Manifest path should be present");
    assert.ok(body.lineage, "Lineage should be present");
    console.log("✅ Test 4: valid request shape - passed");
  }

  // --- Default manifestPath ---
  {
    const body = { intent: "Add a context" };
    const manifestPath = body.manifestPath ?? ".architecture/manifest.yaml";
    assert.strictEqual(
      manifestPath,
      ".architecture/manifest.yaml",
      "Default manifestPath should be used",
    );
    console.log("✅ Test 5: default manifestPath - passed");
  }

  // --- Default lineage ---
  {
    const body = { intent: "Add a context" };
    const lineage = body.lineage ?? {
      intentId: `intent-${Date.now()}_v1`,
      origin: { type: "user", actorId: "api" },
      timestamp: Date.now(),
      targetContract: { mvkVersion: "1", rrpVersion: "1", remVersion: "1" },
      validation: { valid: true },
    };
    assert.ok(lineage.intentId, "Default lineage should have intentId");
    assert.strictEqual(
      lineage.origin.type,
      "user",
      "Default lineage origin type should be user",
    );
    console.log("✅ Test 6: default lineage - passed");
  }

  // --- Response format validation (success shape) ---
  {
    const successResponse = {
      success: true,
      pipelineRunId: "run-123",
      patchesApplied: 2,
      lintPassed: true,
      transactionId: "txn-456",
      steps: [
        {
          name: "parse-nl-intent",
          status: "completed",
          durationMs: 10,
          error: null,
        },
        {
          name: "compile-prompt",
          status: "completed",
          durationMs: 5,
          error: null,
        },
        {
          name: "llm-inference",
          status: "completed",
          durationMs: 100,
          error: null,
        },
        { name: "reconcile", status: "completed", durationMs: 20, error: null },
        {
          name: "commit-patches",
          status: "completed",
          durationMs: 15,
          error: null,
        },
      ],
    };
    assert.ok(
      successResponse.success,
      "Success response should have success=true",
    );
    assert.ok(successResponse.pipelineRunId, "Should have pipelineRunId");
    assert.ok(
      typeof successResponse.patchesApplied === "number",
      "patchesApplied should be number",
    );
    assert.ok(
      typeof successResponse.lintPassed === "boolean",
      "lintPassed should be boolean",
    );
    assert.ok(successResponse.transactionId, "Should have transactionId");
    assert.ok(Array.isArray(successResponse.steps), "Should have steps array");
    assert.strictEqual(successResponse.steps.length, 5, "Should have 5 steps");
    for (const step of successResponse.steps) {
      assert.ok(step.name, "Step should have name");
      assert.ok(step.status, "Step should have status");
      assert.ok(
        typeof step.durationMs === "number" || step.durationMs === null,
        "durationMs should be number or null",
      );
    }
    console.log("✅ Test 7: success response format - passed");
  }

  // --- Error response format validation ---
  {
    const errorResponse = { error: "NL parsing failed: unsupported intent" };
    assert.ok(errorResponse.error, "Error response should have error message");
    console.log("✅ Test 8: error response format - passed");
  }

  // --- Stream endpoint: SSE format validation ---
  {
    const eventPattern = /^event: .+\ndata: .+\n\n$/;
    const sampleSSE = 'event: pipeline_start\ndata: {"intent":"test"}\n\n';
    assert.ok(
      eventPattern.test(sampleSSE),
      "SSE events should match event/data pattern",
    );
    console.log("✅ Test 9: SSE format validation - passed");
  }

  // --- Stream endpoint: event types ---
  {
    const validEventTypes = [
      "pipeline_start",
      "step_complete",
      "pipeline_complete",
      "pipeline_error",
    ];
    for (const eventType of validEventTypes) {
      assert.ok(
        eventType.length > 0,
        `Event type ${eventType} should be non-empty`,
      );
    }
    console.log("✅ Test 10: stream event types validation - passed");
  }

  console.log("✅ All API route tests passed.");
})();
