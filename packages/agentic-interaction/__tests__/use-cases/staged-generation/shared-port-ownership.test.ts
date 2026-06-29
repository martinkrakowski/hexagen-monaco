import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { detectSharedPortOwnership } from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";
import type { PortMap } from "../../../src/domain/value-objects/pipeline-state";

const p = (name: string, type: string) => ({ name, type, description: name });
const map = (
  contexts: Array<{ contextName: string; in?: string[][]; out?: string[][] }>,
): PortMap =>
  ({
    contexts: contexts.map((c) => ({
      contextName: c.contextName,
      in: (c.in ?? []).map(([n, t]) => p(n, t)),
      out: (c.out ?? []).map(([n, t]) => p(n, t)),
    })),
  }) as unknown as PortMap;

describe("detectSharedPortOwnership", () => {
  it("flags an outbound port owned by multiple contexts (the FeedbackNotifierPort ×3 case)", () => {
    const w = detectSharedPortOwnership(
      map([
        {
          contextName: "scene-orchestration",
          out: [["FeedbackNotifierPort", "notifier"]],
        },
        {
          contextName: "review-lifecycle",
          out: [["FeedbackNotifierPort", "notifier"]],
        },
        {
          contextName: "feedback-domain",
          out: [["FeedbackNotifierPort", "notifier"]],
        },
      ]),
    );
    assert.strictEqual(w.length, 1);
    assert.match(
      w[0],
      /Outbound port 'FeedbackNotifierPort' is declared by 3 contexts/,
    );
    assert.match(
      w[0],
      /feedback-domain, review-lifecycle, scene-orchestration/,
    );
  });

  it("flags an inbound non-event port owned by multiple contexts (GetAuditTrailQueryPort ×2)", () => {
    const w = detectSharedPortOwnership(
      map([
        {
          contextName: "review-lifecycle",
          in: [["GetAuditTrailQueryPort", "query"]],
        },
        {
          contextName: "audit-governance",
          in: [["GetAuditTrailQueryPort", "query"]],
        },
      ]),
    );
    assert.strictEqual(w.length, 1);
    assert.match(
      w[0],
      /Inbound port 'GetAuditTrailQueryPort' is declared by 2 contexts/,
    );
  });

  it("does NOT flag an inbound EVENT port in multiple contexts (legit pub/sub fan-out)", () => {
    const w = detectSharedPortOwnership(
      map([
        { contextName: "a", in: [["OrderPlacedEventPort", "event"]] },
        { contextName: "b", in: [["OrderPlacedEventPort", "event"]] },
      ]),
    );
    assert.deepStrictEqual(w, []);
  });

  it("does NOT flag a port that is inbound in one context and outbound in another (a contract)", () => {
    const w = detectSharedPortOwnership(
      map([
        { contextName: "renderer", in: [["ScenePort", "command"]] },
        {
          contextName: "orchestration",
          out: [["ScenePort", "external-client"]],
        },
      ]),
    );
    assert.deepStrictEqual(w, []);
  });

  it("returns nothing when every port has a single owner", () => {
    const w = detectSharedPortOwnership(
      map([
        {
          contextName: "orders",
          in: [["PlaceOrderPort", "command"]],
          out: [["OrderRepositoryPort", "repository"]],
        },
        {
          contextName: "billing",
          in: [["ChargePort", "command"]],
          out: [["InvoiceRepositoryPort", "repository"]],
        },
      ]),
    );
    assert.deepStrictEqual(w, []);
  });

  it("is deterministic (sorted) regardless of context order", () => {
    const a = map([
      { contextName: "z-ctx", out: [["SharedPort", "publisher"]] },
      { contextName: "a-ctx", out: [["SharedPort", "publisher"]] },
    ]);
    assert.deepStrictEqual(
      detectSharedPortOwnership(a),
      detectSharedPortOwnership(
        map([
          { contextName: "a-ctx", out: [["SharedPort", "publisher"]] },
          { contextName: "z-ctx", out: [["SharedPort", "publisher"]] },
        ]),
      ),
    );
  });
});
