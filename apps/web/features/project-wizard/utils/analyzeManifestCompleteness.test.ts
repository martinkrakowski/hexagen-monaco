import { test } from "vitest";
import assert from "node:assert";
import { analyzeManifestCompleteness } from "./analyzeManifestCompleteness";
import { emptyFormValues } from "../config";

test("analyzeManifestCompleteness - empty manifest", () => {
  const result = analyzeManifestCompleteness(emptyFormValues);

  assert.strictEqual(result.governance, true); // emptyFormValues has default workspaceName="@hexagen"
  assert.strictEqual(result.boundedContexts, false);
  assert.strictEqual(result.peerMappings, true); // only 1 default context, so mappings not needed
  assert.strictEqual(result.portConfiguration, false);
  assert.strictEqual(result.isComplete, false);
  assert.strictEqual(result.firstIncompleteStepIndex, 1); // governance is true, so next incomplete is boundedContexts
});

test("analyzeManifestCompleteness - partially populated (governance only)", () => {
  const result = analyzeManifestCompleteness({
    ...emptyFormValues,
    governance: {
      ...emptyFormValues.governance,
      workspaceName: "My Workspace",
    },
  });

  assert.strictEqual(result.governance, true);
  assert.strictEqual(result.boundedContexts, false);
  assert.strictEqual(result.peerMappings, true); // still only 1 context
  assert.strictEqual(result.portConfiguration, false);
  assert.strictEqual(result.isComplete, false);
  assert.strictEqual(result.firstIncompleteStepIndex, 1);
});

test("analyzeManifestCompleteness - partially populated (contexts without ports)", () => {
  const result = analyzeManifestCompleteness({
    ...emptyFormValues,
    governance: {
      ...emptyFormValues.governance,
      workspaceName: "My Workspace",
    },
    boundedContexts: [
      {
        ...emptyFormValues.boundedContexts[0],
        name: "Users",
        infrastructureTarget: "nestjs",
      },
      {
        ...emptyFormValues.boundedContexts[0],
        id: "2",
        name: "Billing",
        infrastructureTarget: "serverless",
      },
    ],
    peerMappings: [],
  });

  assert.strictEqual(result.governance, true);
  assert.strictEqual(result.boundedContexts, true);
  assert.strictEqual(result.peerMappings, false); // 2 contexts now require mappings or deliberate skip
  assert.strictEqual(result.portConfiguration, false);
  assert.strictEqual(result.isComplete, false);
  assert.strictEqual(result.firstIncompleteStepIndex, 2);
});

test("analyzeManifestCompleteness - fully populated", () => {
  const result = analyzeManifestCompleteness({
    ...emptyFormValues,
    governance: {
      ...emptyFormValues.governance,
      workspaceName: "My Workspace",
    },
    boundedContexts: [
      {
        ...emptyFormValues.boundedContexts[0],
        name: "Users",
        portConfiguration: {
          inboundPorts: ["REST_API"],
          outboundPorts: [],
        },
      },
      {
        ...emptyFormValues.boundedContexts[0],
        id: "2",
        name: "Billing",
        portConfiguration: {
          inboundPorts: [],
          outboundPorts: ["DATABASE"],
        },
      },
    ],
    peerMappings: [
      {
        consumerContext: "2",
        providerContext: emptyFormValues.boundedContexts[0].id,
        relationshipType: "D",
        integrationPattern: "ACL",
      },
    ],
  });

  assert.strictEqual(result.governance, true);
  assert.strictEqual(result.boundedContexts, true);
  assert.strictEqual(result.peerMappings, true);
  assert.strictEqual(result.portConfiguration, true);
  assert.strictEqual(result.isComplete, true);
  assert.strictEqual(result.firstIncompleteStepIndex, 4); // goes to summary
});
